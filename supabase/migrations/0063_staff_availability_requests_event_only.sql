-- "Find a replacement" from an EVENT (2026-09-15).
--
-- The staff-availability flow (0041) is lead-centric: lead_id is NOT NULL, so a booked
-- event whose lead was never linked (imports, old data) cannot ask anyone "are you
-- free?". The owner's request — a photographer drops out, one click asks everyone in
-- that role for that date — starts from the event, so the request must be able to
-- stand on an event alone. lead_id stays when the event has one (the bell's deep link
-- into the lead depends on it); the CHECK keeps a row from being orphaned from both.
alter table staff_availability_requests alter column lead_id drop not null;

alter table staff_availability_requests
  drop constraint if exists staff_availability_requests_lead_or_event_check;
alter table staff_availability_requests
  add constraint staff_availability_requests_lead_or_event_check
  check (lead_id is not null or event_id is not null);

create index if not exists staff_availability_requests_event_idx
  on staff_availability_requests(tenant_id, event_id)
  where event_id is not null;
