// A small PostgREST stand-in: turns the requests supabase-js sends
// (/rest/v1/<table>?col=eq.x&order=... and /rest/v1/rpc/<fn>) into SQL.
// Results are built by Postgres itself (json_agg), exactly like PostgREST, so
// numbers, dates and jsonb come back in the same shape the real API returns.
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike', cs: '@>', cd: '<@', ov: '&&' }
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

export const q = (id) => `"${String(id).replace(/"/g, '""')}"`

// Split "a,b(c,d),'e,f'" on top-level commas.
function splitTop(s) {
  const out = []
  let depth = 0
  let quote = false
  let cur = ''
  for (const ch of s) {
    if (ch === '"') quote = !quote
    if (!quote && ch === '(') depth++
    if (!quote && ch === ')') depth--
    if (!quote && depth === 0 && ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur !== '') out.push(cur)
  return out
}

const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)

class Params {
  constructor() {
    this.values = []
  }
  add(v) {
    this.values.push(v)
    return `$${this.values.length}`
  }
}

// One condition: column + "op.value" (optionally "not.op.value").
function condition(col, expr, params, alias) {
  let negate = false
  if (expr.startsWith('not.')) {
    negate = true
    expr = expr.slice(4)
  }
  const dot = expr.indexOf('.')
  const op = dot === -1 ? expr : expr.slice(0, dot)
  const raw = dot === -1 ? '' : expr.slice(dot + 1)
  const ref = `${alias}.${q(col)}`
  let sql
  if (op === 'is') {
    const v = raw.toLowerCase()
    if (!['null', 'true', 'false', 'unknown'].includes(v)) throw bad(`bad "is" value ${raw}`)
    sql = `${ref} is ${v}`
  } else if (op === 'in') {
    const items = splitTop(raw.replace(/^\(/, '').replace(/\)$/, '')).map(unquote)
    sql = items.length ? `${ref}::text in (${items.map((v) => params.add(v)).join(', ')})` : 'false'
  } else if (OPS[op]) {
    let v = unquote(raw)
    if (op === 'like' || op === 'ilike') v = v.replace(/\*/g, '%')
    sql = `${ref} ${OPS[op]} ${params.add(v)}`
  } else throw bad(`unsupported operator "${op}"`)
  return negate ? `not (${sql})` : sql
}

// or=(a.eq.1,b.ilike.*x*,and(c.eq.2,d.is.null))
function logical(kind, body, params, alias) {
  const parts = splitTop(body.replace(/^\(/, '').replace(/\)$/, '')).map((p) => {
    const m = /^(not\.)?(and|or)(\(.*\))$/.exec(p)
    if (m) {
      const inner = logical(m[2], m[3], params, alias)
      return m[1] ? `not ${inner}` : inner
    }
    const dot = p.indexOf('.')
    return condition(p.slice(0, dot), p.slice(dot + 1), params, alias)
  })
  return `(${parts.join(kind === 'or' ? ' or ' : ' and ')})`
}

export function where(searchParams, params, alias = '_t') {
  const conds = []
  for (const [key, value] of searchParams) {
    if (RESERVED.has(key)) continue
    const m = /^(not\.)?(and|or)$/.exec(key)
    if (m) conds.push((m[1] ? 'not ' : '') + logical(m[2], value, params, alias))
    else conds.push(condition(key, value, params, alias))
  }
  return conds.length ? `where ${conds.join(' and ')}` : ''
}

// A JSON path in a select (`data->faceSearch`, `data->>name`, as PostgREST reads it): the column, then each step.
function jsonPath(col, alias) {
  const parts = col.split(/(->>?)/)
  let out = `${alias}.${q(parts[0])}`
  for (let i = 1; i + 1 < parts.length; i += 2) out += `${parts[i]}'${parts[i + 1].replace(/'/g, "''")}'`
  return { sql: out, name: parts.length > 1 ? parts[parts.length - 1] : parts[0] }
}

function selectList(select, alias) {
  if (!select || select.trim() === '*') return `${alias}.*`
  const cols = splitTop(select)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('(')) // embedded relations are not used by the hub
    .map((s) => {
      const [name, as] = s.includes(':') ? [s.split(':')[1], s.split(':')[0]] : [s, null]
      const col = name.split('::')[0]
      if (col === '*') return `${alias}.*`
      if (col.includes('->')) {
        const path = jsonPath(col, alias)
        return `${path.sql} as ${q(as ?? path.name)}`
      }
      return `${alias}.${q(col)}${as ? ` as ${q(as)}` : ''}`
    })
  return cols.length ? cols.join(', ') : `${alias}.*`
}

