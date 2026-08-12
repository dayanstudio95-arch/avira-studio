-- Storage bucket for general authenticated-staff file uploads (album reminder images,
-- automation message media attachments, lead-import screenshots, etc.)
--
-- Context: several admin-only, logged-in flows still called
-- `base44.integrations.Core.UploadFile({file})`, which — like the contract-signing PDF
-- upload fixed in migration 0006 — was never implemented in the Supabase shim
-- (base44Client.js only overrides `.entities`/`.functions`, not `.integrations`), so
-- every one of these uploads silently failed:
--   - src/pages/ProgressStatus.jsx (album-reminder image attachment)
--   - src/components/automations/AutomationEditDrawer.jsx (automation media attachment)
--   - src/components/leads/LeadImageImportReviewDialog.jsx (lead-import screenshot)
--
-- Unlike the contract-signing flow (public/unauthenticated couple-facing page, so the
-- upload had to happen server-side via a service-role Edge Function), all of these are
-- admin-only flows behind a logged-in Supabase Auth session. So instead of adding a new
-- Edge Function per call site, we let the authenticated client upload directly to this
-- bucket, gated by a normal `authenticated`-role RLS policy on storage.objects.
--
-- Bucket is public (public=true) so the resulting file_url is a stable, directly
-- fetchable URL — matching the `{file_url}` shape every existing call site already
-- expects back from `UploadFile`.
insert into storage.buckets (id, name, public)
values ('media-uploads', 'media-uploads', true)
on conflict (id) do nothing;

-- Any logged-in user (all roles — this bucket only ever holds non-sensitive marketing/
-- automation media, not contracts or personal documents) may upload and overwrite files
-- in this bucket. Reads are already open to everyone via the public bucket flag above.
create policy "authenticated users can upload media-uploads"
on storage.objects for insert
to authenticated
with check (bucket_id = 'media-uploads');

create policy "authenticated users can update media-uploads"
on storage.objects for update
to authenticated
using (bucket_id = 'media-uploads');
