-- More WhatsApp numbers of one team member (Avira, 2026-11-02, the owner's request): a photographer writes from a
-- personal number and sends invoices from a business one (WhatsApp Business). The staff-invoices scan and the chat's
-- staff panel recognise him by any of them. Only adds; staff_members keeps its grants.
alter table public.staff_members
  add column if not exists extra_phones text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_members_extra_phones_check') then
    alter table public.staff_members add constraint staff_members_extra_phones_check check (cardinality(extra_phones) <= 5);
  end if;
end $$;
