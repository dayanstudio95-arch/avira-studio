# Avira Studio — Deployment Guide (Supabase backend)

This app was rebuilt off Base44 onto Supabase (Postgres + Auth + Storage + Edge
Functions). This doc is the checklist for getting a fresh clone of this repo (or
this repo after a pull with new commits) actually **live** against your Supabase
project. There's no CI/CD wired up yet — everything below is manual, once.

You already have a live Supabase project (`yzurelfhjkgqrluifszz.supabase.co`) with
migrations `0001`–`0003` applied and Phase 1/2 (auth + entities) verified working.
What's below is what's **new and not yet applied**: migrations `0004`–`0007` and a
batch of new/edited Edge Functions.

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

Six migrations exist beyond what you've already run. **Run them in numeric order** —
each may depend on tables/columns from the previous one.

| # | File | What it does |
|---|------|---------------|
| 0004 | `0004_lead_questionnaire_reminder.sql` | Adds `leads.questionnaire_reminder_sent_at`; fixes reminders re-sending every automation-engine run |
| 0005 | `0005_studio_id.sql` | Restores `studio_id` on `leads`/`events` (was live UI, wrongly dropped earlier) |
| 0006 | `0006_signed_contracts_storage.sql` | Creates the `signed-contracts` Storage bucket (contract PDF downloads) |
| 0007 | `0007_media_uploads_storage.sql` | Creates the `media-uploads` Storage bucket + RLS policies (album/automation image uploads) |

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
automation-engine, cancel-event, daily-event-brief, fix-missing-event-for-lead,
get-lead-public, monthly-crew-schedule, save-signed-contract,
send-album-sketch, send-questionnaire-reminders, send-questionnaire-to-events,
send-staff-invite, send-staff-schedule-message, send-to-couple, send-to-editor,
send-whatsapp-message, share-event-info-with-team, sign-lead-public,
submit-production-questionnaire, sync-all-signed-leads, sync-event-to-calendar,
sync-lead-to-event, whatsapp-manager
```

**CLI (deploys everything under `supabase/functions/` in one shot):**
```bash
supabase functions deploy
```

**Or by hand:** Dashboard → Edge Functions → New Function → paste each `index.ts`
(plus the `_shared/` files get bundled automatically if you use the CLI — doing this
fully by hand in the dashboard is painful for ~24 functions, the CLI is strongly
recommended here).

No manual secrets are needed for these — `SUPABASE_URL` /
`SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the platform
into every function's environment already.

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

## 4. Sanity checklist after deploying

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

## 5. Still NOT started (needs input only you can provide)

These are real, tracked gaps — not forgotten, just blocked on external
prerequisites:

- **Google Calendar OAuth** — needs a Google Cloud OAuth client (`client_id` +
  `client_secret`) that only you can create in Google Cloud Console. No real connect
  flow exists yet; today it's a static token pasted into `app_settings` with no UI to
  obtain it.
- **Morning / Green Invoice** — 3 functions not ported yet
  (`generateMorningInvoice`, `checkMorningConnection`,
  `getLatestMorningDocumentDate`). The API key/secret fields already exist in
  Settings → Integrations; the backend just doesn't do anything with them yet.
- **AI-powered lead import from screenshot** (`LeadImageImportReviewDialog.jsx`) —
  needs a vision-capable LLM provider (Anthropic/OpenAI/Gemini) and an API key from
  you; currently silently broken (calls a `.integrations.InvokeLLM` that was never
  ported). Not started — needs a provider decision from you first.
