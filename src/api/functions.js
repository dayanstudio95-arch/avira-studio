import { supabase } from './supabaseClient';

// Drop-in replacement for the Base44 SDK's `base44.functions.invoke(name, payload)`
// interface, routing calls to the ported Supabase Edge Functions under
// supabase/functions/<kebab-case-name>/index.ts instead of the dead Base44 backend.
//
// Response shape: every call resolves to `{ data }`, where `data` is the Edge
// Function's parsed JSON body — matching the original Base44 SDK's `res.data` /
// `response.data` convention that every existing call site in src/ already expects
// (e.g. `res.data?.assigned`, `response.data || {}`).
//
// Error handling: throws an Error (with `.message` taken from the response body's
// `error` field, falling back to a generic HTTP status message) whenever the Edge
// Function responds with a non-2xx status, or on a network failure. Every live call
// site in src/ wraps `base44.functions.invoke(...)` in try/catch, so this is safe —
// see Leads.jsx's handleAssignStudioIds/handleSyncAllSigned/handleFixMissingEvents
// for representative examples. A few call sites additionally branch on
// `result.data?.success` / `result.data?.error` for a *business-logic* failure (as
// opposed to an HTTP error) — those still work unchanged since such functions return
// 200 with `{ success: false, error: '...' }` bodies, which never throws here.
//
// Auth: uses the Supabase client's current session automatically (same client
// src/api/entities.js and src/api/supabaseClient.js already use), so every request
// carries the same Authorization header the RLS-scoped Edge Functions expect.
// Public/unauthenticated functions (getLeadPublic, saveSignedContract,
// signLeadPublic, submitProductionQuestionnaire) work the same way whether or not a
// session exists — they use a service-role client server-side and don't require one.
const FUNCTION_MAP = {
  // Core business logic
  syncLeadToEvent: 'sync-lead-to-event',
  syncEventToCalendar: 'sync-event-to-calendar',
  cancelEvent: 'cancel-event',
  cleanupDuplicateEvents: 'cleanup-duplicate-events',
  assignStudioIds: 'assign-studio-ids',
  assignStudioIdToNewLead: 'assign-studio-id-to-new-lead',
  fixMissingEventForLead: 'fix-missing-event-for-lead',
  syncAllSignedLeads: 'sync-all-signed-leads',
  syncLeadFollowups: 'sync-lead-followups',
  sendStaffInvite: 'send-staff-invite',

  // Google Calendar — real OAuth connect flow + dual-account sync (see
  // supabase/functions/_shared/googleCalendarAuth.ts / googleCalendarSync.ts).
  // google-calendar-oauth-callback is NOT here — Google redirects the browser
  // to it directly, it's never called via functions.invoke.
  googleCalendarOAuthStart: 'google-calendar-oauth-start',
  googleCalendarOAuthDisconnect: 'google-calendar-oauth-disconnect',
  deleteEventFromCalendar: 'delete-event-from-calendar',
  deleteFromGoogleCalendar: 'delete-google-calendar-event',
  reconcileCalendarSync: 'reconcile-calendar-sync',

  // Public / unauthenticated pages
  getLeadPublic: 'get-lead-public',
  saveSignedContract: 'save-signed-contract',
  signLeadPublic: 'sign-lead-public',
  submitProductionQuestionnaire: 'submit-production-questionnaire',

  // WhatsApp sends (all via the shared Green API helper server-side)
  sendToEditor: 'send-to-editor',
  sendToCouple: 'send-to-couple',
  sendWhatsAppMessage: 'send-whatsapp-message',
  sendAlbumSketch: 'send-album-sketch',
  sendStaffScheduleMessage: 'send-staff-schedule-message',
  shareEventInfoWithTeam: 'share-event-info-with-team',
  whatsappManager: 'whatsapp-manager',
  monthlyCrewSchedule: 'monthly-crew-schedule',
  sendQuestionnaireReminders: 'send-questionnaire-reminders',
  dailyEventBrief: 'daily-event-brief',
  sendQuestionnaireToEvents: 'send-questionnaire-to-events',

  // Automation engine + approval workflow
  automationEngine: 'automation-engine',
  approvePendingAutomation: 'approve-pending-automation',

  // Morning / Green Invoice — supports two business entities (sole_prop / company),
  // see supabase/functions/generate-morning-invoice/index.ts for details.
  generateMorningInvoice: 'generate-morning-invoice',
  checkMorningConnection: 'check-morning-connection',
  getLatestMorningDocumentDate: 'get-latest-morning-document-date',

  // Team/user management (Settings → משתמשים)
  inviteUser: 'invite-user',
  resendInvite: 'resend-invite',
  listTenantUsers: 'list-tenant-users',
  updateTenantUser: 'update-tenant-user',
  deleteTenantUser: 'delete-tenant-user',
  createTenant: 'create-tenant',

  // Scoped-role endpoints (2026-08-20) — lead_coordinator / photographer, each the
  // ONE function their one dedicated page is allowed to call. See
  // supabase/functions/coordinator-leads/index.ts, photographer-events/index.ts.
  coordinatorLeads: 'coordinator-leads',
  photographerEvents: 'photographer-events',

  // AI Assistant — real Claude-backed Q&A + WhatsApp-send action proposals.
  // See supabase/functions/ai-assistant/index.ts. Read-only server-side; actual
  // sends happen client-side via sendToEditor/sendToCouple/sendWhatsAppMessage
  // above, only after the user explicitly confirms a proposed action.
  aiAssistant: 'ai-assistant',

  // Wedding Albums module — the 2 public, token-based Edge Functions (see
  // supabase/migrations/0031_wedding_albums.sql + CLAUDE.md's "Wedding Albums module"
  // section). Both take { token, action, ...params } and never trust a real Supabase
  // session — the raw token is the caller's only credential, hashed+looked-up
  // server-side on every request. Everything else in this module (order CRUD, catalog
  // management, sketch-upload metadata registration) goes through entities.js directly
  // under normal RLS, since those are all authenticated admin/album_manager actions.
  albumPortal: 'album-portal',
  albumPrintAccess: 'album-print-access',
  // Album Guide Page — separate, generic couple-facing informational page (not part
  // of the album-portal purchase wizard above). Public/unauthenticated like
  // get-lead-public: no config.toml override needed since this is always called
  // through this functions.invoke() wrapper, which already attaches a valid JWT
  // (real session token, or the anon-key fallback below) satisfying platform-level
  // verify_jwt=true even with no logged-in user.
  getAlbumGuidePublic: 'get-album-guide-public',

  // Two-way staff availability confirmation (migration 0041) — public, unauthenticated
  // like the two functions above. Called from StaffAvailabilityResponse.jsx (the
  // /staff-availability/:token page); the raw token is the caller's only credential,
  // hashed+looked-up server-side on every request against
  // staff_availability_requests.token_hash.
  respondStaffAvailabilityPublic: 'respond-staff-availability-public',
};

