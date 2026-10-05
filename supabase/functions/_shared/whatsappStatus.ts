// Delivery receipts, group sender names, quoted messages and our own copy of media
// (WhatsApp Pro, stage 0 — 2026-10-05). The pure helpers at the top are tested in
// scripts/test-whatsapp-bot.mjs PART 15; the DB functions below them are thin.
//
// Payload shapes verified against Green API's docs on 2026-10-05 (not from memory):
//   outgoingMessageStatus — top-level chatId, idMessage, status, timestamp, sendByApi,
//     description; statuses sent | delivered | read | failed | suspended | noAccount |
//     notInGroup | yellowCard (deprecated → suspended).
//   quoted reply — messageData.typeMessage "quotedMessage",
//     messageData.extendedTextMessageData.stanzaId = the quoted message's id.
//   group message — senderData.chatName = the GROUP, sender/senderName/
//     senderContactName = the participant who wrote it.
//   fileMessageData — downloadUrl, mimeType, fileName, caption, jpegThumbnail.

// ---------------------------------------------------------------------------------
// Pure
// ---------------------------------------------------------------------------------

export const FAILURE_STATUSES = ['failed', 'suspended', 'noAccount', 'notInGroup', 'yellowCard'];

// sent < delivered < read; any failure is terminal. 0 = not a status we know.
export function statusRank(status: unknown): number {
  switch (status) {
    case 'sent': return 1;
    case 'delivered': return 2;
    case 'read': return 3;
    default: return FAILURE_STATUSES.includes(String(status)) ? 9 : 0;
  }
}

// Receipts arrive late, twice, or out of order ("read" before "delivered"). A row only
// ever moves forward, so a late "delivered" can never turn a blue tick grey again.
export function shouldAdvance(currentRank: number | null | undefined, nextRank: number): boolean {
  if (!nextRank) return false;
  return nextRank > (currentRank ?? 0);
}

export function isGroupChat(chatId: unknown): boolean {
  return typeof chatId === 'string' && chatId.endsWith('@g.us');
}

// The conversation's title. In a GROUP it is always the group's name (chatName): the
// old rule ("an inbound name wins") renamed the group after whichever member wrote last.
// In a private chat, unchanged: inbound = the contact naming themselves / our
// phonebook; outbound = chatName only (sender* there is the studio itself).
export function pickDisplayName(
  { isInbound, isGroup, senderData }: { isInbound: boolean; isGroup: boolean; senderData: any },
): string | null {
  const sd = senderData || {};
  if (isGroup) return sd.chatName || null;
  return isInbound
    ? sd.senderContactName || sd.senderName || sd.chatName || null
    : sd.chatName || null;
}

// Who wrote this message inside a group. Null for private chats (the conversation
// already says who it is) and for our own messages.
export function groupSender(
  { isInbound, isGroup, senderData }: { isInbound: boolean; isGroup: boolean; senderData: any },
): { senderChatId: string | null; senderName: string | null } {
  if (!isGroup || !isInbound) return { senderChatId: null, senderName: null };
  const sd = senderData || {};
  return {
    senderChatId: typeof sd.sender === 'string' ? sd.sender : null,
    senderName: sd.senderContactName || sd.senderName || null,
  };
}

export function extractQuotedId(messageData: any): string | null {
  const id = messageData?.extendedTextMessageData?.stanzaId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'application/pdf': 'pdf',
};

