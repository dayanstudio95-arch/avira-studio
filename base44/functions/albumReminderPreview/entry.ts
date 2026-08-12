import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function isValidPhone(phone) {
  if (!phone) return false;
  const clean = phone.trim();
  return clean.length > 3 && clean !== '0';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const allEvents = await base44.asServiceRole.entities.Event.list('-date');

    // Debug counters
    let debugTotalChecked = 0;
    let debugTooRecent = 0;
    let debugAlbumSent = 0;
    let debugReminderAlreadySent = 0;
    let debugNoPhone = 0;

    const eligible = allEvents.filter(ev => {
      debugTotalChecked++;
      if (!ev.date || ev.date > cutoffStr) { debugTooRecent++; return false; }      // must be 30+ days ago
      if (ev.albumStatus === 'sent') { debugAlbumSent++; return false; }            // already ordered album
      if (ev.album_reminder_sent === true) { debugReminderAlreadySent++; return false; } // already sent
      if (!isValidPhone(ev.phoneNumber)) { debugNoPhone++; return false; }          // must have valid phone
      return true;
    });

    const debug = {
      cutoffDate: cutoffStr,
      totalChecked: debugTotalChecked,
      filteredTooRecent: debugTooRecent,
      filteredAlbumSent: debugAlbumSent,
      filteredReminderAlreadySent: debugReminderAlreadySent,
      filteredNoPhone: debugNoPhone,
      eligible: eligible.length,
      sampleDates: allEvents.slice(0, 5).map(e => ({ date: e.date, albumStatus: e.albumStatus, album_reminder_sent: e.album_reminder_sent })),
    };
    console.log('[albumReminderPreview] debug:', JSON.stringify(debug, null, 2));

    const reason = eligible.length === 0
      ? 'לא נמצאו אירועים שעברו 30 יום ולא הזמינו אלבום'
      : null;

    return Response.json({
      success: true,
      total: eligible.length,
      reason,
      debug,
      events: eligible.map(ev => ({
        id: ev.id,
        coupleNames: ev.coupleNames,
        date: ev.date,
        phone: ev.phoneNumber,
        venue: ev.venue || '',
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});