// Names that intentionally have NO Edge Function port yet — either confirmed dead
// frontend code with no backend anywhere in the original app (createLeadCalendarEvent,
// syncEventToLead — see supabase/functions/*/index.ts header comments for the
// investigation), explicitly replaced/obsolete (sendMakeWebhook — Make.com was fully
// replaced by Green API), or out of scope for this phase (Google Calendar
// duplicate-cleanup maintenance tools, aiAssistant). Calling any of these throws a
// clear "not implemented" error instead of a confusing network failure, so it's
// obvious in the console what's missing rather than looking like a transient bug.
// (Morning/Green Invoice — checkMorningConnection, generateMorningInvoice,
// getLatestMorningDocumentDate — was in this set until it was ported; aiAssistant
// was in this set until the real Claude-backed port; see FUNCTION_MAP.)
const KNOWN_UNIMPLEMENTED = new Set([
  'createLeadCalendarEvent',
  'syncEventToLead',
  'sendMakeWebhook',
  'cleanupGoogleCalendarOnlyDuplicates',
]);

export const functions = {
  async invoke(name, payload = {}) {
    const slug = FUNCTION_MAP[name];
    if (!slug) {
      const reason = KNOWN_UNIMPLEMENTED.has(name)
        ? 'out of scope / superseded for this migration phase'
        : 'no Supabase Edge Function port exists for it';
      throw new Error(`base44.functions.invoke('${name}') is not implemented — ${reason}.`);
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload ?? {}),
    });

    const rawText = await res.text();
    let body = null;
    let parseError = null;
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch (e) {
        parseError = e;
      }
    }

    if (!res.ok) {
      const message = body?.error || `${name} failed (HTTP ${res.status})`;
      throw new Error(message);
    }

    // A 2xx response whose body isn't valid JSON (e.g. a gateway/CDN error page
    // slipping through with a 200) is never actually a success. Previously this
    // was swallowed into `body = null`, so callers like ContractPage.jsx's
    // 'upload' step read `saveRes?.data?.fileUrl` as null and silently continued
    // on to the next step as if it had succeeded, instead of surfacing the real
    // failure through the normal catch/toast path.
    if (parseError) {
      throw new Error(`${name} returned an unexpected non-JSON response (HTTP ${res.status})`);
    }

    return { data: body };
  },
};
