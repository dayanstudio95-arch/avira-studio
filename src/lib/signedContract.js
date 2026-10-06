// Opening a signed contract PDF from the admin screens (PII-02, audit 2026-10-05).
// The `signed-contracts` bucket is private: the stored leads.signed_contract_pdf_url is no
// longer openable as-is, so we parse the object path out of it and ask Storage for a
// 5-minute signed URL (allowed by the 0073 storage policy: admins of the lead's studio).
// A URL that is not ours (one legacy Base44 lead) opens unchanged.
//
// Hand-mirrored from supabase/functions/_shared/signedContract.ts — keep the two in sync.
import { supabase } from "@/api/supabaseClient";
import { contractPathFromUrl } from "./signedContractPath";

export { contractPathFromUrl };

const BUCKET = "signed-contracts";

// Opens the window synchronously (inside the click) so Safari/iOS don't block it as a
// popup, then points it at the signed URL once Storage answers.
export async function openSignedContract(storedUrl) {
  if (!storedUrl) return;
  const path = contractPathFromUrl(storedUrl);
  if (!path) {
    window.open(storedUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const win = window.open("about:blank", "_blank");
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw error || new Error("no signed url");
    if (win) {
      win.opener = null;
      win.location.href = data.signedUrl;
    } else {
      window.location.href = data.signedUrl;
    }
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}
