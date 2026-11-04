// Photos uploaded to Google Drive from the gallery page, in the background (Avira, 2026-11-03, 0109). The browser sends
// each photo straight to the studio's Drive (resumable uploads, three at a time) with a short-lived token from the
// google-drive function — nothing passes through our servers. The job lives here, outside any page: the owner moves
// around the app and the pill (DriveUploadPill.jsx) shows it; only closing or reloading the tab stops it (and asks
// first). The event's folder ("ויקה ואיליה 1/11/26") is made in the system's own "גלריות אווירה" and the Drive helper
// files it into "גלריות אווירה 2026 › גלריות 11/2026" (0110; the system's drive.file reaches only what it made); what
// was dropped goes in it by its own folders. At the end: the folder is shared by link, loaded into the gallery (the
// photos editor does it when it is open, with its own questions), and the photographers chosen are marked "done".
// What goes where is src/lib/driveUploadPlan.js (pure, tested).

import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { filmsApi } from "@/lib/filmsApi";
import { alreadyThere, galleryFolderName, MATERIAL_ROLES } from "@/lib/driveUploadPlan";

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const PARALLEL = 3;
const PAUSED = new Error("paused");
const OPEN = ["queued", "preparing", "uploading", "paused", "finishing"];

let jobs = [];
const listeners = new Set();
const emit = () => {
  jobs = [...jobs];
  listeners.forEach((fn) => fn(jobs));
};
const patch = (job, fields) => {
  Object.assign(job, fields);
  emit();
};

export const subscribe = (fn) => {
  listeners.add(fn);
  fn(jobs);
  return () => listeners.delete(fn);
};
export const isOpen = (job) => OPEN.includes(job?.phase);
export const jobFor = (galleryId) => [...jobs].reverse().find((j) => j.galleryId === galleryId) || null;

// The photos editor of a gallery, while it is open: it loads the folder itself (it asks when the couple's choices
// would lose photos, and shows them at once).
const editors = new Map();
export function registerEditor(galleryId, load) {
  editors.set(galleryId, load);
  return () => editors.get(galleryId) === load && editors.delete(galleryId);
}

// ---- the studio's Drive ------------------------------------------------------------------------------------------

let token = null;
async function getToken(fresh = false) {
  if (!fresh && token && Date.parse(token.expiresAt) - Date.now() > 3 * 60 * 1000) return token;
  const r = await base44.functions.invoke("googleDrive", { action: "token" });
  const d = r?.data ?? r;
  if (!d?.accessToken) {
    const e = new Error(d?.error || "לא מחובר לגוגל דרייב");
    e.notConnected = true;
    throw e;
  }
  token = d;
  return token;
}

/** Connected? { connected, email, error } — for the panel. */
export async function driveStatus() {
  const r = await base44.functions.invoke("googleDrive", { action: "status" });
  return r?.data ?? r;
}

/** Google's consent page; comes back to `back` (this page). */
export async function connectDrive(back) {
  const r = await base44.functions.invoke("googleDrive", { action: "start", back });
  const url = (r?.data ?? r)?.authorizeUrl;
  if (!url) throw new Error("לא הצלחנו לפתוח את החיבור לגוגל");
  window.location.assign(url);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function drive(path, { method = "GET", body } = {}) {
  let fresh = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const t = await getToken(fresh);
    fresh = false;
    const res = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t.accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    if (res.status === 401) fresh = true;
    else if (res.status === 429 || res.status >= 500) await sleep(800 * 2 ** attempt);
    else throw new Error(`גוגל דרייב החזיר שגיאה (${res.status})`);
  }
  throw new Error("גוגל דרייב לא עונה כרגע");
}

/** The Drive's space in bytes: { used, limit } (limit null = no limit), or null when it can't be read. */
export async function driveQuota() {
  try {
    const r = await drive("https://www.googleapis.com/drive/v3/about?fields=storageQuota");
    const used = Number(r?.storageQuota?.usage);
    const limit = r?.storageQuota?.limit ? Number(r.storageQuota.limit) : null;
    return Number.isFinite(used) ? { used, limit } : null;
  } catch {
    return null;
  }
}

