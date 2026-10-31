// Sets the live gallery Worker's secrets ("avira-gallery" on Cloudflare), once, after the first deploy. Run by the owner
// from the Terminal:   cd gallery-worker && node scripts/secrets-production.mjs
// Nothing is printed. The Supabase URL and service key come from the Supabase CLI (its own login, production project),
// the two root secrets are random, the Dropbox app key is the app's public id, and the two copied ones (Dropbox app
// secret, Google key) are picked up from the clipboard as the owner presses Copy in the browser, in either order —
// emptied first, so nothing copied earlier counts; only a value of the right shape is taken (anything else is ignored);
// emptied again at the end.
// A secret that already exists is skipped — above all FILMS_STATE_SECRET (signs every gallery link and cookie) and
// TENANT_SECRETS_KEY (seals the Dropbox token): replacing either breaks what was made with it. Only the three Dropbox /
// Google ones can be set again:   node scripts/secrets-production.mjs --replace=DROPBOX_APP_SECRET,GOOGLE_API_KEY
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'

const PRODUCTION = 'yzurelfhjkgqrluifszz'
// The "Avira Gallery" Dropbox app's key — its public OAuth client id (it is in every Dropbox sign-in address).
const DROPBOX_APP_KEY = 'gf6qwgmmquujr8i'
const COPIED = {
  DROPBOX_APP_SECRET: {
    where: 'Dropbox, "Avira Gallery": הכפתור Copy בשורה App secret',
    ok: (v) => /^[a-z0-9]{10,20}$/.test(v) && v !== DROPBOX_APP_KEY,
  },
  GOOGLE_API_KEY: {
    where: 'Google Cloud, "Album editor - Drive": סמל ההעתקה ליד המפתח',
    ok: (v) => /^AIza[\w-]{35}$/.test(v),
  },
}
const WAIT_MINUTES = 10

const cwd = new URL('..', import.meta.url)
const cfg = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const refuse = (why) => {
  console.error(`Refusing: ${why}`)
  process.exit(1)
}
if (/"name"\s*:\s*"([^"]+)"/.exec(cfg)?.[1] !== 'avira-gallery') refuse('wrangler.jsonc is not the "avira-gallery" Worker.')
if (!cfg.includes('"account_id": "8bb26787282909eb714db5d7d4d5d69f"')) refuse('wrangler.jsonc must pin Avira\'s Cloudflare account.')
const replace = new Set((process.argv.find((a) => a.startsWith('--replace='))?.slice('--replace='.length) ?? '').split(',').filter(Boolean))
for (const n of replace) if (n !== 'DROPBOX_APP_KEY' && !(n in COPIED)) refuse(`only DROPBOX_APP_KEY, ${Object.keys(COPIED).join(', ')} can be replaced.`)

const wrangler = (args, opts) => execFileSync('npx', ['wrangler', ...args], { cwd, ...opts })
const names = () => JSON.parse(wrangler(['secret', 'list', '--format', 'json'], { encoding: 'utf8' })).map((s) => s.name)
const existing = new Set(names())
const needed = (name) => replace.has(name) || !existing.has(name)
const put = (name, value) => {
  wrangler(['secret', 'put', name], { input: value, stdio: ['pipe', 'ignore', 'inherit'] })
  console.log(`${name}: set`)
}
const clearClipboard = () => execFileSync('pbcopy', { input: '' })

if (needed('SUPABASE_URL')) put('SUPABASE_URL', `https://${PRODUCTION}.supabase.co`)
if (needed('HUB_URL')) put('HUB_URL', 'https://new.avira-studio.com')
if (needed('SUPABASE_SERVICE_ROLE_KEY')) {
  const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PRODUCTION, '-o', 'json'], { encoding: 'utf8' }))
  const service = keys.find((k) => k.name === 'service_role')?.api_key ?? ''
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(service)) refuse('no full service_role key from the Supabase CLI for the production project.')
  put('SUPABASE_SERVICE_ROLE_KEY', service)
}
if (needed('FILMS_STATE_SECRET')) put('FILMS_STATE_SECRET', crypto.randomBytes(32).toString('hex'))
if (needed('TENANT_SECRETS_KEY')) put('TENANT_SECRETS_KEY', crypto.randomBytes(32).toString('base64url'))
if (needed('DROPBOX_APP_KEY')) put('DROPBOX_APP_KEY', DROPBOX_APP_KEY)

const waiting = new Map(Object.entries(COPIED).filter(([name]) => needed(name)))
if (waiting.size) {
  clearClipboard()
  console.log('\nבדפדפן, לחץ Copy על:')
  for (const [name, { where }] of waiting) console.log(`  • ${where}  (${name})`)
  const until = Date.now() + WAIT_MINUTES * 60_000
  while (waiting.size && Date.now() < until) {
    const value = execFileSync('pbpaste', { encoding: 'utf8' }).trim()
    const hit = [...waiting].find(([, { ok }]) => ok(value))
    if (hit) {
      put(hit[0], value)
      waiting.delete(hit[0])
      clearClipboard()
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  clearClipboard()
}

const now = names()
const missing = ['SUPABASE_URL', 'HUB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FILMS_STATE_SECRET', 'TENANT_SECRETS_KEY', 'DROPBOX_APP_KEY', ...Object.keys(COPIED)]
  .filter((n) => !now.includes(n) || waiting.has(n))
console.log(missing.length ? `\nMissing: ${missing.join(', ')}` : '\nOK — all 8 secrets are set.')
