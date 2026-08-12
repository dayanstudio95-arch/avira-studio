import { supabase } from './supabaseClient';

// Drop-in replacement for the never-ported `base44.integrations.Core.UploadFile({file})`.
// That call was silently broken everywhere it was still used (base44Client.js only ever
// overrode `.entities`/`.functions`, never `.integrations` — see migration
// 0007_media_uploads_storage.sql for the full story), so every admin-only file upload
// (album reminder images, automation media attachments, lead-import screenshots) was a
// no-op that failed inside a try/catch and looked like nothing happened.
//
// These are all authenticated, logged-in-staff flows (unlike the public/unauthenticated
// contract-signing PDF upload, which has to go through a service-role Edge Function
// instead — see save-signed-contract). So this uploads directly from the browser using
// the already-authenticated Supabase client, straight to the public `media-uploads`
// bucket, gated by a normal `authenticated`-role RLS policy on storage.objects.
//
// Returns `{ file_url }` to match the exact shape every existing call site already
// expects back from the old Base44 UploadFile integration.
export async function uploadFile({ file }) {
  if (!file) throw new Error('No file provided');

  const ext = file.name?.includes('.') ? file.name.split('.').pop() : '';
  const safeName = `${Date.now()}-${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  const { error: uploadError } = await supabase.storage
    .from('media-uploads')
    .upload(safeName, file, { contentType: file.type || undefined, upsert: false });

  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from('media-uploads').getPublicUrl(safeName);
  return { file_url: data.publicUrl };
}
