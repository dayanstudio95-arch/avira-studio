// Client-side image compression for the Wedding Albums module's spread thumbnails.
//
// Why this exists: Supabase Storage's Image Transformations (resize-on-read) has a
// hard source-file-size cap -- confirmed 2026-08-24 by calling the render endpoint
// directly, which returned `{"error":"InvalidRequest","message":"The source image
// file is too large to process"}` for every single spread in a real order (all
// 25-30MB, typical for full-resolution wedding photography exports). That means
// resize-on-read cannot work at all for this studio's real files -- not a bug to
// patch, a hard ceiling. Explicitly approved by the user as a deliberate exception
// to CLAUDE.md's "no separate preview-generation pipeline" iron rule: this stays
// 100% client-side (a canvas resize in the browser), never a server-side
// pipeline/Edge Function, so it doesn't reintroduce the compute constraints that
// rule was protecting against. The original full-resolution file is never touched
// or re-encoded -- it stays exactly as uploaded, for print. This only produces a
// small *second* file (`album_spreads.thumb_file_key`) used purely for on-screen
// preview (admin grid + couple portal).
export async function compressImageForThumb(file, { maxDimension = 1600, quality = 0.82 } = {}) {
  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("כשל בדחיסת התמונה"))),
        "image/jpeg",
        quality
      );
    });
    return blob;
  } finally {
    bitmap.close?.();
  }
}
