// Thin, dependency-free wrapper around Resend's REST API (plain fetch, no SDK —
// matches this codebase's existing style for every other external API call:
// _shared/whatsapp.ts for Green API, _shared/anthropic.ts for Claude).
//
// Requires the RESEND_API_KEY Edge Function secret (see DEPLOYMENT.md section 9).
// Used today by supabase/functions/monthly-events-backup/index.ts — the only
// email-sending capability anywhere in this codebase (everything else is
// WhatsApp via Green API, or Supabase Auth's own built-in transactional email
// for password resets, which this file has no relation to).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Resend's shared sandbox sender. Works with zero setup, but Resend restricts
// it to only deliver to the email address that owns the Resend account itself
// — fine for this feature's actual use case (one studio owner receiving their
// own monthly backup). If broader delivery is ever needed (e.g. multiple
// recipients), a real sending domain must be verified in the Resend dashboard
// and RESEND_FROM_EMAIL set to an address on that domain.
const DEFAULT_FROM = 'Avira Studio <onboarding@resend.dev>';

export interface SendEmailResult {
  success: boolean;
  error?: string;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }
  if (!to) {
    return { success: false, error: 'no recipient email provided' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM_EMAIL') || DEFAULT_FROM,
        to: [to],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      return { success: false, error: `Resend API error (${res.status}): ${bodyText}` };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
