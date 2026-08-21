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

First set a dedicated cron secret (the function's own code requires this header
whenever the caller isn't a real logged-in user — a bare service-role Bearer token
alone is **not** enough, since `getRequestUser` rejects it as not being a real user
session):
```bash
supabase secrets set AUTOMATION_ENGINE_CRON_SECRET="<any long random string, e.g. output of: openssl rand -hex 32>"
```

Then, in the SQL Editor:
```sql
select cron.schedule(
  'automation-engine-hourly',
  '0 * * * *',  -- every hour, on the hour — adjust to taste
  $$
  select net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/automation-engine',
    headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'x-cron-secret', '<AUTOMATION_ENGINE_CRON_SECRET value from above>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```
Requires the `pg_cron` and `pg_net` extensions enabled (Dashboard → Database →
Extensions). Put the real service-role key in place of `<SERVICE_ROLE_KEY>` — treat
it like a password, don't commit it anywhere.

**Important — both headers are required, not just one:** `automation-engine` has
`verify_jwt = true` (the default — it's not listed in `supabase/config.toml`), so
the `Authorization: Bearer <SERVICE_ROLE_KEY>` header is what gets the request past
the platform gateway itself; but a service-role key resolves to no real
`auth.users` row, so the function's own internal `getRequestUser` check treats it
as "no user" and then falls through to requiring the separate `x-cron-secret`
header to match `AUTOMATION_ENGINE_CRON_SECRET`. Missing either header means every
scheduled run silently 401s forever with no visible symptom other than "the
automation just never sends" — this exact gap was found and fixed in production on
2026-08-19; if you're re-provisioning a new environment from this file, make sure
you copy the full command above, not an older version with only one header.

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
    headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'x-cron-secret', '<CALENDAR_RECONCILE_CRON_SECRET value from step 4.2>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```
**Both headers are required, not just `x-cron-secret`** — `reconcile-calendar-sync`
is not listed in `supabase/config.toml`'s `verify_jwt = false` exceptions, so it
defaults to `verify_jwt = true`: the Supabase platform gateway itself rejects any
request with no `Authorization` header at all before the function's own
`x-cron-secret` check ever runs. An earlier version of this snippet omitted the
`Authorization` header, which caused the reconciliation safety net to silently
401 on every single 20-minute run — found and fixed in production on 2026-08-19.

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

## 8. Notifications — contract-signed WhatsApp + in-app alert

New: whenever a lead's contract gets signed (either via the public couple-facing
link, or the internal manual-sign dialog in the Leads page), the system now
automatically (a) sends a WhatsApp message to one fixed number you configure, and
(b) shows an in-app notification (bell icon, top of the sidebar/header) to every
owner/admin/studio_manager user. v1 scope is contract-signed only — no other
trigger events yet.

Same trigger architecture as the Google Calendar auto-sync in section 4.5: a
Postgres trigger on `leads.signed_at` (migration
`0026_notifications_trigger.sql`) fires a `pg_net` webhook to a new
`contract-signed-webhook` Edge Function — this is what makes it fire regardless
of which of the two signing flows was used, with no per-flow code changes needed.

**8.1 Set the secret and deploy**

```bash
supabase secrets set CONTRACT_NOTIFICATION_CRON_SECRET="<a long random string, e.g. output of: openssl rand -hex 32>"

supabase db push                              # applies 0026_notifications_trigger.sql (new notifications table + trigger)
supabase functions deploy contract-signed-webhook
```

