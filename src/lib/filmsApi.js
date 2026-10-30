// Calls the films Worker's admin API (a different origin from the hub) with the
// signed-in user's Supabase session. The Worker checks the session, the role
// (studio admins only) and the subscription on every request.
import { supabase } from "@/api/supabaseClient";
import { photoPath } from "@films-shared/photoUrl";

export const FILMS_BASE_URL = (import.meta.env.VITE_FILMS_BASE_URL || "").replace(/\/$/, "");

export function filmsConfigured() {
  return Boolean(FILMS_BASE_URL);
}

/** A couple's gallery link: <films site>/<studio slug>/<gallery id>. */
export function coupleLink(slug, galleryId) {
  return `${FILMS_BASE_URL}/${slug || "watch"}/${galleryId}`;
}

/**
 * "Open as the couple": the couple's link with the gallery's own preview token (from GET /api/admin/galleries/:id,
 * a 12-hour studio pass). The films site then opens it as the studio — past the password and the download code —
 * and records no couple view and no terms acceptance. The list's thumbs token does not open a gallery (P73).
 */
export function studioPreviewLink(slug, galleryId, previewToken) {
  const link = coupleLink(slug, galleryId);
  return previewToken ? `${link}?pt=${encodeURIComponent(previewToken)}` : link;
}

export function studioPageLink(slug) {
  return `${FILMS_BASE_URL}/${slug}`;
}

/**
 * A photo of a photo gallery. `token` (from the admin photo list) lets the studio see hidden photos and closed
 * galleries; `gen` is the list's generation (its `gen`, fix plan P66): the address changes when the file does,
 * so the browser may keep the picture a year. Built by the films site's one address builder (shared/photoUrl.ts).
 */
export function photoUrl(galleryId, key, size = "m", token = "", gen = 0) {
  return `${FILMS_BASE_URL}${photoPath(galleryId, gen, key, size, token ? `pt=${encodeURIComponent(token)}` : "")}`;
}

/** A gallery's cover. `token` (the gallery's preview token) opens it behind a password too. */
export function coverUrl(galleryId, version = "", token = "") {
  const q = [version ? `v=${version}` : "", token ? `pt=${encodeURIComponent(token)}` : ""].filter(Boolean).join("&");
  return `${FILMS_BASE_URL}/api/cover/${galleryId}${q ? `?${q}` : ""}`;
}

export async function filmsApi(method, path, body, raw) {
  if (!FILMS_BASE_URL) throw new Error("מודול הסרטים עדיין לא הוגדר (VITE_FILMS_BASE_URL)");
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const headers = { Authorization: `Bearer ${token || ""}` };
  const init = { method, headers };
  if (raw) {
    init.body = raw.blob;
    headers["Content-Type"] = raw.type;
    if (raw.fileName) headers["X-File-Name"] = encodeURIComponent(raw.fileName);
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${FILMS_BASE_URL}${path}`, init);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    // The status travels with the error, so a screen can tell "gone" (404) from "not allowed"
    // (401/403) from "try again" (anything else) — fix plan P56.
    // With a fixed word the screen can act on when there is one (e.g. 'album_submitted': ask, then send again
    // with force — P71).
    throw Object.assign(new Error(json?.error || `שגיאה (${res.status})`), { status: res.status, ...(json?.code ? { code: json.code } : {}) });
  }
  return json;
}

/**
 * A file from the films Worker's admin API with the signed-in session (the album sketch editor's large preview and
 * original photo — port B9). Throws with the status on a failure or when the answer is not a picture.
 * @returns {Promise<Blob>}
 */
export async function filmsFile(path) {
  if (!FILMS_BASE_URL) throw new Error("מודול הסרטים עדיין לא הוגדר (VITE_FILMS_BASE_URL)");
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${FILMS_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${data?.session?.access_token || ""}` } });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || /json|text\/|html/i.test(type)) {
    let message = "";
    try {
      message = (await res.json())?.error || "";
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(message || `התמונה לא נטענה (${res.status})`), { status: res.status });
  }
  return res.blob();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("העתיקו את הקישור:", text);
    return false;
  }
}
