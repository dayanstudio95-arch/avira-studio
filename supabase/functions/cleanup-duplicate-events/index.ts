// Real implementation of the "בדוק כפילויות" (detect + delete duplicates)
// flow on the Events page. Previously `cleanupDuplicateEvents` was in
// KNOWN_UNIMPLEMENTED — clicking "מחק כפילויות ✓" in the confirmation dialog
// (src/pages/Events.jsx) always threw. The dialog itself already does its own
// client-side *preview* of duplicate groups (Events.jsx:57-100) but sends no
// payload when confirming — so this function must recompute the exact same
// duplicate groups server-side, from the tenant's live data, so what actually
// gets deleted matches what the user was shown.
//
// Duplicate criteria (mirrors Events.jsx's getEventKeys exactly): two events
// are duplicates of each other if they share ANY of:
//   - source_lead_id
//   - lead_id (legacy free-text field)
//   - studio_id (only when > 0 — 0/null is never treated as a match)
//   - couple_names + date (same couple, same date)
// Within a duplicate cluster, the most-recently-created row is kept (matches
// the "שמור" badge shown on index 0 in the dialog, which sorts by
// created_at descending) and every older row is deleted.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { deleteEventFromAllAccounts } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
    if (!profile) return jsonResponse({ error: 'Profile not found for user' }, { status: 403 });

    // RLS already scopes this to the caller's tenant (events_tenant_isolation),
    // but tenant_id is selected too so it's explicit and cheap to double check.
    const { data: events, error: loadErr } = await supabase
      .from('events')
      .select('id, tenant_id, source_lead_id, lead_id, studio_id, couple_names, date, created_at')
      .eq('tenant_id', profile.tenant_id);
    if (loadErr) return jsonResponse({ error: loadErr.message }, { status: 500 });

    if (!events || events.length === 0) {
      return jsonResponse({ success: true, message: 'לא נמצאו כפילויות באירועים', deletedFromDatabase: 0, deletedFromGoogle: 0, googleFailed: 0 });
    }

    // Build every key each event participates in — identical logic to the
    // frontend's getEventKeys (Events.jsx:58-65).
    const getEventKeys = (e: any): string[] => {
      const keys: string[] = [];
      if (e.source_lead_id) keys.push(`source:${e.source_lead_id}`);
      if (e.lead_id) keys.push(`leadId:${e.lead_id}`);
      if (e.studio_id && e.studio_id > 0) keys.push(`studio:${e.studio_id}`);
      if (e.couple_names && e.date) keys.push(`couple:${e.couple_names}|${e.date}`);
      return keys;
    };

    const byId = new Map(events.map((e: any) => [e.id, e]));
    const keyToIds = new Map<string, Set<string>>();
    for (const e of events) {
      for (const key of getEventKeys(e)) {
        if (!keyToIds.has(key)) keyToIds.set(key, new Set());
        keyToIds.get(key)!.add(e.id);
      }
    }

    // Process each key group with >1 member. Dedupe identical id-sets so an
    // event pair matching on multiple keys (e.g. same source_lead_id AND same
    // couple+date) is only processed once, matching the frontend's
    // `processedEvents` guard (Events.jsx:88-90).
    const processedGroupKeys = new Set<string>();
    const keepIds = new Set<string>();
    const deleteCandidateIds = new Set<string>();
    let groupCount = 0;

    for (const [, idSet] of keyToIds) {
      if (idSet.size < 2) continue;
      const groupKey = Array.from(idSet).sort().join('|');
      if (processedGroupKeys.has(groupKey)) continue;
      processedGroupKeys.add(groupKey);
      groupCount++;

      const groupEvents = Array.from(idSet)
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      groupEvents.forEach((e: any, i: number) => {
        if (i === 0) keepIds.add(e.id);
        else deleteCandidateIds.add(e.id);
      });
    }

    // Never delete an event that was chosen to be kept by any group — guards
    // against the rare case where overlapping-but-not-identical groups would
    // otherwise disagree (see design note in the calling plan).
    const idsToDelete = Array.from(deleteCandidateIds).filter((id) => !keepIds.has(id));

    if (idsToDelete.length === 0) {
      return jsonResponse({ success: true, message: 'לא נמצאו כפילויות באירועים', deletedFromDatabase: 0, deletedFromGoogle: 0, googleFailed: 0 });
    }

    let deletedFromDatabase = 0;
    let deletedFromGoogle = 0;
    let googleFailed = 0;

    for (const eventId of idsToDelete) {
      // Google Calendar cleanup BEFORE the row delete — event_calendar_syncs
      // cascades off events, so deleting the row first would destroy the data
      // needed to know what to clean up on Google's side. Best-effort: a
      // Google-side failure never blocks the actual duplicate cleanup.
      try {
        const results = await deleteEventFromAllAccounts(supabase, profile.tenant_id, eventId);
        if (results.length === 0) {
          // never synced anywhere — nothing to count either way
        } else if (results.some((r) => r.status === 'failed')) {
          googleFailed++;
        } else {
          deletedFromGoogle++;
        }
      } catch (calErr) {
        console.error(`[cleanup-duplicate-events] Google cleanup failed for ${eventId}:`, calErr.message);
        googleFailed++;
      }

      const { error: delErr } = await supabase.from('events').delete().eq('id', eventId);
      if (delErr) {
        console.error(`[cleanup-duplicate-events] Failed to delete event ${eventId}:`, delErr.message);
        continue;
      }
      deletedFromDatabase++;
    }

    console.log(`[cleanup-duplicate-events] tenant=${profile.tenant_id} groups=${groupCount} deleted=${deletedFromDatabase}/${idsToDelete.length}`);

    const message = `נמחקו ${deletedFromDatabase} אירועים כפולים מתוך ${groupCount} קבוצות כפילויות`;
    return jsonResponse({ success: true, message, deletedFromDatabase, deletedFromGoogle, googleFailed });
  } catch (error) {
    console.error('[cleanup-duplicate-events] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