`contract-signed-webhook` is deployed with `verify_jwt=false` (handled
automatically by this repo's `supabase/config.toml`) — like `calendar-sync-webhook`,
it's called by a DB trigger with no user session, so it authenticates itself via
the `x-cron-secret` header instead, checked against `CONTRACT_NOTIFICATION_CRON_SECRET`.

**8.2 One-time step after running the migration — paste the real secret into the trigger**

Like `CALENDAR_RECONCILE_CRON_SECRET` in section 4.5, the migration file ships
with a placeholder rather than a committed real secret (never commit a real
secret to a migration file). In the Supabase SQL Editor, run:

```sql
create or replace function public.trigger_contract_signed_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notif_title text;
  notif_body text;
begin
  if new.signed_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.signed_at is not distinct from new.signed_at then
    return new;
  end if;

  notif_title := 'חוזה נחתם: ' || coalesce(new.couple_names, 'ליד ללא שם');
  notif_body := coalesce(new.couple_names, 'ליד ללא שם')
    || case when new.venue_name is not null then ' · ' || new.venue_name else '' end
    || case when new.event_date is not null then ' · ' || to_char(new.event_date, 'DD/MM/YYYY') else '' end;

  insert into notifications (tenant_id, type, title, body, related_lead_id)
  values (new.tenant_id, 'contract_signed', notif_title, notif_body, new.id);

  perform net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/contract-signed-webhook',
    headers := jsonb_build_object('x-cron-secret', '<CONTRACT_NOTIFICATION_CRON_SECRET value from step 8.1>', 'Content-Type', 'application/json'),
    body := jsonb_build_object('tenantId', new.tenant_id, 'leadId', new.id)
  );

  return new;
end;
$$;
```

This replaces only the function body (the `create trigger` itself, from the
migration, is left untouched and doesn't need re-running).

**8.3 Configure the WhatsApp number**

In the app: Settings → **התראות**, fill in the phone number that should receive
contract-signed WhatsApp alerts, and save. This is a single fixed number for the
whole tenant (not tied to any particular user's own profile) — stored in
`app_settings` (key `notification_phone_number`), same non-secret tier as the
WhatsApp gateway URL/instance ID. If left blank, the in-app notification still
fires normally; only the WhatsApp send is skipped.

**8.4 Verify**

- Sign a test lead's contract via the public link (`/contract/:leadId`) —
  confirm within a few seconds: (a) a WhatsApp message arrives at the configured
  number with the couple's name/venue/date, and (b) the bell icon in the app
  shows an unread badge for an owner/admin/studio_manager user, with the same
  details.
- Sign a different test lead via the internal manual-sign dialog (Leads page →
  a lead's "חוזה" button) — confirm the same happens, proving the trigger
  covers both signing paths, not just the public one.
- As a non-admin role (photographer/editor/album_manager), confirm the bell
  either doesn't render or shows nothing (RLS on `notifications` is
  admin-only — matches `tenant_secrets`'s pattern).
- Click a notification in the bell dropdown — confirm it's marked read (badge
  count decreases), and confirm "סמן הכל כנקרא" clears all unread state.
- Leave `notification_phone_number` blank for a tenant, sign a contract, confirm
  the in-app notification still appears with no error (WhatsApp send is skipped
  silently, per 8.3).

## 9. Monthly events backup — "safety net" email + on-demand PDF

New: a "safety net" so the studio owner always has a recent, offline-readable
copy of "what's coming up and who's on each event," even if the live system is
ever unreachable. Two halves:

- **Manual, on-demand:** Settings → ייבוא/ייצוא (`data` tab) → "הורד רשימת גיבוי
  מלאה (PDF)" button. Generates a real PDF, client-side in the browser (same
  html2canvas + jsPDF pattern already used for signed contracts), listing every
  upcoming event with date, couple, venue, phone, and the full assigned team.
  No deployment needed for this half — it's pure frontend, ships with the
  regular `vercel deploy`.
- **Automatic, monthly:** a `monthly-events-backup` Edge Function, scheduled
  via `pg_cron`, emails the same information (date/couple/venue/phone/team for
  every upcoming event) as one HTML email to the address configured in
  Settings → התראות → "גיבוי חודשי של אירועים — במייל" (`app_settings` key
  `events_backup_email` — separate from `notification_phone_number`).

**Why email, not WhatsApp, for the automatic half:** an earlier version of
this sent a weekly WhatsApp text via Green API instead. Reverted per explicit
user request — a large recurring automated message through Green API risks
the studio's WhatsApp number getting flagged/blocked by WhatsApp, unlike the
low-volume, event-triggered contract-signed alert in section 8. Email carries
no such risk, and unlike the earlier WhatsApp version, needs no
message-splitting — one email holds the whole list as real HTML (Hebrew
renders fine here; the "no Hebrew-capable PDF library in Deno" limitation
from section 9's original design is specific to generating an actual **PDF
file** server-side, not to HTML email text — which is why the manual button
above still does its PDF generation client-side in the browser, and the
automatic email is HTML body text, not a PDF attachment).

**Email provider: Resend**, called via plain `fetch` from
`supabase/functions/_shared/email.ts` (no SDK, matching this codebase's style
for every other external API). Uses Resend's shared sandbox sender
(`onboarding@resend.dev`) by default, which requires **zero domain setup** but
only delivers to the email address that owns the Resend account — this is
fine for this feature's actual use case (the studio owner receiving their own
monthly backup at the same address they signed up with). If you ever need
this to reach a different/additional address, verify a real sending domain in
the Resend dashboard and set the `RESEND_FROM_EMAIL` secret to an address on
that domain.

**9.1 Get a Resend API key and set secrets**

1. Sign up free at [resend.com](https://resend.com) (no credit card required
   for the free tier — 3,000 emails/month).
2. In the Resend dashboard → API Keys → create a new key, copy it.
3. Set the secrets and deploy:

```bash
supabase secrets set RESEND_API_KEY="<the key from resend.com>"
supabase secrets set MONTHLY_EVENTS_BACKUP_CRON_SECRET="<a long random string, e.g. output of: openssl rand -hex 32>"

supabase functions deploy monthly-events-backup
```

`monthly-events-backup` is deployed with `verify_jwt=false` (handled
automatically by this repo's `supabase/config.toml`) — like
`contract-signed-webhook`, it's called by `pg_cron` with no user session, so it
authenticates itself via the `x-cron-secret` header instead, checked against
`MONTHLY_EVENTS_BACKUP_CRON_SECRET`. Since it's listed in the `verify_jwt=false`
exceptions, only the `x-cron-secret` header is required — no `Authorization`
header needed (unlike `reconcile-calendar-sync` in section 4.4, which is not on
that exceptions list).

**9.2 Schedule the monthly run**

In the Supabase SQL Editor, run once (put the real
`MONTHLY_EVENTS_BACKUP_CRON_SECRET` value from 9.1 in place of the placeholder —
treat it like a password, don't commit it anywhere):

```sql
select cron.schedule(
  'monthly-events-backup',
  '0 6 1 * *',  -- 06:00 UTC on the 1st of every month = ~08:00/09:00 Israel time
  $$
  select net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/monthly-events-backup',
    headers := jsonb_build_object('x-cron-secret', '<MONTHLY_EVENTS_BACKUP_CRON_SECRET value from step 9.1>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

Adjust the day/hour in the cron expression to taste (`pg_cron` runs in UTC, so
Israel time is UTC+2 in winter / UTC+3 in summer). Before trusting the
schedule, trigger it once manually to confirm it runs clean:

```bash
curl -X POST 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/monthly-events-backup' \
  -H 'x-cron-secret: <MONTHLY_EVENTS_BACKUP_CRON_SECRET value from step 9.1>'
```

**9.3 Configure the backup email address**

In the app: Settings → **התראות**, second card "גיבוי חודשי של אירועים —
במייל", fill in the email address that should receive the monthly backup, and
save — stored in `app_settings` (key `events_backup_email`), same non-secret
tier as `notification_phone_number`. If left blank, the function skips that
tenant cleanly (no error, just a "no events_backup_email configured" log
line).

**9.4 Verify**

- After the manual `curl` test above, confirm one email arrives at the
  configured `events_backup_email`, listing every upcoming event with
  couple/date/venue/phone/team, formatted as HTML.
- If `events_backup_email` is blank for a tenant, confirm the function skips
  that tenant cleanly (check the function logs for
  `"no events_backup_email configured"`) rather than erroring.
- If a tenant has zero upcoming events, confirm it's skipped cleanly too
  (`"no upcoming events"` in the logs) — no empty email sent.
- Click the manual "הורד רשימת גיבוי מלאה (PDF)" button in Settings and confirm
  a real PDF downloads with the same event details, independent of the email
  automation.

**9.5 Migrating off the old weekly WhatsApp version**

If `WEEKLY_EVENTS_BACKUP_CRON_SECRET`/the `weekly-events-backup` function/its
`weekly-events-backup` cron job were ever actually deployed and scheduled
before this section was rewritten, clean them up once:

```sql
select cron.unschedule('weekly-events-backup');  -- no-op / harmless if it was never scheduled
```

```bash
supabase functions delete weekly-events-backup   -- no-op / harmless if it was never deployed
supabase secrets unset WEEKLY_EVENTS_BACKUP_CRON_SECRET
```

## 10. Disaster Recovery Runbook — backup inventory, restore procedure, and test drill results

This section documents, honestly and as of 2026-08-21, what backup/restore
capability actually exists in this system today, how to actually restore data
if something goes wrong, and the results of a real end-to-end test drill
performed against the live production database to prove the procedure works
— not just a theoretical writeup.

### 10.1 What backup capability actually exists today (verified against the code)

| Mechanism | Covers | Status | Where |
|---|---|---|---|
| On-demand PDF export | All events (couple/date/venue/phone/team) | **Live, deployed, needs no setup** | Settings → ייבוא/ייצוא → "הורד רשימת גיבוי מלאה (PDF)" button (`src/lib/eventsBackupPdf.js`) |
| CSV export — Events | All events, all columns | **Live, deployed** | Settings → data tab |
| CSV export — Staff | All staff members | **Live, deployed** | Settings → data tab |
| CSV import (restore) — Events | Recreates event rows from a CSV | **Live, deployed** | `src/components/events/CSVImportDialog.jsx`, Settings → data tab |
| CSV import (restore) — Staff | Recreates staff rows from a CSV | **Live, deployed** | `src/components/settings/StaffImportDialog.jsx` |
| CSV import (restore) — Leads | Recreates lead rows from a CSV | **Live, deployed** | `src/components/leads/LeadCSVImportDialog.jsx` |
| CSV export — Leads | — | **Does not exist.** Leads can be imported but not exported today. | — (gap, see 10.4) |
| Monthly automated email backup | All upcoming events, sent to a configured address every month | **Code-complete, NOT yet deployed** — `RESEND_API_KEY`/`MONTHLY_EVENTS_BACKUP_CRON_SECRET` secrets, `supabase functions deploy monthly-events-backup`, and the one-time `cron.schedule(...)` step in section 9.2 above have not been executed yet. Uncommitted in git as of this writing. | `supabase/functions/monthly-events-backup/`, section 9 above |
| Supabase platform-level backups (PITR, automatic snapshots, Storage versioning) | Whatever Supabase's own plan tier provides | **Not documented or configured anywhere in this repo.** Whether Point-In-Time-Recovery is enabled depends entirely on the Supabase project's billing plan, set directly in the Supabase dashboard — outside this codebase. **Action item: check the Supabase dashboard → Database → Backups tab directly and note the plan's actual PITR/backup retention window here once confirmed.** | Supabase dashboard, not this repo |

**Important distinction:** the CSV export→import round trip is **not a
byte-for-byte restore** — confirmed via code read of all 3 import dialogs
(`CSVImportDialog.jsx`, `StaffImportDialog.jsx`, `LeadCSVImportDialog.jsx`):
every import path calls `.create()`, which always generates a **fresh** row
`id` (UUID) on restore. Field *values* (couple names, dates, prices, team
assignments, etc.) are fully preserved; the original primary key is not.
Anything that referenced the old `id` directly (e.g. a Google Calendar sync
row, a public token link tied to that specific event) would need to be
re-created/re-synced after a CSV-based restore — this is expected and
matches how every CSV-based restore in this app has always worked, not a new
limitation introduced by this runbook.

### 10.2 Restore procedure (what to actually do if data is lost)

**Scenario: some or all events/staff/leads data is lost or corrupted.**

1. **Stop.** Before restoring anything, confirm the actual scope of data loss
   (which tenant, which table, which date range) — don't restore blind.
2. **Locate the most recent backup available**:
   - Check for the most recent PDF export (Settings → ייבוא/ייצוא) if one was
     manually downloaded and saved somewhere (email, local disk, cloud
     drive) — this is a read reference only, not directly re-importable
     (PDF, not CSV).
   - Check for the most recent CSV export (Settings → data tab), same
     manual-download caveat.
   - Check the monthly email backup inbox (`events_backup_email`, section
     9.3) **once that feature is actually deployed** (see 10.1 gap above) —
     until then, this source does not exist yet.
   - As a last resort, check the Supabase dashboard's own backup/PITR tab if
     the project's plan tier includes it (see 10.1) — this can restore the
     entire database to a point in time, but is an all-or-nothing operation
     at the infrastructure level, not a per-record restore; only use this if
     app-level CSV/PDF backups are unavailable or insufficient.
3. **Restore via CSV import**, per table, in this order (respects foreign-key
   dependencies — staff and packages should exist before events reference
   them):
   - Staff: Settings → data tab → import staff CSV.
   - Leads: Leads page → import leads CSV (if leads were also lost).
   - Events: Settings → data tab → import events CSV.
4. **Verify** the restored records against whatever reference backup (PDF,
   email, or memory of the missing data) is available — spot-check a handful
   of couple names/dates/amounts, not just row counts.
5. **Re-link anything keyed to the old row IDs**, since restored rows get new
   IDs (see the "important distinction" note in 10.1): re-run Google Calendar
   sync for restored events (existing "sync to calendar" action already
   handles create-if-missing), regenerate any public links that were tied to
   the old event/lead ID (contract link, questionnaire link, album portal
   link if applicable).
6. **Document the incident** — what was lost, when, how it was restored, and
   what backup source was used — so gaps in the backup story (like the ones
   listed in 10.4) get prioritized based on real incidents, not just theory.

### 10.3 Test restore drill — performed 2026-08-21, results

A real restore was tested end-to-end against the live, linked production
Supabase project (`yzurelfhjkgqrluifszz`) to confirm the procedure in 10.2
actually works, not just that it reads plausibly. Performed via direct SQL
(`supabase db query --linked`) rather than a full browser UI walkthrough,
since no browser/computer-use tool access was available in this session —
the SQL operations mirror exactly what the CSV import/export code path does
(`.create()` with fresh IDs, full field-value preservation), so this is a
faithful simulation of the real restore procedure, not a shortcut around it.

**Steps performed:**

1. **Simulated "having a backup"**: inserted a synthetic, clearly-marked test
   event into the real `events` table — `id = 27a2fed9-a43f-4927-ab1a-ee9909929649`,
   `couple_names = '__DR_TEST__ בדיקת שחזור - אל תיגע'`, tenant
   `708d9428-f1df-4b8f-86c5-4ef84a161f2b` (the studio's real, only tenant) —
   with a full set of realistic field values (date, venue, phone, team JSON,
   pricing/VAT fields, payment status). The returned row served as the
   "captured backup" data.
   - One real issue was hit and fixed here: the first insert attempt used
     `client_payment_status = 'ממתין לתשלום'` and failed with Postgres error
     `23514` (check constraint violation). Queried the actual constraint
     definition and found the real allowed values are `'Paid' |
     'Partially Paid' | 'Unpaid'` (not free-text Hebrew) — corrected to
     `'Unpaid'` and the insert succeeded. This is a useful finding on its own:
     **any future CSV restore must use these exact English constraint
     values for `client_payment_status`**, not Hebrew display labels.
2. **Simulated data loss**: deleted that row, then ran a `SELECT` confirming
   zero rows matched — i.e., genuinely gone, not just hidden.
3. **Simulated the restore**: inserted a **new** row (`id =
   af1309fa-a057-4b7e-b81d-4f4b65f06f54` — deliberately a different UUID,
   matching exactly how the real CSV importers behave via `.create()`) using
   the exact field values captured in step 1, including recomputing the
   derived financial fields (`vatable_amount = round(gross / 1.18, 2)`,
   `vat_amount = round(gross - gross/1.18, 2)`) the same way the app's own
   `calculateEventFinancials()` logic does during a real import — not just
   copying numbers blindly.
4. **Verified**: compared the restored row's values against the originally
   captured values field-for-field — **exact match** on every field except
   `id` (expected and correct, per the "important distinction" in 10.1).
5. **Cleaned up**: deleted the restored test row, then ran
   `select count(*) from events where couple_names like '%DR_TEST%';` —
   returned `count = 0`, confirming **zero trace** was left in production
   data after the drill.

**Result: PASS.** The restore procedure in 10.2 (recreate rows from captured
field values, accept new IDs, recompute derived fields) works correctly
against the real production schema and constraints, and leaves no residue
when cleaned up properly.

**Caveat, stated plainly:** this drill exercised the *data-restoration logic*
directly at the database level, which is the part of the CSV import pipeline
that actually matters for data integrity. It did **not** click through the
actual Settings → data tab UI/file-upload flow in a browser, since no browser
tool was available this session. Recommended follow-up: once convenient,
someone should do one real click-through of an actual CSV export → import
round trip in the live app UI (not SQL) to confirm the UI layer itself has no
separate bugs (e.g. a CSV-parsing edge case) — this drill proves the backend
logic is sound, not that the file-upload UI has zero bugs of its own.

### 10.4 Known gaps and recommendations

1. **No Leads CSV export exists** — leads can be restored from a CSV but
   never exported to one in the first place. If leads data is lost with no
   external backup, there is currently no in-app way to have had a backup of
   it at all. Recommend adding a "export leads CSV" button mirroring the
   existing events/staff export buttons.
2. **Monthly automated email backup is code-complete but not deployed** —
   the single highest-value fix available right now, since it's already
   built (see section 9 above) and just needs the deploy steps in 9.1-9.2
   run once. Until deployed, the only backups that exist are whichever manual
   PDF/CSV exports someone happened to download and save externally.
3. **No documented Supabase-platform-level backup/PITR configuration** — this
   should be checked directly in the Supabase dashboard (Database → Backups)
   and the actual retention window recorded here, since it may already
   provide a safety net independent of anything in this app's own code.
4. **No automated recurring test-restore drill** — this runbook's drill was a
   one-time manual exercise. Recommend repeating a lightweight version of
   10.3 (or the real UI click-through follow-up noted above) after any future
   schema migration that touches the `events`/`staff_members`/`leads` tables,
   since a constraint change (like the exact one caught in step 1 above) is
   precisely the kind of thing that can silently break a restore path.


