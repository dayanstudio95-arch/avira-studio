// Writes gallery-worker/.dev.vars (git-ignored) so `npx wrangler dev` runs this Worker on this computer against the
// STAGING database (avira-staging, fake data) — never production. Run by the owner from the Terminal:
//   cd gallery-worker && node scripts/dev-vars-staging.mjs
// The keys come from the Supabase CLI (its own login); the two secrets are random and only for this computer.
// The mock cloud (CLOUD_MOCK=1) answers every folder link with the 30 demo photos, so nothing real is read either.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'

const STAGING = 'fholalvmuytlpllyxewh'
const PRODUCTION = 'yzurelfhjkgqrluifszz'
if (STAGING === PRODUCTION) throw new Error('refusing: that is production')

const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', STAGING, '-o', 'json'], { encoding: 'utf8' }))
const service = keys.find((k) => k.name === 'service_role')?.api_key
if (!service) throw new Error('no service_role key for the staging project')

const lines = [
  `SUPABASE_URL=https://${STAGING}.supabase.co`,
  `SUPABASE_SERVICE_ROLE_KEY=${service}`,
  `FILMS_STATE_SECRET=${crypto.randomBytes(32).toString('hex')}`,
  `TENANT_SECRETS_KEY=${crypto.randomBytes(32).toString('base64')}`,
  'HUB_URL=http://localhost:5174',
  'CLOUD_MOCK=1',
]
fs.writeFileSync(new URL('../.dev.vars', import.meta.url), lines.join('\n') + '\n', { mode: 0o600 })
console.log('OK — gallery-worker/.dev.vars is ready (staging only, not in git).')
