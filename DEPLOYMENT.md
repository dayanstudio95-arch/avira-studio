# Avira Studio — Deployment Guide (Supabase backend)

This app was rebuilt off Base44 onto Supabase (Postgres + Auth + Storage + Edge
Functions). This doc is the checklist for getting a fresh clone of this repo (or
this repo after a pull with new commits) actually **live** against your Supabase
project. There's no CI/CD wired up yet — everything below is manual, once.

You already have a live Supabase project (`yzurelfhjkgqrluifszz.supabase.co`) with
migrations `0001`–`0003` applied and Phase 1/2 (auth + entities) verified working.
What's below is what's **new and not yet applied**: migrations `0004`–`0016` and a
batch of new/edited Edge Functions, including a full real Google Calendar OAuth
integration (see section 4).

## 0. One-time setup: install the Supabase CLI

Nothing in this environment could run `supabase` (not installed here), so do this
on your own machine:

```bash
npm install -g supabase
supabase login
cd "avira-studio-v31-copy-23960b65"
supabase link --project-ref yzurelfhjkgqrluifszz   # your project ref, from the Supabase dashboard URL
```

If you'd rather not install the CLI, every step below can also be done by hand
through the Supabase Dashboard (SQL Editor for migrations, Edge Functions tab for
functions) — noted inline.

## 1. Run the pending migrations (in order)

Migrations exist beyond what you've already run, up through `0017`. **Run them in
numeric order** — each may depend on tables/columns from the previous one. The most
recent one you need for this round is `0017`, which adds the automatic
calendar-sync trigger (see section 4 below for the full setup that depends on it).

| # | File | What it does |
|---|------|---------------|
| 0004 | `0004_lead_questionnaire_reminder.sql` | Adds `leads.questionnaire_reminder_sent_at`; fixes reminders re-sending every automation-engine run |
| 0005 | `0005_studio_id.sql` | Restores `studio_id` on `leads`/`events` (was live UI, wrongly dropped earlier) |
| 0006 | `0006_signed_contracts_storage.sql` | Creates the `signed-contracts` Storage bucket (contract PDF downloads) |
| 0007 | `0007_media_uploads_storage.sql` | Creates the `media-uploads` Storage bucket + RLS policies (album/automation image uploads) |
| 0008–0015 | (see `supabase/migrations/`) | Service-role grants, questionnaire fields, social/creator contact, Morning dual-business, workspace/users, lead-status automation, VAT backfill, custom staff-message automation type |
| 0016 | `0016_google_calendar_accounts.sql` | Adds `google_calendar_accounts` + `event_calendar_syncs` tables (dual-account Google Calendar OAuth + per-event sync tracking), enables `pg_cron`/`pg_net` |
| 0017 | `0017_calendar_sync_trigger.sql` | Adds a trigger on `events` that automatically calls `calendar-sync-webhook` on every calendar-relevant change — no more manual "sync" clicks needed, see section 4.5 |

**CLI:**
```bash
supabase db push
```

**Or by hand:** open Supabase Dashboard → SQL Editor → paste each file's contents in
order (0004, then 0005, then 0006, then 0007) → Run. Confirm each succeeds before
running the next.

## 2. Deploy the Edge Functions