export function mediaExtension(mime: unknown, fileName: unknown): string {
  const m = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
  if (MIME_EXT[m]) return MIME_EXT[m];
  const fromName = typeof fileName === 'string' ? fileName.split('.').pop() : '';
  const clean = (fromName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean && clean.length <= 5 ? clean : 'bin';
}

// <tenant>/<conversation>/<idMessage>.<ext> — the read policy keys on the first folder.
export function mediaPath(tenantId: string, conversationId: string, idMessage: string, ext: string): string {
  const safeId = String(idMessage).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${tenantId}/${conversationId}/${safeId}.${ext}`;
}

export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;
export const STUCK_AFTER_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------------

async function insertNotification(supabase: any, row: Record<string, unknown>) {
  try {
    await supabase.from('notifications').insert(row);
  } catch (e: any) {
    console.error('[whatsappStatus] notification insert failed:', e?.message || e);
  }
}

async function conversationFor(supabase: any, tenantId: string, chatId: string | null) {
  if (!chatId) return null;
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select('id, display_name, couple_names, phone, matched_lead_id')
    .eq('tenant_id', tenantId)
    .eq('chat_id', chatId)
    .limit(1);
  return data?.[0] ?? null;
}

async function messagePreview(supabase: any, tenantId: string, idMessage: string): Promise<string> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('body_text, type_message')
    .eq('tenant_id', tenantId)
    .eq('id_message', idMessage)
    .limit(1);
  const m = data?.[0];
  const text = m?.body_text || m?.type_message || '';
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

// One outgoingMessageStatus webhook. Never throws.
export async function recordDeliveryStatus(supabase: any, tenantId: string, payload: any): Promise<string> {
  try {
    const idMessage = payload?.idMessage ? String(payload.idMessage) : null;
    const status = typeof payload?.status === 'string' ? payload.status : '';
    const rank = statusRank(status);
    if (!idMessage || !rank) return 'ignored';

    const { data: existing } = await supabase
      .from('whatsapp_message_status')
      .select('status_rank')
      .eq('tenant_id', tenantId)
      .eq('id_message', idMessage)
      .maybeSingle();
    if (!shouldAdvance(existing?.status_rank, rank)) return 'stale';

    const chatId = typeof payload?.chatId === 'string' ? payload.chatId : null;
    const ts = Number(payload?.timestamp);
    const { error } = await supabase.from('whatsapp_message_status').upsert({
      tenant_id: tenantId,
      id_message: idMessage,
      chat_id: chatId,
      status,
      status_rank: rank,
      description: typeof payload?.description === 'string' ? payload.description.slice(0, 300) : null,
      status_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,id_message' });
    if (error) throw new Error(error.message);

    // A failure is told to the studio right away, once (the row cannot move past 9).
    if (rank === 9 && !isGroupChat(chatId)) {
      const conv = await conversationFor(supabase, tenantId, chatId);
      const who = conv?.couple_names || conv?.display_name || conv?.phone || chatId || '';
      const preview = await messagePreview(supabase, tenantId, idMessage);
      const why = status === 'noAccount' ? 'למספר הזה אין וואטסאפ'
        : status === 'suspended' || status === 'yellowCard' ? 'וואטסאפ הגביל זמנית את השליחה מהמספר של הסטודיו'
        : 'השליחה נכשלה';
      await insertNotification(supabase, {
        tenant_id: tenantId,
        type: 'whatsapp_delivery_failed',
        title: `הודעה לא נמסרה: ${who}`,
        body: [why, preview && `"${preview}"`].filter(Boolean).join(' · '),
        related_lead_id: conv?.matched_lead_id ?? null,
      });
    }
    return 'recorded';
  } catch (e: any) {
    console.error('[whatsappStatus] recordDeliveryStatus failed:', e?.message || e);
    return 'error';
  }
}

// Hourly: messages that have sat on one grey tick for 24h (the gallery case). Groups are
// skipped — "delivered" means something else there. At most 20 alerts per tenant per run.
export async function alertStuckMessages(supabase: any, tenantId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data: rows, error } = await supabase
    .from('whatsapp_message_status')
    .select('id_message, chat_id, updated_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'sent')
    .is('stuck_alerted_at', null)
    .lte('updated_at', cutoff)
    .limit(20);
  if (error) {
    console.error('[whatsappStatus] stuck lookup failed:', error.message);
    return 0;
  }
  let alerted = 0;
  for (const r of rows || []) {
    // Mark first: a crash after this line costs one missed alert, never a repeated one.
    await supabase.from('whatsapp_message_status')
      .update({ stuck_alerted_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id_message', r.id_message);
    if (isGroupChat(r.chat_id)) continue;
    const conv = await conversationFor(supabase, tenantId, r.chat_id);
    const who = conv?.couple_names || conv?.display_name || conv?.phone || r.chat_id || '';
    const preview = await messagePreview(supabase, tenantId, r.id_message);
    await insertNotification(supabase, {
      tenant_id: tenantId,
      type: 'whatsapp_delivery_failed',
      title: `הודעה לא נמסרה 24 שעות: ${who}`,
      body: ['נשארה על ✓ אחד — ייתכן שהמספר לא פעיל או שהוואטסאפ שלהם כבוי', preview && `"${preview}"`].filter(Boolean).join(' · '),
      related_lead_id: conv?.matched_lead_id ?? null,
    });
    alerted++;
  }
  return alerted;
}

// Copies a message's media from Green API's temporary URL into the private bucket and
// points the message row at it. Runs after the webhook has answered (waitUntil). Never
// throws; a failure leaves media_url as it was, exactly as before this existed.
export async function copyMediaToStorage(
  supabase: any,
  { tenantId, conversationId, idMessage, downloadUrl, mimeType, fileName }:
  { tenantId: string; conversationId: string; idMessage: string; downloadUrl: string; mimeType?: string | null; fileName?: string | null },
): Promise<string> {
  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) return `http_${res.status}`;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES) return 'too_large';
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MEDIA_MAX_BYTES) return 'too_large';
    const mime = mimeType || res.headers.get('content-type') || 'application/octet-stream';
    const path = mediaPath(tenantId, conversationId, idMessage, mediaExtension(mime, fileName));
    const { error: upErr } = await supabase.storage
      .from('whatsapp-media')
      .upload(path, bytes, { contentType: mime, upsert: true });
    if (upErr) throw new Error(upErr.message);
    await supabase.from('whatsapp_messages')
      .update({ media_path: path, media_mime: mime, media_size: bytes.byteLength })
      .eq('tenant_id', tenantId)
      .eq('id_message', idMessage);
    return 'copied';
  } catch (e: any) {
    console.error('[whatsappStatus] media copy failed:', e?.message || e);
    return 'error';
  }
}
