-- In-app + WhatsApp notifications, v1 scope: contract-signed only (per user's explicit
-- choice among contract-signed / payment-received / questionnaire-filled / new-lead).
-- Reuses the exact architecture already proven for Google Calendar auto-sync
-- (0017_calendar_sync_trigger.sql): a DB trigger watching the one column both signing
-- flows reliably set, rather than patching every call site individually.
--
-- Both contract-signing paths set leads.signed_at:
--   - Public link flow: supabase/functions/sign-lead-public/index.ts (status='חוזה')
--   - Internal manual flow: src/components/leads/LeadContractDialog.jsx (status='נסגר/חתימה',
--     writes directly via base44.entities.Lead.update() — no edge function)
-- Despite the different `status` values, both reliably set `signed_at`, confirmed via
-- grep as the only two writers of that column — making it a future-proof single trigger
-- point, same reasoning as the calendar-sync trigger's Gap 3 addendum.
--
-- In-app visibility: owner/admin/studio_manager only (per user's choice) — mirrors the
-- ADMIN_ROLES-gated policy pattern already used for tenant_secrets (0019) and
-- google_calendar_accounts (0019).

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  related_lead_id uuid references leads(id) on delete set null,
  is_read boolean not null default false,
  read_by uuid references profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_tenant_created_idx on notifications(tenant_id, created_at desc);
create index notifications_tenant_unread_idx on notifications(tenant_id, is_read) where is_read = false;

alter table notifications enable row level security;

-- Same ADMIN_ROLES-only pattern as tenant_secrets_admin_only (0019_tenant_secrets.sql) —
-- notifications commonly carry business-sensitive context (couple names, lead ids), so
-- non-admin roles (photographer/editor/album_manager) should not see them, matching the
-- user's explicit choice of who should see in-app notifications.
create policy notifications_admin_only on notifications
  for all
  using (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  )
  with check (
    tenant_id = current_tenant_id()
    and exists (select 1 from profiles where id = auth.uid() and role in ('owner', 'admin', 'studio_manager'))
  );

-- 0002_grants.sql / 0008_service_role_grants.sql granted privileges on "all tables in
-- schema public" as one-time snapshots (not `alter default privileges`) — this new
-- table needs its own explicit grants, same reasoning as every table added since 0016.
grant select, insert, update, delete on notifications to authenticated;
grant select, insert, update, delete on notifications to service_role;

-- Trigger function: fires after a lead's signed_at is newly set (insert with signed_at
-- already populated, or update where it was null/different before). Does two things:
--   1. Inserts the in-app notification row directly (service definer, bypasses RLS —
--      needed since this can fire from either an authenticated user session or a
--      service-role caller, and either way the row must be visible to admin roles).
--   2. Fires a best-effort async webhook (pg_net) to send the WhatsApp copy, same
--      fire-and-forget pattern as trigger_calendar_sync_webhook (0017) — a failure here
--      must never block the lead update that triggered it.
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

  -- Placeholder secret — replaced via a one-time `create or replace function` paste
  -- through the Supabase SQL Editor after `db push`, same convention already used for
  -- CALENDAR_RECONCILE_CRON_SECRET / AUTOMATION_ENGINE_CRON_SECRET (see DEPLOYMENT.md).
  perform net.http_post(
    url := 'https://yzurelfhjkgqrluifszz.supabase.co/functions/v1/contract-signed-webhook',
    headers := jsonb_build_object(
      'x-cron-secret', 'REPLACE_WITH_CONTRACT_NOTIFICATION_CRON_SECRET',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('tenantId', new.tenant_id, 'leadId', new.id)
  );

  return new;
end;
$$;

drop trigger if exists contract_signed_notification_trigger on public.leads;
create trigger contract_signed_notification_trigger
  after insert or update of signed_at
  on public.leads
  for each row
  execute function public.trigger_contract_signed_notification();
