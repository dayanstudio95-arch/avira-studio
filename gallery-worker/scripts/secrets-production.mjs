// Sets the live gallery Worker's secrets ("avira-gallery" on Cloudflare), once, after the first deploy. Run by the owner
// from the Terminal:   cd gallery-worker && node scripts/secrets-production.mjs
// Nothing is printed. The Supabase URL and service key come from the Supabase CLI (its own login, production project),
// the two root secrets are random, and wrangler itself asks for the three pasted ones (Dropbox app key and secret, the
// Google key) with hidden input.
// A secret that already exists is skipped — above all FILMS_STATE_SECRET (signs every gallery link and cookie) and
// TENANT_SECRETS_KEY (seals the Dropbox token): replacing either breaks what was made with it. To change one of the
// pasted ones later: npx wrangler secret put <NAME>.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'

const PRODUCTION = 'yzurelfhjkgqrluifszz'
const cwd = new URL('..', import.meta.url)
const cfg = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const refuse = (why) => {
  console.error(`Refusing: ${why}`)
  process.exit(1)
}
if (/"name"\s*:\s*"([^"]+)"/.exec(cfg)?.[1] !== 'avira-gallery') refuse('wrangler.jsonc is not the "avira-gallery" Worker.')
if (!cfg.includes('"account_id": "8bb26787282909eb714db5d7d4d5d69f"')) refuse('wrangler.jsonc must pin Avira\'s Cloudflare account.')

const wrangler = (args, opts) => execFileSync('npx', ['wrangler', ...args], { cwd, ...opts })
const existing = new Set(JSON.parse(wrangler(['secret', 'list', '--format', 'json'], { encoding: 'utf8' })).map((s) => s.name))
const put = (name, value) => {
  if (existing.has(name)) return console.log(`${name}: already set, kept`)
  wrangler(['secret', 'put', name], { input: value, stdio: ['pipe', 'ignore', 'inherit'] })
  console.log(`${name}: set`)
}
const ask = (name, where) => {
  if (existing.has(name)) return console.log(`${name}: already set, kept`)
  console.log(`\n${name} — ${where}`)
  wrangler(['secret', 'put', name], { stdio: 'inherit' })
}

const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PRODUCTION, '-o', 'json'], { encoding: 'utf8' }))
const service = keys.find((k) => k.name === 'service_role')?.api_key ?? ''
if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(service)) refuse('no full service_role key from the Supabase CLI for the production project.')

put('SUPABASE_URL', `https://${PRODUCTION}.supabase.co`)
put('HUB_URL', 'https://new.avira-studio.com')
put('SUPABASE_SERVICE_ROLE_KEY', service)
put('FILMS_STATE_SECRET', crypto.randomBytes(32).toString('hex'))
put('TENANT_SECRETS_KEY', crypto.randomBytes(32).toString('base64url'))
ask('DROPBOX_APP_KEY', 'Dropbox → App Console → "Avira Gallery" → Settings → App key')
ask('DROPBOX_APP_SECRET', 'Dropbox → App Console → "Avira Gallery" → Settings → App secret (Show)')
ask('GOOGLE_API_KEY', 'Google Cloud → Credentials → "Album editor - Drive" → Show key')

const now = JSON.parse(wrangler(['secret', 'list', '--format', 'json'], { encoding: 'utf8' })).map((s) => s.name)
const want = ['SUPABASE_URL', 'HUB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FILMS_STATE_SECRET', 'TENANT_SECRETS_KEY', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'GOOGLE_API_KEY']
const missing = want.filter((n) => !now.includes(n))
console.log(missing.length ? `\nMissing: ${missing.join(', ')}` : '\nOK — all 8 secrets are set.')
