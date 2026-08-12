-- Restores the human-readable sequential "studio ID" reference number that
-- src/pages/Leads.jsx, src/pages/Events.jsx, src/components/leads/LeadFormDialog.jsx,
-- src/components/events/EventsTableWithBulkDelete.jsx, and
-- src/components/calendar/SyncStatusTable.jsx all display (`lead.studio_id` /
-- `event.studio_id`), and that base44/functions/assignStudioIds,
-- assignStudioIdToNewLead, and fixMissingEventForLead all read/write.
--
-- This column was dropped when supabase/functions/sync-lead-to-event was first
-- ported (0001_init.sql never had it) because at the time it looked unused by any
-- linking logic — real Lead<->Event linking uses source_lead_id/linked_event_id,
-- never studio_id. But it turned out to still be a live, user-facing display field,
-- so it needs to come back for the assignStudioIds-family functions to have
-- somewhere to write.
--
-- Scoped per-tenant (not globally unique) since this schema is multi-tenant and the
-- original single-tenant app's "one global counter" behavior doesn't generalize.
alter table leads add column if not exists studio_id integer;
alter table events add column if not exists studio_id integer;

create index if not exists leads_studio_id_idx on leads(tenant_id, studio_id);
create index if not exists events_studio_id_idx on events(tenant_id, studio_id);
