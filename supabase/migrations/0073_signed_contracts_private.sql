-- PII-02 (audit 2026-10-05): signed contracts are private.
--
-- The `signed-contracts` bucket (0006) was public, so every signed contract PDF — full
-- name, ID number, signature, price — was readable forever by anyone holding its URL
-- (leads.signed_contract_pdf_url). Now the bucket is private:
--   * the couple gets a 1-hour signed URL from get-lead-public / save-signed-contract;
--   * the studio's admins open a 5-minute signed URL (src/lib/signedContract.js), allowed by
--     the policy below: owner/admin/studio_manager, and only for a lead of their own studio
--     (the object path starts with the lead id — no tenant folder, so the lead is looked up);
--   * writes stay service-role only (no insert/update/delete policy), as before.
-- No file is moved and no row changes. Run AFTER the functions + frontend that sign URLs are
-- live (signed URLs also work on a public bucket, so that order never breaks a link).
-- Rollback: audit-reports/rollback/0073_rollback.sql. Re-runnable.

update storage.buckets set public = false where id = 'signed-contracts';

drop policy if exists signed_contracts_admin_read on storage.objects;
create policy signed_contracts_admin_read on storage.objects
  for select to authenticated using (
    bucket_id = 'signed-contracts'
    and exists (
      select 1 from public.leads l
      where l.id::text = (storage.foldername(name))[1]
        and l.tenant_id = public.current_tenant_id()
    )
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin', 'studio_manager')
    )
  );
