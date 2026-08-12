// Shared Supabase client factories for Edge Functions.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected
// into every Edge Function's environment by the Supabase platform — no manual secret needed.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Authenticated, RLS-respecting client scoped to the calling user's tenant.
// Use this for functions invoked by logged-in frontend code (core business logic:
// syncLeadToEvent, WhatsApp sends triggered from the app, etc). The forwarded
// Authorization header means every query automatically obeys current_tenant_id()
// RLS policies exactly like the frontend's own Supabase client does — no manual
// tenant_id filtering needed in the function body.
export function createUserClient(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
}

// Service-role client that BYPASSES RLS entirely.
// Use ONLY for:
//   (a) public/unauthenticated endpoints that look up a single row by its
//       unguessable UUID (getLeadPublic, saveSignedContract, signLeadPublic,
//       submitProductionQuestionnaire) — mirrors Base44's asServiceRole pattern;
//   (b) the scheduler-driven automationEngine, which has no logged-in user and
//       must explicitly filter every query by tenant_id itself.
// Never use this client to serve list/query results back to an unauthenticated caller.
export function createServiceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Resolves the calling user (throws nothing — returns null if unauthenticated).
export async function getRequestUser(req: Request) {
  const client = createUserClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