The full current list under `supabase/functions/` (deploy all of them — some are
brand new, some were edited this round, and it's safe/idempotent to redeploy ones
that didn't change):

```
approve-pending-automation, assign-studio-id-to-new-lead, assign-studio-ids,
automation-engine, calendar-sync-webhook, cancel-event, daily-event-brief,
delete-event-from-calendar, delete-google-calendar-event,
fix-missing-event-for-lead, get-lead-public, google-calendar-oauth-callback,
google-calendar-oauth-disconnect, google-calendar-oauth-start,
monthly-crew-schedule, reconcile-calendar-sync, save-signed-contract,
send-album-sketch, send-questionnaire-reminders, send-questionnaire-to-events,
send-staff-invite, send-staff-schedule-message, send-to-couple, send-to-editor,
send-whatsapp-message, share-event-info-with-team, sign-lead-public,
submit-production-questionnaire, sync-all-signed-leads, sync-event-to-calendar,
sync-lead-to-event, whatsapp-manager
```

**Important — `google-calendar-oauth-callback` and `calendar-sync-webhook` must both
deploy with `verify_jwt=false`.** Google's OAuth redirect hits the first with no
`Authorization` header at all, and the Postgres trigger (section 4.5) hits the
second the same way — neither can supply a Supabase user JWT. The platform's
default JWT check would 401 both before your code ever runs. This repo already has
a `supabase/config.toml` with:
```toml
[functions.google-calendar-oauth-callback]
verify_jwt = false

[functions.calendar-sync-webhook]
verify_jwt = false
```
The CLI reads this automatically on `supabase functions deploy`. If you ever deploy
either function by hand instead, pass `--no-verify-jwt` explicitly:
```bash
supabase functions deploy google-calendar-oauth-callback --no-verify-jwt
supabase functions deploy calendar-sync-webhook --no-verify-jwt
```

**CLI (deploys everything under `supabase/functions/` in one shot):**
```bash
supabase functions deploy
```

**Or by hand:** Dashboard → Edge Functions → New Function → paste each `index.ts`
(plus the `_shared/` files get bundled automatically if you use the CLI — doing this
fully by hand in the dashboard is painful for ~24 functions, the CLI is strongly
recommended here).

`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected
by the platform into every function's environment already — no manual secrets
needed for most of these. The Google Calendar functions are the exception; see
section 4 for the secrets they require.

## 3. Schedule `automation-engine` to actually run periodically

This is the one function nothing in the frontend calls on its own — it needs an
external trigger on a schedule (it processes due reminders, monthly summaries,
questionnaire nudges, etc). Two options:

**Option A — `pg_cron` (runs inside Postgres, simplest):**
In the SQL Editor:
```sql
select cron.schedule(
  'automation-engine-hourly',
  '0 * * * *',  -- every hour, on the hour — adjust to taste
  $$
  select net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/automation-engine',
    headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```
Requires the `pg_cron` and `pg_net` extensions enabled (Dashboard → Database →
Extensions). Put the real service-role key in place of `<SERVICE_ROLE_KEY>` — treat
it like a password, don't commit it anywhere.

**Option B — external scheduler** (e.g. a free cron-ping service, or GitHub Actions
on a schedule) that just does an authenticated `POST` to the same URL. Simpler to
set up outside the DB if you'd rather not touch `pg_cron`.

Either way — **pick one interval and stick to it**; running it too often just burns
function invocations for no benefit, since it only acts on things that are actually
due.

## 4. Google Calendar — OAuth setup, dual-account sync, and reconciliation cron

This is a full real Google OAuth integration (previous versions used a static,
manually-pasted access token that expired every hour and was never actually
working). It supports connecting **two independent Google accounts** per studio —
a primary and a backup — so every event gets pushed to both calendars, and a
dedicated in-app page (`/GoogleCalendarSync`, in the left nav as "📅 יומן Google")
shows connection status, sync health, and lets you retry failures or reconnect.
You'll need to do a one-time setup in Google Cloud Console since only you can
create OAuth credentials for your own Google account.

### 4.1 Create the Google Cloud OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a new
   project (or reuse an existing one) — e.g. "Avira Studio".
2. **Enable the API**: APIs & Services → Library → search "Google Calendar API" →
   Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen.
   - User type: **External** (unless you have a Google Workspace org — then Internal
     is simpler and skips the "unverified app" warning entirely).
   - Fill in app name, support email, developer contact email.
   - Scopes: add `https://www.googleapis.com/auth/calendar`.
   - **Test users**: add **both** Google account emails you plan to connect (the
     primary studio calendar account and the backup account). This step is required
     — without it, Google will refuse to let those accounts complete the OAuth flow
     at all while the app is unverified.
4. **Create credentials**: APIs & Services → Credentials → Create Credentials →
   OAuth client ID → Application type: **Web application**.
   - Name: anything, e.g. "Avira Studio Calendar Sync".
   - **Authorized redirect URIs** — add exactly this one URL:
     ```
     https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/google-calendar-oauth-callback
     ```
   - Save. Copy the **Client ID** and **Client Secret** shown — you'll need them in
     the next step.

### 4.2 Set the Edge Function secrets

```bash
supabase secrets set \
  GOOGLE_OAUTH_CLIENT_ID="<client id from step 4.1>" \
  GOOGLE_OAUTH_CLIENT_SECRET="<client secret from step 4.1>" \
  GOOGLE_OAUTH_STATE_SECRET="<any long random string, e.g. output of: openssl rand -hex 32>" \
  APP_BASE_URL="https://<your production frontend domain>" \
  CALENDAR_RECONCILE_CRON_SECRET="<another long random string>"
```

- `GOOGLE_OAUTH_STATE_SECRET` — HMAC-signs the OAuth `state` param so the callback
  can trust which tenant/account-role a redirect belongs to. Any random string
  works; generate one and never reuse it elsewhere.
- `APP_BASE_URL` — your live frontend origin (e.g. the Vercel production URL, no
  trailing slash). The OAuth callback redirects the browser back here to
  `/GoogleCalendarSync` when the connect flow finishes.
- `CALENDAR_RECONCILE_CRON_SECRET` — a separate secret only the cron job uses to
  call `reconcile-calendar-sync` without a user session (same pattern as
  `automation-engine`'s cron auth).

### 4.3 Deploy and connect

Make sure migration `0016` is applied (section 1) and all the Google Calendar
functions listed in section 2 are deployed, with `google-calendar-oauth-callback`
specifically deployed with `verify_jwt=false` (the `supabase/config.toml` in this
repo handles that automatically via the CLI).

Then, in the app: go to **📅 יומן Google** in the sidebar (or Settings →
Integrations → the Google Calendar card, which links there).
- Click "חבר חשבון" under **חשבון ראשי** (primary account) and complete Google's
  consent screen with your main studio Gmail.
- Click "חבר חשבון" under **חשבון גיבוי** (backup account) and complete it again
  with the **second, different** Google account — if you're already logged into the
  primary account in the same browser, explicitly click "Use another account" on
  Google's account chooser, otherwise Google will silently reuse the same session.
- Each card shows the connected email, lets you optionally set a non-default
  Calendar ID (leave as "primary" unless you want events to land in a secondary
  calendar within that Google account), and shows live status
  (מחובר / לא מחובר / נדרש חיבור מחדש / שגיאה).

From this point on, every event create/update/delete in the app automatically
pushes to both connected accounts in real time — no further action needed.

### 4.4 Schedule the reconciliation safety net

Real-time sync fires on every event change, but as a safety net (network blips,
briefly-expired tokens mid-write, etc.) there's also a `reconcile-calendar-sync`
function that re-scans for anything that fell through and retries it. Schedule it
similarly to `automation-engine` (section 3) — recommended every ~20 minutes, since
it's a backstop, not the primary sync path:

```sql
select cron.schedule(
  'calendar-reconcile-20min',
  '*/20 * * * *',
  $$
  select net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/reconcile-calendar-sync',
    headers := jsonb_build_object('x-cron-secret', '<CALENDAR_RECONCILE_CRON_SECRET value from step 4.2>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

Put the real `CALENDAR_RECONCILE_CRON_SECRET` value in place of the placeholder —
treat it like a password, don't commit it anywhere. Before trusting the schedule,
trigger it once manually to confirm it runs clean (either the "סנכרן הכל עכשיו"
button on `/GoogleCalendarSync`, which calls the same function authenticated, or
`supabase functions invoke reconcile-calendar-sync`).

### 4.5 Enable automatic sync on every event change (crew-complete color flip, lead auto-sync, etc.)

Migration `0017_calendar_sync_trigger.sql` (run as part of section 1) adds a
Postgres trigger on `events` that fires on every insert/update of
`couple_names`, `date`, `venue`, `phone_number`, `team`, `required_crew`, or
`notes`, and calls the new `calendar-sync-webhook` function via `pg_net`. This
is what makes the following fully automatic, with no button click needed:
- A lead reaching status "נסגר/חתימה" creates its event → calendar entry
  appears on both accounts within seconds.
- Assigning/removing crew from **any** screen (Staff Scheduling, the events
  table, Payments, etc.) → the calendar entry's color flips banana ⇄ basil the
  moment the crew becomes complete or incomplete again.
- Editing the couple's name, date, venue, phone, or notes anywhere → the
  calendar entry updates to match.

The trigger function itself needs the same `CALENDAR_RECONCILE_CRON_SECRET`
value used in step 4.4, but — like the two `cron.schedule` snippets above — the
migration file ships with a placeholder rather than a committed real secret.
**One-time step after running migration `0017`:** in the SQL Editor, run:

```sql
create or replace function public.trigger_calendar_sync_webhook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if  new.couple_names   is not distinct from old.couple_names
    and new.date           is not distinct from old.date
    and new.venue          is not distinct from old.venue
    and new.phone_number   is not distinct from old.phone_number
    and new.team           is not distinct from old.team
    and new.required_crew  is not distinct from old.required_crew
    and new.notes          is not distinct from old.notes
    then
      return new;
    end if;
  end if;

  perform net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/calendar-sync-webhook',
    headers := jsonb_build_object('x-cron-secret', '<CALENDAR_RECONCILE_CRON_SECRET value from step 4.2>', 'Content-Type', 'application/json'),
    body := jsonb_build_object('tenantId', new.tenant_id, 'eventId', new.id)
  );

  return new;
end;
$$;
```

This replaces only the function body (the `create trigger` itself, from the
migration, is left untouched and doesn't need re-running). Test it by
assigning staff to an event until the crew is full and confirming the Google
Calendar entry turns basil within a few seconds, with no manual sync click.

### 4.6 Optional cleanup — old static-token settings

The previous, non-functional static-token flow stored a couple of now-unused rows
in the generic `app_settings` table (`google_calendar_access_token`,
`google_calendar_id`). Nothing reads them anymore, so leaving them is harmless, but
if you want to tidy up:

```sql
delete from app_settings
where key in ('google_calendar_access_token', 'google_calendar_id');
```

### 4.7 Known limitation — unverified app warning

Until you submit the OAuth consent screen for Google's formal verification (a
review process, optional and only needed if you want to remove the warning
screen), every connect attempt will show an "unverified app" interstitial. As long
as both Google account emails were added as **Test users** in step 4.1, you can
click through it ("Advanced" → "Go to [app name] (unsafe)") and the connection will
work normally — this warning is cosmetic for accounts on the test-user list.

## 5. Sanity checklist after deploying

Go through these once, live, to confirm the deploy actually worked:

- [ ] Sign a test contract end-to-end at `/contract/:leadId` for a real lead → confirm
      the PDF actually appears at `leads.signed_contract_pdf_url` in the DB and the
      download link works from both the couple's success screen and the admin side
      (Events table / side panel).
- [ ] Fill out the questionnaire at `/questionnaire/:id` for a test lead → confirm it
      saves.
- [ ] In Settings → Integrations, fill in a real Green API Gateway URL + API Key, hit
      Save, then use the WhatsApp panel's "רענן חיבור" / test-send to confirm the
      connection actually works end-to-end.
- [ ] Open an event's detail modal (desktop table eye-icon or mobile card "פרטים") and
      send a test WhatsApp message from the "שלח הודעה לזוג" box — this was broken
      (dead Make.com call) until this session's fix; confirm it now actually sends.
- [ ] Upload an image in the album-reminder settings (Progress page) and in an
      automation's media field — both were silently broken until this session's fix;
      confirm the image actually uploads and shows a preview.
- [ ] Trigger `automation-engine` manually once (`supabase functions invoke
      automation-engine` or just call the URL) before trusting the cron schedule, to
      make sure it runs clean against real data first.
- [ ] Complete the Google Calendar setup in section 4, then on `/GoogleCalendarSync`:
      connect the primary account, confirm the card shows the connected email and
      "מחובר"; connect the backup account with a genuinely different Google login,
      confirm a second independent connection appears. Create or edit a real event
      and confirm it appears in **both** Google calendars within a few seconds, then
      delete it and confirm it's removed from both. Trigger "סנכרן הכל עכשיו" once
      manually before trusting the cron schedule from section 4.4.

## 6. Still NOT started (needs input only you can provide)

These are real, tracked gaps — not forgotten, just blocked on external
prerequisites:

- **Morning / Green Invoice** — 3 functions not ported yet
  (`generateMorningInvoice`, `checkMorningConnection`,
  `getLatestMorningDocumentDate`). The API key/secret fields already exist in
  Settings → Integrations; the backend just doesn't do anything with them yet.
- **AI-powered lead import from screenshot** (`LeadImageImportReviewDialog.jsx`) —
  needs a vision-capable LLM provider (Anthropic/OpenAI/Gemini) and an API key from
  you; currently silently broken (calls a `.integrations.InvokeLLM` that was never
  ported). Not started — needs a provider decision from you first. **Unrelated** to
  section 7 below — this is a separate, still-broken feature (parsing a screenshot
  into a new lead), not the chat assistant.

## 7. AI Assistant — Anthropic Claude setup

The floating "עוזר תפעולי AI" widget (bottom-right on every page) and the
read-only "שאל את יועץ המערכת" panel (System Advisor page) are now backed by a
real Claude-powered Edge Function (`supabase/functions/ai-assistant/index.ts`)
instead of the old unported Base44 stub. It answers questions over live
events/leads/staff data and can propose WhatsApp sends (raw-to-editor,
final-to-couple, or a free-form message) — every proposal always requires an
explicit click on "אשר ובצע" before anything is actually sent; the backend
itself never sends a WhatsApp message on its own (see the security comment at
the top of that file).

**7.1 Get an API key**

Sign up / log in at [console.anthropic.com](https://console.anthropic.com),
create an API key, and make sure the account has billing enabled — each chat
message can trigger **up to 6 internal Claude calls** (the tool-use loop cap,
`MAX_TOOL_ITERATIONS` in `ai-assistant/index.ts`), so keep that multiplier in
mind when watching usage on the Anthropic dashboard.

**7.2 Set the secret and deploy**

```bash
supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
# optional — override the default model without a code change:
# supabase secrets set ANTHROPIC_MODEL="claude-sonnet-4-5-20250929"

supabase db push          # applies 0025_ai_assistant_chat.sql (new ai_assistant_messages table)
supabase functions deploy ai-assistant
```

No `config.toml` entry is needed for this function — it's authenticated
(`verify_jwt` stays at its default `true`), same as every other non-public Edge
Function in this project.

**7.3 Optional — let individual studios (tenants) use their own Anthropic key**

The `ANTHROPIC_API_KEY` secret above is a single platform-wide fallback shared
by every tenant. Any tenant can optionally override it with their own key —
same pattern as the Green API / Morning credentials in Settings → אינטגרציות
(`tenant_secrets` table, admin-only RLS): a studio owner/admin opens Settings →
אינטגרציות → "עוזר AI — מפתח Anthropic אישי", pastes their own key from
console.anthropic.com, and saves. `supabase/functions/ai-assistant/index.ts`
looks up `tenant_secrets` for `key='anthropic_api_key'` on every request and
uses it instead of the platform key when present; if the field is left blank
(the default for every tenant, including ones created before this feature
existed), the platform-wide `ANTHROPIC_API_KEY` above keeps being used
automatically — no action required for tenants who don't care about separate
billing. No extra deploy step is needed for this — it's already live once
section 7.2 above is done, since `_shared/anthropic.ts`'s `callClaude()` reads
whichever key `ai-assistant/index.ts` resolved per-request, not a fixed value.

**7.4 Verify**

- Open the floating widget and ask something read-only, e.g. "כמה אירועים לא
  שולמו החודש?" — confirm you get a real, grounded Hebrew answer (not an error).
- Ask it to send something concrete, e.g. "שלח לעורך של \<שם זוג אמיתי\> את
  הגלם" — confirm a proposal card appears with the correct couple/editor name
  already resolved, click "אשר ובצע", and confirm the WhatsApp message actually
  arrives and the proposal flips to "בוצע בהצלחה". Refresh the page — confirm
  the executed state persists (proves the DB-backed history in
  `ai_assistant_messages` is working, not just in-memory state).
- In the System Advisor page's "שאל את יועץ המערכת" panel, ask the same
  send-something phrasing — confirm it never proposes an action there (it's
  wired with `readOnly: true`, which drops the action tools server-side, not
  just hides the button client-side).
- Fire off >20 messages in under a minute from one user — confirm the 21st is
  rejected with a Hebrew rate-limit message instead of hitting the Anthropic API
  (per-user limit, `_shared/rateLimit.ts`'s `checkRateLimitForKey`).
- Per-tenant override (7.3): as owner/admin, paste a *different* valid Anthropic
  key into Settings → אינטגרציות → "עוזר AI", save, and ask the widget a
  question — confirm it still answers correctly (now billed to that tenant's
  own Anthropic account instead of the platform one). Clear the field and save
  again — confirm it falls back to working via the platform-wide key with no
  error.