const q = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** The event's folder: the system's own of this name wherever it is now (the helper may have filed it), else a new one. */
async function eventFolder(rootId, name) {
  const found = await drive(`?q=${encodeURIComponent(`name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`)}&fields=files(id)&pageSize=5`);
  const own = (found?.files || []).find((f) => f.id !== rootId);
  if (own) return own.id;
  return (await drive("?fields=id", { method: "POST", body: { name, mimeType: FOLDER_MIME, parents: [rootId] } })).id;
}

/** Asks the Drive helper to file the event's folder by its date (0110). Never stops the upload. */
async function fileFolder(job) {
  try {
    const r = await base44.functions.invoke("googleDrive", { action: "file", folderId: job.folderId, date: job.date, galleryId: job.galleryId, coupleName: job.coupleName });
    const d = r?.data ?? r;
    if (d?.path) job.filedTo = d.path;
    job.helperOld = Boolean(d?.queued) && !(d?.helperVersion >= 2);
  } catch {
    // The folder stays in "גלריות אווירה" until the next upload asks again.
  }
}

async function folderIn(parentId, name) {
  const found = await drive(`?q=${encodeURIComponent(`name = '${q(name)}' and '${q(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`)}&fields=files(id)&pageSize=1`);
  if (found?.files?.[0]?.id) return found.files[0].id;
  return (await drive("?fields=id", { method: "POST", body: { name, mimeType: FOLDER_MIME, parents: [parentId] } })).id;
}

async function filesIn(folderId) {
  const out = [];
  let page = "";
  do {
    const r = await drive(`?q=${encodeURIComponent(`'${q(folderId)}' in parents and trashed = false`)}&fields=${encodeURIComponent("nextPageToken,files(id,name,size,mimeType)")}&pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...(r?.files || []));
    page = r?.nextPageToken || "";
  } while (page);
  return out;
}

/** The gallery's own Drive folder when its link is one the system made (drive.file reaches only those), else null. */
export async function appFolderOf(folderUrl) {
  const id = String(folderUrl || "").match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/)?.[1];
  if (!id) return null;
  try {
    const f = await drive(`/${encodeURIComponent(id)}?fields=id,trashed,capabilities(canAddChildren)`);
    return f?.id && !f.trashed && f.capabilities?.canAddChildren ? f.id : null;
  } catch {
    return null;
  }
}

/** One photo: a resumable session, then the bytes (XHR — it reports progress); `onBytes(loaded)` while it goes. */
async function sendPhoto(job, item, parentId, onBytes) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (job.paused) throw PAUSED;
    try {
      const t = await getToken(attempt > 0 && item.lastStatus === 401);
      const type = item.file.type || "image/jpeg";
      const init = await fetch(`${UPLOAD}?uploadType=resumable&fields=id`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(item.file.size) },
        body: JSON.stringify({ name: item.name, parents: [parentId] }),
      });
      item.lastStatus = init.status;
      if (!init.ok) throw new Error(`init ${init.status}`);
      const session = init.headers.get("Location");
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        job.xhrs.add(xhr);
        const done = () => job.xhrs.delete(xhr);
        if (session) {
          xhr.open("PUT", session);
          xhr.setRequestHeader("Content-Type", type);
        } else {
          // No session address readable here: one multipart request instead.
          xhr.open("POST", `${UPLOAD}?uploadType=multipart&fields=id`);
          xhr.setRequestHeader("Authorization", `Bearer ${t.accessToken}`);
        }
        xhr.upload.onprogress = (e) => onBytes(e.loaded);
        xhr.onload = () => {
          done();
          item.lastStatus = xhr.status;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`upload ${xhr.status}`));
        };
        xhr.onerror = () => {
          done();
          reject(new Error("network"));
        };
        xhr.onabort = () => {
          done();
          reject(PAUSED);
        };
        if (session) xhr.send(item.file);
        else {
          const boundary = `avira${Math.random().toString(36).slice(2)}`;
          xhr.setRequestHeader("Content-Type", `multipart/related; boundary=${boundary}`);
          xhr.send(new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: item.name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, item.file, `\r\n--${boundary}--`]));
        }
      });
      return;
    } catch (e) {
      onBytes(0);
      if (e === PAUSED || job.paused) throw PAUSED;
      if (attempt === 4) throw e;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

// ---- the job -----------------------------------------------------------------------------------------------------

/**
 * Starts (or queues behind another one) an upload for a gallery. plan = planUpload(...) with each file's `file`;
 * roles = the work-status roles whose materials these are ("photographer1"…); folderId = the gallery's own Drive
 * folder when it already has one the system made (more photos into it), else a new one in "גלריות אווירה".
 */
export function startUpload({ galleryId, galleryKind = "photos", coupleName, date, eventId = null, roles = [], plan, folderId = null }) {
  const old = jobFor(galleryId);
  if (old && isOpen(old)) throw new Error("כבר יש העלאה לגלריה הזו");
  const items = plan.files.map((f) => ({ ...f, set: f.dir[0] || "", dirKey: f.dir.join("/") }));
  const job = {
    id: `${galleryId}:${Date.now()}`,
    galleryId,
    galleryKind,
    coupleName,
    folderName: galleryFolderName(coupleName, date),
    date,
    eventId,
    roles,
    folderId,
    folderUrl: "",
    items,
    // What was dropped, by its top folder ('' = photos dropped by themselves).
    sets: plan.groups.map((g) => ({ name: g.name, total: g.count, done: 0 })),
    total: items.length,
    done: 0,
    failed: [],
    bytesTotal: plan.bytes,
    bytesDone: 0,
    speed: 0,
    phase: "queued",
    paused: false,
    xhrs: new Set(),
    error: "",
    note: "",
    startedAt: Date.now(),
  };
  jobs = [...jobs, job];
  emit();
  next();
  return job;
}

let running = null;
function next() {
  if (running) return;
  const job = jobs.find((j) => j.phase === "queued");
  if (!job) return;
  running = job;
  run(job).finally(() => {
    running = null;
    next();
  });
}

export function pauseUpload(job) {
  if (job.phase !== "uploading") return;
  job.paused = true;
  job.xhrs.forEach((x) => x.abort());
  patch(job, { phase: "paused", speed: 0 });
}

export function resumeUpload(job) {
  if (job.phase !== "paused" && job.phase !== "error") return;
  job.paused = false;
  if (job.phase === "error") {
    job.items.forEach((it) => it.state === "failed" && (it.state = ""));
    job.failed = [];
  }
  patch(job, { phase: "queued", error: "" });
  next();
}

export function dismissUpload(job) {
  if (isOpen(job)) return;
  jobs = jobs.filter((j) => j !== job);
  emit();
}

const setOf = (job, name) => job.sets.find((s) => s.name === name);

async function run(job) {
  try {
    patch(job, { phase: "preparing", error: "" });
    const t = await getToken();
    if (!job.folderId) job.folderId = await eventFolder(t.rootFolderId, job.folderName);
    job.folderUrl = `https://drive.google.com/drive/folders/${job.folderId}`;
    await fileFolder(job);
    // Every folder that was dropped, as it was, and what is already in each (stopped half way: only what is missing goes).
    const parents = { "": job.folderId };
    for (const it of job.items) {
      for (let i = 1; i <= it.dir.length; i++) {
        const key = it.dir.slice(0, i).join("/");
        if (!parents[key]) parents[key] = await folderIn(parents[it.dir.slice(0, i - 1).join("/")], it.dir[i - 1]);
      }
    }
    for (const [key, id] of Object.entries(parents)) {
      if (!job.items.some((it) => it.dirKey === key && !it.state)) continue;
      const there = await filesIn(id);
      for (const it of job.items) if (it.dirKey === key && !it.state && alreadyThere(there, it)) it.state = "done";
    }
    recount(job);
    patch(job, { phase: "uploading" });
    await uploadAll(job, parents);
    if (job.paused) return;
    if (job.failed.length) {
      patch(job, { phase: "error", error: `${job.failed.length} תמונות לא עלו. אפשר לנסות שוב.` });
      return;
    }
    await finish(job);
  } catch (e) {
    if (e === PAUSED || job.paused) return;
    patch(job, { phase: "error", error: e?.notConnected ? "החיבור לגוגל דרייב נותק. מתחברים מחדש בעמוד הגלריה." : e?.message || "ההעלאה נעצרה" });
  }
}

function recount(job) {
  job.done = job.items.filter((it) => it.state === "done").length;
  job.bytesDone = job.items.filter((it) => it.state === "done").reduce((s, it) => s + (Number(it.size) || 0), 0);
  for (const s of job.sets) s.done = job.items.filter((it) => it.set === s.name && it.state === "done").length;
}

async function uploadAll(job, parents) {
  const queue = job.items.filter((it) => !it.state);
  const inflight = new Map();
  let lastBytes = job.bytesDone;
  let lastAt = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const bytes = job.bytesDone + [...inflight.values()].reduce((s, v) => s + v, 0);
    const rate = ((bytes - lastBytes) * 1000) / Math.max(1, now - lastAt);
    job.speed = job.speed ? job.speed * 0.8 + rate * 0.2 : rate;
    job.liveBytes = bytes;
    lastBytes = bytes;
    lastAt = now;
    emit();
  }, 1000);
  const worker = async () => {
    while (queue.length && !job.paused) {
      const it = queue.shift();
      it.state = "sending";
      try {
        await sendPhoto(job, it, parents[it.dirKey], (loaded) => inflight.set(it, loaded));
        inflight.delete(it);
        it.state = "done";
        job.done++;
        job.bytesDone += Number(it.size) || 0;
        const s = setOf(job, it.set);
        if (s) s.done++;
      } catch (e) {
        inflight.delete(it);
        if (e === PAUSED || job.paused) {
          it.state = "";
          return;
        }
        it.state = "failed";
        job.failed.push(it.name);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  } finally {
    clearInterval(tick);
    job.liveBytes = job.bytesDone;
    emit();
  }
}

async function finish(job) {
  patch(job, { phase: "finishing", speed: 0 });
  // The gallery reads the folder by its link: anyone with it can see (as a pasted Drive link has to be).
  await drive(`/${encodeURIComponent(job.folderId)}/permissions?fields=id`, { method: "POST", body: { type: "anyone", role: "reader" } });
  let loaded = false;
  const editor = editors.get(job.galleryId);
  if (editor) {
    loaded = await editor(job.folderUrl).then((ok) => ok === true, () => false);
    if (!loaded) job.note = "התמונות בדרייב, אבל לא נטענו לגלריה. בעמוד הגלריה לוחצים \"טעינה מחדש\".";
  } else {
    try {
      const d = await filmsApi("POST", `/api/admin/galleries/${job.galleryId}/photos/load`, { url: job.folderUrl });
      if (d?.needsConfirm) job.note = "בעמוד הגלריה לוחצים \"טעינה מחדש\": חלק מהבחירות של הזוג יישארו בלי תמונה.";
      else loaded = true;
    } catch (e) {
      job.note = `התמונות בדרייב, אבל הטעינה לגלריה נכשלה: ${e.message}. בעמוד הגלריה לוחצים "טעינה מחדש".`;
    }
  }
  // Work status: the photographers whose materials these are.
  let marked = [];
  if (job.eventId && job.roles.length) {
    const fields = Object.fromEntries(MATERIAL_ROLES.filter((r) => job.roles.includes(r.role)).map((r) => [r.field, true]));
    const { error } = await supabase.from("events").update(fields).eq("id", job.eventId);
    if (error) job.note = `${job.note ? `${job.note} ` : ""}הסימון בסטטוס עבודה לא נשמר.`;
    else marked = MATERIAL_ROLES.filter((r) => job.roles.includes(r.role)).map((r) => r.label);
  }
  patch(job, { phase: "done", loaded, marked, finishedAt: Date.now() });
  toast.success(`הגלריה של ${job.coupleName} עלתה לדרייב: ${job.total.toLocaleString("he-IL")} תמונות${marked.length ? ` · ${marked.join(" ו")} ${marked.length > 1 ? "סומנו" : "סומן"} בסטטוס עבודה` : ""}`);
}

// Closing or reloading the tab stops the upload: ask first.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!jobs.some((j) => ["preparing", "uploading", "finishing", "queued"].includes(j.phase))) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---- dropped folders ---------------------------------------------------------------------------------------------

/** The files of a drop, with their folder paths ("חתונה/02 התארגנות/x.jpg"): folders are walked. */
export async function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dataTransfer?.files || [])].map((f) => ({ path: f.name, size: f.size, file: f }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: `${prefix}${file.name}`, size: file.size, file });
      return;
    }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

/** The files of a folder picked with the file dialog (webkitdirectory). */
export const filesFromInput = (fileList) => [...(fileList || [])].map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, file: f }));
