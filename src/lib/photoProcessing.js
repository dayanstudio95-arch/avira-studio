// What comes after a gallery's photos are loaded, in the background (2026-11-09, the owner's request: "שכל העלה וגם
// התהליך שקורה אחריה תוכל לפעול ברקע ואני יוכל עדיין לעבוד על המערכת בדפים אחרים"). Before, it ran only while the
// gallery's page was open. Two steps:
//   1. each photo's shape: its small preview is loaded once (also warms the couple's cache) — 6 at a time;
//   2. its capture time and Lightroom colour: the Worker reads the start of each file (src/lib/photoDates.js); then,
//      when "שיוך לסטים לפי צבע" is on, photos with no set go to their colour's set.
// One gallery at a time; the pill at the bottom of every page shows it (DriveUploadPill.jsx), and the photos editor when
// it is open. The galleries not finished are kept in this browser (localStorage): closing the tab stops it, and the next
// time the system is open it goes on by itself from where it stopped (every saved photo is done). What to do is
// src/lib/photoProcessingPlan.js (pure, tested).

import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { filmsApi, photoUrl } from "@/lib/filmsApi";
import { readPhotoDates } from "@/lib/photoDates";
import { datePatches, labelSetPatches, processingTodo } from "@/lib/photoProcessingPlan";

const KEY = "avira_photo_processing"; // [{ galleryId, coupleName }] — the galleries not finished in this browser
const OPEN = ["waiting", "measure", "dates"];
const MEASURE_LANES = 6;

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

export const subscribeProcessing = (fn) => {
  listeners.add(fn);
  fn(jobs);
  return () => listeners.delete(fn);
};
export const isProcessing = (job) => OPEN.includes(job?.phase);
export const processingFor = (galleryId) => [...jobs].reverse().find((j) => j.galleryId === galleryId) || null;

const readPending = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x?.galleryId) : [];
  } catch {
    return [];
  }
};
const writePending = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: it goes on while the tab is open */
  }
};
const keepPending = (job) => writePending([...readPending().filter((x) => x.galleryId !== job.galleryId), { galleryId: job.galleryId, coupleName: job.coupleName }]);
const dropPending = (galleryId) => writePending(readPending().filter((x) => x.galleryId !== galleryId));

/**
 * Starts (or queues) the work on a gallery's photos. Nothing new while one runs for it. `force` = again after a load
 * (a finished one this session is not started again by just opening the page — photos that could not be read would be
 * asked forever); `again` = "קריאת זמנים מחדש"; `data` = the list the caller already has.
 */
export function processGallery(galleryId, { coupleName = "", data = null, force = false, again = false } = {}) {
  if (!galleryId) return null;
  const old = processingFor(galleryId);
  if (old && (isProcessing(old) || !force)) return old;
  const job = { id: `${galleryId}:${Date.now()}`, galleryId, coupleName: coupleName || old?.coupleName || "", data, again, phase: "waiting", done: 0, total: 0, error: "", version: 0 };
  jobs = [...jobs.filter((j) => j !== old), job];
  keepPending(job);
  emit();
  next();
  return job;
}

export function dismissProcessing(job) {
  if (isProcessing(job)) return;
  jobs = jobs.filter((j) => j !== job);
  if (job.phase === "error") dropPending(job.galleryId);
  emit();
}

export const retryProcessing = (job) => processGallery(job.galleryId, { coupleName: job.coupleName, force: true, again: job.again });

let running = null;
function next() {
  if (running) return;
  const job = jobs.find((j) => j.phase === "waiting");
  if (!job) return;
  running = job;
  run(job).finally(() => {
    running = null;
    next();
  });
}

/** One save at a time per job; the answer is the whole list as saved (the photos editor gets it when the job ends). */
async function save(job, body) {
  const d = await filmsApi("PUT", `/api/admin/galleries/${job.galleryId}/photos`, body);
  if (d) job.data = d;
  job.version++;
  return d;
}

async function measure(job) {
  const todo = processingTodo(job.data).measure;
  if (!todo.length) return;
  const byKey = new Set(todo);
  const { previewToken, gen } = job.data;
  patch(job, { phase: "measure", done: 0, total: todo.length });
  let pending = {};
  let saving = Promise.resolve();
  const flush = () => {
    if (!Object.keys(pending).length) return saving;
    const items = pending;
    pending = {};
    saving = saving.then(() => save(job, { items }));
    return saving;
  };
  const queue = [...byKey];
  const lane = async () => {
    while (queue.length) {
      const key = queue.shift();
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight) pending[key] = { ar: img.naturalWidth / img.naturalHeight };
          resolve();
        };
        img.onerror = () => resolve();
        img.src = photoUrl(job.galleryId, key, "m", previewToken, gen);
      });
      job.done++;
      emit();
      if (Object.keys(pending).length >= 40) await flush();
    }
  };
  await Promise.all(Array.from({ length: MEASURE_LANES }, lane));
  await flush();
}

async function readTimes(job, settings) {
  const keys = processingTodo(job.data, { again: job.again }).dates;
  if (keys.length) {
    patch(job, { phase: "dates", done: 0, total: keys.length });
    const read = await readPhotoDates({
      keys,
      provider: job.data.provider,
      post: (batch) => filmsApi("POST", `/api/admin/galleries/${job.galleryId}/photos/dates`, { keys: batch }),
      onProgress: (done, total) => patch(job, { done, total }),
    });
    const { patches, markV2 } = datePatches(job.data, keys, read);
    const entries = Object.entries(patches);
    for (let i = 0; i < entries.length; i += 1000) await save(job, { items: Object.fromEntries(entries.slice(i, i + 1000)) });
    if (markV2) await save(job, { timesV: 2 });
  }
  // The sets by Lightroom colour, when the studio uses it (its settings).
  if (settings?.labelSetsOn) {
    const items = labelSetPatches(job.data, settings.labelMap || {});
    if (Object.keys(items).length) await save(job, { items });
  }
}

async function run(job) {
  try {
    if (!job.data) job.data = await filmsApi("GET", `/api/admin/galleries/${job.galleryId}/photos`);
    if (!job.data?.items?.length) {
      patch(job, { phase: "done", finishedAt: Date.now(), quiet: true });
      dropPending(job.galleryId);
      return;
    }
    const settings = await filmsApi("GET", "/api/admin/settings").catch(() => null);
    await measure(job);
    await readTimes(job, settings);
    patch(job, { phase: "done", finishedAt: Date.now() });
    dropPending(job.galleryId);
    if (job.total) toast.success(`התמונות של ${job.coupleName || "הגלריה"} מוכנות`);
  } catch (e) {
    // A gallery that is gone (deleted, another studio's on this browser): forgotten quietly.
    if (e?.status === 404 || e?.status === 403) {
      jobs = jobs.filter((j) => j !== job);
      dropPending(job.galleryId);
      emit();
      return;
    }
    patch(job, { phase: "error", error: e?.message || "העיבוד נעצר" });
  }
}

/** The galleries left half way the last time (closed tab): on again, once a signed-in page is open. */
let resumed = false;
export async function resumeProcessing() {
  if (resumed) return;
  const pending = readPending();
  if (!pending.length) return;
  const { data } = await supabase.auth.getSession().catch(() => ({ data: null }));
  if (!data?.session) return;
  resumed = true;
  for (const p of pending) processGallery(p.galleryId, { coupleName: p.coupleName });
}

// Closing or reloading the tab stops it (it goes on next time): asked first, like an upload.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!jobs.some(isProcessing)) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
