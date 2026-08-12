// Ports base44/functions/saveSignedContract/entry.ts — but with a real storage backend.
//
// Public, unauthenticated — called from the contract-signing page (ContractPage.jsx)
// right after the couple signs, so it must use the service-role client (no logged-in
// session yet), same as getLeadPublic/signLeadPublic.
//
// CHANGED from the original Base44 flow: the original had the browser upload the PDF
// itself (base44.integrations.Core.UploadFile) and pass the resulting fileUrl here to
// just record it. That upload step was never ported to Supabase and silently failed in
// production (leads.signed_contract_pdf_url was never set — see migration
// 0006_signed_contracts_storage.sql for the full story). Fixed by having THIS function
// do the upload itself: it now receives the PDF as a base64 string, decodes it, and
// uploads directly to the `signed-contracts` Storage bucket using the service-role
// client (bypasses RLS — the couple's anon browser session is never trusted to write to
// Storage directly). Still accepts the legacy `{ leadId, fileUrl }` shape as a fallback
// for forward-compat, in case anything else ever calls this with an already-hosted URL.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { leadId, fileUrl, pdfBase64, fileName } = await req.json();
    if (!leadId) return jsonResponse({ error: 'Missing leadId' }, { status: 400 });
    if (!fileUrl && !pdfBase64) return jsonResponse({ error: 'Missing fileUrl or pdfBase64' }, { status: 400 });

    const supabase = createServiceRoleClient();

    let resolvedUrl = fileUrl;
    if (pdfBase64) {
      const bytes = base64ToBytes(pdfBase64);
      const path = `${leadId}/${fileName || 'signed-contract.pdf'}`;
      const { error: uploadError } = await supabase.storage
        .from('signed-contracts')
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (uploadError) return jsonResponse({ error: uploadError.message }, { status: 500 });

      const { data: publicUrlData } = supabase.storage.from('signed-contracts').getPublicUrl(path);
      resolvedUrl = publicUrlData.publicUrl;
    }

    const { error } = await supabase
      .from('leads')
      .update({ signed_contract_pdf_url: resolvedUrl })
      .eq('id', leadId);

    if (error) return jsonResponse({ error: error.message }, { status: 500 });

    return jsonResponse({ success: true, fileUrl: resolvedUrl });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
