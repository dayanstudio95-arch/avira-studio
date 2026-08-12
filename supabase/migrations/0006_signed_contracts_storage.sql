-- Storage bucket for signed contract PDFs.
--
-- Context: ContractPage.jsx (public, unauthenticated /contract/:leadId route) lets a
-- couple digitally sign their contract; the generated PDF previously tried to upload via
-- `base44.integrations.Core.UploadFile`, which was never ported to Supabase and silently
-- failed (fire-and-forget .catch(console.error)), so `leads.signed_contract_pdf_url` was
-- never actually populated in production. Fixed alongside this migration by having the
-- `save-signed-contract` Edge Function accept the PDF bytes directly and upload them here
-- using the service-role client (bypasses RLS entirely) instead of relying on a client-side
-- upload from the anon/unauthenticated couple's browser.
--
-- Bucket is public (public=true) so the admin side's plain `<a href={signedContractPdfUrl}>`
-- links (UnifiedSidePanel.jsx, EventsTableWithBulkDelete.jsx) and the couple's own
-- post-sign download link work with a stable URL and no signed-URL refresh logic needed —
-- consistent with how those call sites already expect a directly fetchable URL.
--
-- No storage.objects RLS policies are added for INSERT: the only writer is the
-- `save-signed-contract` Edge Function using `createServiceRoleClient()`, which bypasses
-- RLS entirely. Since storage.objects has RLS enabled with no permissive policy for
-- anon/authenticated INSERT, direct client-side uploads to this bucket are correctly
-- denied by default — all writes must go through the Edge Function.
insert into storage.buckets (id, name, public)
values ('signed-contracts', 'signed-contracts', true)
on conflict (id) do nothing;
