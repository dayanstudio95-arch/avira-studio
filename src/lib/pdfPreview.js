// Morning's previews come back as a Base64 PDF (POST /documents/preview). A blob URL for an
// <iframe> / a new tab. The caller revokes it when done.
export function base64PdfUrl(b64) {
  const bin = atob(String(b64 || ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
