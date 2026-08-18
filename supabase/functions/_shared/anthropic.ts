// Thin, dependency-free wrapper around Anthropic's Messages API, called from
// supabase/functions/ai-assistant/index.ts. Plain `fetch` rather than the
// @anthropic-ai/sdk npm package: the only non-Supabase npm import anywhere in
// supabase/functions/ today is none at all (Green API in _shared/whatsapp.ts is
// also raw fetch), and Anthropic's Node SDK isn't a proven-clean fit for the Deno
// edge runtime -- a REST call is simpler and matches the project's existing style.
//
// ANTHROPIC_API_KEY is the platform-wide fallback Edge Function secret, used when a
// tenant hasn't configured their own key. Tenants can optionally set their own key via
// Settings -> אינטגרציות (stored in tenant_secrets, key='anthropic_api_key', same pattern
// as WhatsApp/Morning credentials) -- see ai-assistant/index.ts, which resolves the
// per-tenant key first and passes it into callClaude()'s `apiKey` param below, falling
// back to this platform-wide default when the tenant has none. See DEPLOYMENT.md's
// "AI Assistant" setup section.
const PLATFORM_ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const ANTHROPIC_VERSION = '2023-06-01';
// Verify the current model id at https://docs.anthropic.com/en/docs/about-claude/models
// before relying on this default long-term -- override anytime via
// `supabase secrets set ANTHROPIC_MODEL=...` with no code deploy needed.
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] };

export async function callClaude({
  system,
  messages,
  tools,
  apiKey,
}: {
  system: string;
  messages: ClaudeMessage[];
  tools?: unknown[];
  // Optional per-tenant override, resolved by the caller from tenant_secrets. When
  // omitted (or blank), falls back to the platform-wide PLATFORM_ANTHROPIC_API_KEY.
  apiKey?: string | null;
}): Promise<{ content: ClaudeContentBlock[]; stop_reason: string }> {
  const resolvedKey = apiKey || PLATFORM_ANTHROPIC_API_KEY;
  if (!resolvedKey) {
    throw new Error('לא הוגדר מפתח Anthropic API — ניתן להזין מפתח אישי בהגדרות > אינטגרציות, או להריץ: supabase secrets set ANTHROPIC_API_KEY=...');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': resolvedKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL') || DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic API error (${res.status}): ${text}`);
  }

  return res.json();
}
