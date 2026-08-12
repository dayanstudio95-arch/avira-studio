// Shared CORS + response helpers for Supabase Edge Functions.
// Public/unauthenticated endpoints (contract signing, questionnaire) need explicit
// CORS handling since they're called directly from the browser without a session,
// matching the Base44 originals (getLeadPublic, signLeadPublic, submitProductionQuestionnaire).

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-id, Authorization, apikey, x-client-info',
};

// Call at the top of every Deno.serve handler; returns a Response for OPTIONS
// preflight requests, or null if the request should continue normally.
export function handleOptions(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}
