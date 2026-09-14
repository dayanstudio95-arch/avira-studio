// Messages TO the studio, not to customers: the hot-lead alert and the daily digest.
//
// Both go to the single fixed WhatsApp number in Settings → התראות
// (app_settings key notification_phone_number), the same one contract-signed-webhook
// uses. Deliberately not each admin's own profile phone — that was the owner's explicit
// choice when the setting was created.
//
// Nothing here throws. These run after the webhook has already answered Green API, or
// inside the hourly tick; there is nobody to throw to, and a failed alert about a lead
// must never take the lead's own processing down with it.
import { sendWhatsApp } from './whatsapp.ts';

export async function loadNotificationPhone(supabase: any, tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'notification_phone_number')
    .maybeSingle();
  const phone = data?.value?.trim();
  return phone || null;
}

export interface StudioAlertResult {
  sent: boolean;
  skipped?: 'no_phone';
  error?: string;
}

export async function sendStudioAlert(supabase: any, tenantId: string, text: string): Promise<StudioAlertResult> {
  const phone = await loadNotificationPhone(supabase, tenantId);
  if (!phone) return { sent: false, skipped: 'no_phone' };
  const result = await sendWhatsApp(supabase, phone, text, tenantId);
  if (!result.success) return { sent: false, error: result.error || 'send failed' };
  return { sent: true };
}

// A bell notification is the fallback that always works, so it is written FIRST; the
// WhatsApp leg is the one that can fail, and its failure is reported as its own
// notification — the same "never fail silently" rule as everywhere else in this app.
async function insertNotification(
  supabase: any,
  row: { tenant_id: string; type: string; title: string; body: string; related_lead_id?: string | null }
) {
  try {
    await supabase.from('notifications').insert(row);
  } catch (e: any) {
    console.error('[whatsappStudioAlerts] notification insert failed:', e?.message || e);
  }
}

export interface HotLeadAlertInput {
  tenantId: string;
  conversation: {
    couple_names?: string | null;
    display_name?: string | null;
    event_date?: string | null;
    venue?: string | null;
    matched_lead_id?: string | null;
  };
  phone: string | null;
  reason: string | null;
  replyText: string | null;
}

// Pure, exported for tests: what the owner reads on their phone.
export function composeHotLeadAlert(input: HotLeadAlertInput): string {
  const c = input.conversation;
  const name = c.couple_names || c.display_name || input.phone || 'מספר לא מזוהה';
  const lines = [
    `🔥 ליד חם בוואטסאפ — ${name}`,
    c.event_date ? `📅 ${c.event_date}` : null,
    c.venue ? `📍 ${c.venue}` : null,
    input.phone ? `📞 ${input.phone}` : null,
    input.reason ? `למה חם: ${input.reason}` : null,
    input.replyText ? `\n"${input.replyText.slice(0, 300)}"` : null,
    `\nכדאי לענות עכשיו — הבוט שותק מכאן.`,
  ].filter(Boolean);
  return lines.join('\n');
}

// Called by the webhook the first time a conversation is rated 'hot'. Bell row first
// (always), then WhatsApp (may fail → its own _failed notification).
export async function sendHotLeadAlert(supabase: any, input: HotLeadAlertInput): Promise<void> {
  try {
    const c = input.conversation;
    const name = c.couple_names || c.display_name || input.phone || 'מספר לא מזוהה';
    await insertNotification(supabase, {
      tenant_id: input.tenantId,
      type: 'whatsapp_hot_lead',
      title: `🔥 ליד חם בוואטסאפ: ${name}`,
      body: [
        c.event_date ? `תאריך ${c.event_date}` : null,
        c.venue ? `ב${c.venue}` : null,
        input.reason ? `— ${input.reason}` : null,
      ].filter(Boolean).join(' ') || 'הלקוח רוצה להתקדם',
      related_lead_id: c.matched_lead_id || null,
    });

    const result = await sendStudioAlert(supabase, input.tenantId, composeHotLeadAlert(input));
    if (!result.sent && !result.skipped) {
      await insertNotification(supabase, {
        tenant_id: input.tenantId,
        type: 'whatsapp_hot_lead_alert_failed',
        title: 'התראת ליד חם לא נשלחה בוואטסאפ',
        body: `הליד ${name} סומן כחם, אבל ההודעה אליך נכשלה: ${result.error}. הפעמון כאן הוא הגיבוי.`,
        related_lead_id: c.matched_lead_id || null,
      });
    }
  } catch (e: any) {
    console.error('[whatsappStudioAlerts] hot lead alert failed:', e?.message || e);
  }
}
