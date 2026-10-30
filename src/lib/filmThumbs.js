// A picture for film galleries in the studio's list (ported from the Avira films app, 2026-09-27):
// the studio's browser plays a few seconds of the highlights from the films site (with the
// gallery's preview token, since a <video> can't send the session), takes a frame that isn't dark,
// and saves a small JPEG there. Done once per gallery, a few at a time while the list is open.
import { FILMS_BASE_URL, filmsApi } from "@/lib/filmsApi";

/** The film to take the frame from: the highlights (the smallest version), else the first one that plays. */
export function thumbFilm(films) {
  const order = ["highlights", "teaser", "feature", "ceremony", "reels", "other"];
  const playable = (films || []).map((f, i) => ({ f, i })).filter(({ f }) => f.playable);
  if (playable.length === 0) return -1;
  playable.sort((a, b) => order.indexOf(a.f.tag) - order.indexOf(b.f.tag) || (a.f.sizeBytes || Infinity) - (b.f.sizeBytes || Infinity));
  return playable[0].i;
}

function once(el, event, ms) {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timeout")), ms);
    el.addEventListener(
      event,
      () => {
        window.clearTimeout(t);
        resolve();
      },
      { once: true }
    );
    el.addEventListener("error", () => reject(new Error("video")), { once: true });
  });
}

/** Average brightness of a picture (0–255), from a coarse sample. */
function brightness(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4 * 53) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}

/** Takes the frame and saves it; returns the picture's address on the films site, or '' when it couldn't. */
export async function makeFilmThumb(g) {
  const n = thumbFilm(g.films);
  if (n < 0 || !g.previewToken) return "";
  const v = document.createElement("video");
  // The films site answers with CORS for the hub, so the frame can be read from the canvas.
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = `${FILMS_BASE_URL}/api/admin/galleries/${g.id}/film/${n}?pt=${encodeURIComponent(g.previewToken)}`;
  try {
    await once(v, "loadedmetadata", 25_000);
    const d = Number.isFinite(v.duration) ? v.duration : 60;
    const w = 640;
    const h = Math.round((w * (v.videoHeight || 360)) / (v.videoWidth || 640));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // A few seconds in (the first frames are often a fade from black); later if still dark.
    for (const t of [Math.min(4, d * 0.1), d * 0.25, d * 0.45]) {
      v.currentTime = Math.max(0, Math.min(t, d - 0.1));
      await once(v, "seeked", 20_000);
      ctx.drawImage(v, 0, 0, w, h);
      if (brightness(ctx, w, h) > 35) break;
    }
    const jpeg = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
    if (!jpeg) return "";
    const res = await filmsApi("POST", `/api/admin/galleries/${g.id}/thumb`, undefined, { blob: jpeg, type: "image/jpeg" });
    return res?.thumb || "";
  } catch {
    return "";
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}