// The table's own columns a request reads: only the requested ones, never "*" unless asked,
// so a table readable column by column (tenants, fix plan P06) behaves as with PostgREST.
function baseColumns(select, alias) {
  if (!select || select.trim() === '*') return `${alias}.*`
  const names = splitTop(select)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('('))
    .map((s) => (s.includes(':') ? s.split(':')[1] : s).split('::')[0].split('->')[0])
  if (!names.length || names.includes('*')) return `${alias}.*`
  return [...new Set(names)].map((c) => `${alias}.${q(c)}`).join(', ')
}

function orderBy(order, alias) {
  if (!order) return ''
  const parts = order.split(',').map((p) => {
    const [col, ...mods] = p.split('.')
    const dir = mods.includes('desc') ? 'desc' : 'asc'
    const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''
    return `${alias}.${q(col)} ${dir}${nulls}`
  })
  return `order by ${parts.join(', ')}`
}

export function bad(message, code = 'PGRST100') {
  return Object.assign(new Error(message), { code, status: 400 })
}

// Returns { sql, params, countSql } for a table request.
export function buildTableQuery({ method, table, url, body, prefer, range }) {
  const sp = url.searchParams
  const params = new Params()
  const t = `public.${q(table)}`
  const cols = selectList(sp.get('select'), '_r')
  if (method === 'GET' || method === 'HEAD') {
    const w = where(sp, params)
    let limit = sp.get('limit')
    let offset = sp.get('offset')
    if (range) {
      const m = /^(\d+)-(\d+)?$/.exec(range)
      if (m) {
        offset = m[1]
        if (m[2] !== undefined) limit = String(Number(m[2]) - Number(m[1]) + 1)
      }
    }
    const inner = `select ${baseColumns(sp.get('select'), '_t')} from ${t} _t ${w} ${orderBy(sp.get('order'), '_t')} ${limit ? `limit ${Number(limit)}` : ''} ${offset ? `offset ${Number(offset)}` : ''}`
    return {
      sql: `select coalesce(json_agg(_x), '[]'::json) as j from (select ${cols} from (${inner}) _r) _x`,
      params: params.values,
      countSql: prefer.count ? `select count(*)::int as n from ${t} _t ${w}` : null,
      offset: Number(offset || 0),
    }
  }
  // return=minimal (no .select()): the write returns nothing, so it needs no read rights either.
  const wanted = prefer.return === 'representation'
  const ret = wanted ? baseColumns(sp.get('select'), '_t') : '1 as _'
  const returning = wanted ? `select coalesce(json_agg(_x), '[]'::json) as j from (select ${cols} from _w _r) _x` : `select '[]'::json as j`
  if (method === 'POST') {
    const rows = Array.isArray(body) ? body : [body]
    if (!rows.length) return { sql: `select '[]'::json as j`, params: [] }
    const keys = sp.get('columns') ? sp.get('columns').split(',') : [...new Set(rows.flatMap((r) => Object.keys(r)))]
    const colList = keys.map(q).join(', ')
    const p = params.add(JSON.stringify(rows))
    let conflict = ''
    if (prefer.resolution) {
      const target = sp.get('on_conflict')
      const tgt = target ? `(${target.split(',').map(q).join(', ')})` : ''
      if (prefer.resolution === 'ignore-duplicates') conflict = `on conflict ${tgt} do nothing`
      else {
        const sets = keys.map((k) => `${q(k)} = excluded.${q(k)}`).join(', ')
        conflict = `on conflict ${tgt || '(id)'} do update set ${sets}`
      }
    }
    return {
      sql: `with _w as (insert into ${t} as _t (${colList}) select ${colList} from json_populate_recordset(null::${t}, ${p}::json) ${conflict} returning ${ret}) ${returning}`,
      params: params.values,
    }
  }
  if (method === 'PATCH') {
    const keys = Object.keys(body || {})
    if (!keys.length) throw bad('nothing to update')
    const p = params.add(JSON.stringify(body))
    const w = where(sp, params)
    const sets = keys.map((k) => `${q(k)} = _in.${q(k)}`).join(', ')
    return {
      sql: `with _w as (update ${t} as _t set ${sets} from json_populate_record(null::${t}, ${p}::json) _in ${w} returning ${ret}) ${returning}`,
      params: params.values,
    }
  }
  if (method === 'DELETE') {
    const w = where(sp, params)
    return { sql: `with _w as (delete from ${t} as _t ${w} returning ${ret}) ${returning}`, params: params.values }
  }
  throw bad(`method ${method} not supported`)
}

export function parsePrefer(header = '') {
  const out = {}
  for (const part of header.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = part.split('=')
    out[k] = v
  }
  return out
}
