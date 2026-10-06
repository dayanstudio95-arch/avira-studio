// Signed contract PDFs (PII-02, audit 2026-10-05). The `signed-contracts` bucket holds the
// couple's signed contract — full name, ID number, signature, price — and used to be public:
// `leads.signed_contract_pdf_url` was a permanent link anyone could open. The bucket is now
// private (0073) and every reader gets a short-lived signed URL instead.
//
// The stored column keeps its old value (the public-style URL of the object) — no data
// migration, no file moved. The object path is parsed back out of it here. A URL that is
// not one of ours (one legacy lead from Base44) is returned unchanged.
//
// Hand-mirrored in src/lib/signedContract.js (the admin screens) — keep the two in sync.

export const SIGNED_CONTRACTS_BUCKET = 'signed-contracts';

const MARKER = `/${SIGNED_CONTRACTS_BUCKET}/`;

// ".../storage/v1/object/public/signed-contracts/<leadId>/signed-contract.pdf" → "<leadId>/signed-contract.pdf"
export function contractPathFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const clean = url.split('?')[0];
  const i = clean.indexOf('/storage/v1/object/');
  if (i === -1) return null;
  const j = clean.indexOf(MARKER, i);
  if (j === -1) return null;
  const path = decodeURIComponent(clean.slice(j + MARKER.length));
  if (!path || path.includes('..')) return null;
  return path;
}

// Returns a link the reader can open now: a signed URL for our own files, the stored URL for
// a foreign one, null when there is nothing (or signing failed).
export async function signedContractUrl(
  supabase: any,
  storedUrl: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!storedUrl) return null;
  const path = contractPathFromUrl(storedUrl);
  if (!path) return storedUrl;
  const { data, error } = await supabase.storage
    .from(SIGNED_CONTRACTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
