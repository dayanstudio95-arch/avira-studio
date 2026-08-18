// Thin, dependency-free wrapper around Anthropic's Messages API, called from
// supabase/functions/ai-assistant/index.ts. Plain `fetch` rather than the
// @anthropic-ai/sdk npm package: the only non-Supabase npm import anywhere in
// supabase/functions/ today is none at all (Green API in _shared/whatsapp.ts is
// also raw fetch), and Anthropic's Node SDK isn't a proven-clean fit for the Deno
// edge runtime -- a REST call is simpler and matches the project's existing style.
//
// ANTHROPIC_API_KEY is a platform-wide Edge Function secret (one Anthropic account
// for the whole system, not per-tenant like WhatsApp/Morning credentials in
// tenant_secrets) -- see DEPLOYMENT.md's "AI Assistant" setup section.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
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
}: {
  system: string;
  messages: ClaudeMessage[];
  tools?: unknown[];
}): Promise<{ content: ClaudeContentBlock[]; stop_reason: string }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured — run: supabase secrets set ANTHROPIC_API_KEY=...');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
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
