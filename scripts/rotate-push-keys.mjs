// Replace the push-notification keys (VAPID) — only if they are ever lost or exposed.
//
//   node scripts/rotate-push-keys.mjs
//
// What it does, in one go, WITHOUT writing the private key anywhere on this computer:
//   1. generates a new key pair in memory;
//   2. stores the private part as the VAPID_KEYS_B64 secret of the Supabase project
//      (passed to the Supabase CLI on stdin, never as a file and never printed);
//   3. writes the new PUBLIC key into src/lib/push.js.
// Then: deploy whatsapp-webhook, automation-engine and push-test, and `git push`.
// Every device must press "הפעל התראות במכשיר הזה" once again — the old subscriptions
// stop working with the new key and are removed by themselves on the next send.
//
// Why the keys are not on this computer at all: the server already holds them (the
// secret), and the public half is in the code. A lost or stolen laptop changes nothing.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT_REF = 'yzurelfhjkgqrluifszz';
const { subtle } = globalThis.crypto;

const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwks = { publicKey: await subtle.exportKey('jwk', kp.publicKey), privateKey: await subtle.exportKey('jwk', kp.privateKey) };
const b64 = Buffer.from(JSON.stringify(jwks)).toString('base64');
const raw = Buffer.from(await subtle.exportKey('raw', kp.publicKey));
const publicKey = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// `supabase secrets set --env-file -` would need a file; stdin as an env file keeps it off disk.
const res = spawnSync('npx', ['supabase', 'secrets', 'set', '--project-ref', PROJECT_REF, '--env-file', '/dev/stdin'], {
  input: `VAPID_KEYS_B64=${b64}\n`,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (res.status !== 0) {
  console.error('\nשמירת הסוד ב-Supabase נכשלה — שום דבר לא השתנה בקוד.');
  process.exit(1);
}

const file = 'src/lib/push.js';
const src = readFileSync(file, 'utf8');
const next = src.replace(/export const VAPID_PUBLIC_KEY = "[^"]*";/, `export const VAPID_PUBLIC_KEY = "${publicKey}";`);
if (next === src) {
  console.error(`\nלא נמצא VAPID_PUBLIC_KEY ב-${file}. הסוד בשרת כבר הוחלף — יש לעדכן את המפתח הציבורי ידנית.`);
  process.exit(1);
}
writeFileSync(file, next);
console.log('\nהמפתחות הוחלפו. עכשיו: פריסת whatsapp-webhook, automation-engine, push-test ו-git push, ואז "הפעל התראות" בכל מכשיר.');
