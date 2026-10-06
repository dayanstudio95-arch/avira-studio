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
// Storage directly).
//
// PII-01 (audit 2026-10-05): a signed contract is final. Before, anyone holding the
// contract link could call this again and silently replace the signed PDF (upsert), or use
// the legacy `{ leadId, fileUrl }` shape to point the studio's "view signed contract" link
// at any URL. Now: PDF bytes only (the fileUrl shape is gone — nothing calls it), the lead
// must exist, and once signed_at is set the PDF can no longer be replaced. The page uploads
// BEFORE sign-lead-public marks the lead signed (see ContractPage.jsx handleSign), so an
// unsigned lead may still re-upload (a retry after a failed signing).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { SIGNED_CONTRACTS_BUCKET, signedContractUrl } from '../_shared/signedContract.ts';

// ~60MB of PDF. Real signed contracts are LARGE — html2canvas rasters every A4 page at
// full resolution: in production they average ~19MB and reach ~21MB (checked 2026-10-06).
// The first cap (20M base64 chars ≈ 15MB) would have rejected almost all of them — keep
// this generous; it only exists to stop absurd uploads.
const MAX_PDF_BASE64_CHARS = 80_000_000;

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-"
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  // Fully public/unauthenticated endpoint -- rate-limited per caller IP since leadId
  // (an unguessable UUID) is the only real security boundary here. See
  // _shared/rateLimit.ts / migration 0023 for why this exists.
  const rateLimit = await checkRateLimit(req, 'save-signed-contract');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const { leadId, pdfBase64 } = await req.json();
    if (!leadId || typeof leadId !== 'string') return jsonResponse({ error: 'Missing leadId' }, { status: 400 });
    if (!pdfBase64 || typeof pdfBase64 !== 'string') return jsonResponse({ error: 'Missing pdfBase64' }, { status: 400 });
    if (pdfBase64.length > MAX_PDF_BASE64_CHARS) return jsonResponse({ error: 'הקובץ גדול מדי' }, { status: 413 });

    const supabase = createServiceRoleClient();

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, signed_at')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) return jsonResponse({ error: leadError.message }, { status: 500 });
    if (!lead) return jsonResponse({ error: 'החוזה לא נמצא' }, { status: 404 });
    if (lead.signed_at) return jsonResponse({ error: 'החוזה כבר נחתם — לא ניתן להחליף את הקובץ החתום' }, { status: 409 });

    let resolvedUrl: string;
    {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(pdfBase64);
      } catch {
        return jsonResponse({ error: 'קובץ לא תקין' }, { status: 400 });
      }
      if (!isPdf(bytes)) return jsonResponse({ error: 'קובץ לא תקין' }, { status: 400 });
      // FIXED (2026-08-13): the storage object key used to be `${leadId}/${fileName}`
      // with fileName built client-side as a raw Hebrew string (e.g. "חוזה_חתום_דני.pdf",
      // see ContractPage.jsx generateSignedPdf). Supabase Storage rejects non-ASCII bytes
      // in object keys outright ("Invalid key: <uuid>/חוזה_חתום_...pdf"), so every signing
      // whose couple-names produced a Hebrew fileName failed to upload -- while the couple
      // had already been marked "signed" by the earlier signLeadPublic call, leaving a
      // signed-with-no-PDF lead. The storage key is now always a fixed ASCII path; the
      // couple-facing Hebrew fileName is only used client-side as the `download` attribute
      // on the PDF link, never as part of the storage key.
      const path = `${leadId}/signed-contract.pdf`;
      const { error: uploadError } = await supabase.storage
        .from(SIGNED_CONTRACTS_BUCKET)
        .upload(path, bytes, { contentType: 'application/pdf', upsert: true });
      if (uploadError) return jsonResponse({ error: uploadError.message }, { status: 500 });

      const { data: publicUrlData } = supabase.storage.from(SIGNED_CONTRACTS_BUCKET).getPublicUrl(path);
      resolvedUrl = publicUrlData.publicUrl;
    }

    const { error } = await supabase
      .from('leads')
      .update({ signed_contract_pdf_url: resolvedUrl })
      .eq('id', leadId)
      .is('signed_at', null);

    if (error) return jsonResponse({ error: error.message }, { status: 500 });

    // PII-02: the column keeps the object's address; the couple gets a 1-hour signed link.
    return jsonResponse({ success: true, fileUrl: await signedContractUrl(supabase, resolvedUrl, 3600) });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
