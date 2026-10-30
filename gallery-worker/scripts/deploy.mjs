// Deploys Avira's gallery Worker. Refuses unless wrangler.jsonc names it "avira-gallery", pins a real account and a
// real KV namespace, and none of them is the original films app's or Studio Plan's — so neither of those live
// Workers can ever be overwritten from this repo. The demo files used by the tests (public/demo) are never deployed.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const cfg = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const name = /"name"\s*:\s*"([^"]+)"/.exec(cfg)?.[1]
const refuse = (why) => {
  console.error(`Refusing to deploy: ${why}`)
  process.exit(1)
}
if (name !== 'avira-gallery') refuse(`worker name is "${name}", expected "avira-gallery".`)
if (!cfg.includes('"account_id": "8bb26787282909eb714db5d7d4d5d69f"')) refuse('wrangler.jsonc must pin Avira\'s Cloudflare account (8bb26787…).')
if (cfg.includes('c59e01f9f4e70a3205affcf2b6eec18f')) refuse('wrangler.jsonc has Studio Plan\'s Cloudflare account.')
if (cfg.includes('AVIRA_KV_PLACEHOLDER')) refuse('set the KV namespace id in wrangler.jsonc first (npx wrangler kv namespace create KV).')
if (cfg.includes('63ffc89396cf49069da9c2d77e4b46a2')) refuse('wrangler.jsonc has the ORIGINAL films app\'s KV namespace.')
if (cfg.includes('a38f86f2117b4cb6acfe84eb9f2628a8')) refuse('wrangler.jsonc has Studio Plan\'s KV namespace.')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['vite', 'build'])
fs.rmSync(new URL('../dist/demo', import.meta.url), { recursive: true, force: true })
run('npx', ['wrangler', 'deploy'])
console.log('\nDeployed. Secrets (once): wrangler secret put SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DROPBOX_APP_KEY / DROPBOX_APP_SECRET / GOOGLE_API_KEY / FILMS_STATE_SECRET / TENANT_SECRETS_KEY / HUB_URL')
