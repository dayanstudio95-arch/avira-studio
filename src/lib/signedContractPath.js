// Pure part of src/lib/signedContract.js (no Supabase client), so the test runner can load it.
// Hand-mirrored from supabase/functions/_shared/signedContract.ts — keep the two in sync.
const BUCKET = "signed-contracts";
const MARKER = `/${BUCKET}/`;

export function contractPathFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const clean = url.split("?")[0];
  const i = clean.indexOf("/storage/v1/object/");
  if (i === -1) return null;
  const j = clean.indexOf(MARKER, i);
  if (j === -1) return null;
  const path = decodeURIComponent(clean.slice(j + MARKER.length));
  if (!path || path.includes("..")) return null;
  return path;
}

