// Photos uploaded to Google Drive from the gallery page (Avira, 2026-11-03, 0109; 2026-11-04, 0110): what goes where.
// What the owner drops keeps its folders (his decision): "צלם ראשון", "צלם שני", "טיזר"… each go into the event's
// folder by their own name, with everything in them; photos dropped by themselves lie in it directly. The event's folder
// is "ויקה ואיליה 1/11/26", filed by the Drive helper into "גלריות אווירה 2026 › גלריות 11/2026". Only photos the
// gallery reads (IMAGE_EXT, as gallery-worker/worker/photos.ts); the rest is counted and left out. Pure — tested in
// scripts/test-whatsapp-bot.mjs.

export const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;
/** The gallery reads this many folders down from the event's folder (gallery-worker photos.ts MAX_DEPTH). */
export const READ_DEPTH = 3;

const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });
const natural = (a, b) => collator.compare(a, b);

/**
 * files: [{ path: "צלם ראשון/01 התארגנות/AVIRA-1.jpg", size, file? }] (paths as dropped) →
 * { files: [{ ...f, name, dir: ["צלם ראשון", "01 התארגנות"] }], groups: [{ name, count, bytes, folders }], skipped,
 * deep, count, bytes }. `groups` = what was dropped, by its top folder ('' = photos dropped by themselves); `deep` =
 * photos more than 3 folders down, which the gallery does not read. Two photos of one name in one folder: the second
 * becomes "name (2).jpg" (Drive would keep both, the gallery would show one).
 */
export function planUpload(files) {
  let skipped = 0;
  const kept = [];
  for (const f of files || []) {
    if (!f || typeof f.path !== "string") continue;
    const parts = f.path.split("/").filter(Boolean);
    const name = parts.pop() || "";
    if (name.startsWith(".") || !IMAGE_EXT.test(name) || parts.some((p) => p.startsWith("."))) {
      skipped++;
      continue;
    }
    kept.push({ ...f, name, dir: parts.map((p) => p.trim()) });
  }
  kept.sort((a, b) => natural([...a.dir, a.name].join("/"), [...b.dir, b.name].join("/")));
  const seen = new Map();
  const out = kept.map((it) => {
    const key = `${it.dir.join("/")}/${it.name.toLowerCase()}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? it : { ...it, name: it.name.replace(/(\.[^.]+)$/, ` (${n})$1`) };
  });
  const groups = new Map();
  for (const it of out) {
    const g = it.dir[0] || "";
    if (!groups.has(g)) groups.set(g, { name: g, count: 0, bytes: 0, dirs: new Set() });
    const x = groups.get(g);
    x.count++;
    x.bytes += Number(it.size) || 0;
    if (it.dir.length > 1) x.dirs.add(it.dir.slice(1).join("/"));
  }
  return {
    files: out,
    groups: [...groups.values()].sort((a, b) => (a.name === "") - (b.name === "") || natural(a.name, b.name)).map(({ dirs, ...g }) => ({ ...g, folders: dirs.size })),
    skipped,
    deep: out.filter((it) => it.dir.length > READ_DEPTH).length,
    count: out.length,
    bytes: out.reduce((s, f) => s + (Number(f.size) || 0), 0),
  };
}

/** The top folder a dropped / picked file sits in, as planUpload groups it ('' = a photo dropped by itself). */
export function topFolderOf(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.length > 1 ? parts[0].trim() : "";
}

/**
 * Folders chosen one after another (2026-11-10, the owner's request: the Mac's folder window takes one folder at a
 * time, and the next one replaced it): what is picked or dropped next joins what was chosen before, for one upload.
 * The same file twice (same path and size — the same folder picked again) is kept once.
 */
export function addPicked(before, added) {
  const key = (f) => `${f.path}|${Number(f.size) || 0}`;
  const out = [...(before || [])];
  const seen = new Set(out.map(key));
  for (const f of added || []) {
    if (!f || typeof f.path !== "string" || seen.has(key(f))) continue;
    seen.add(key(f));
    out.push(f);
  }
  return out;
}

/** "X" on a folder in the list: its files out ('' = the photos dropped by themselves). */
export const withoutFolder = (files, name) => (files || []).filter((f) => topFolderOf(f.path) !== name);

/** "ויקה ואיליה 1/11/26" — the event's folder (the owner's own naming). */
export function galleryFolderName(coupleName, date) {
  const d = String(date || "").slice(0, 10);
  const shown = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(2, 4)}` : "";
  const name = String(coupleName || "").replace(/\s+/g, " ").trim() || "גלריה";
  return shown ? `${name} ${shown}` : name;
}

/** Where the Drive helper files it: ["גלריות אווירה 2026", "גלריות 11/2026"] (as _shared/driveHelper.ts galleryDrivePath), or null. */
export function drivePath(date) {
  const m = String(date || "").match(/^(\d{4})-(\d{2})-\d{2}/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return [`גלריות אווירה ${m[1]}`, `גלריות ${Number(m[2])}/${m[1]}`];
}

/** "6 תמונות" / "תמונה אחת". */
export const photosText = (n) => (n === 1 ? "תמונה אחת" : `${Number(n).toLocaleString("he-IL")} תמונות`);

/** Already in Drive (an upload stopped half way and started again): same name and same size. */
export const alreadyThere = (existing, file) => (existing || []).some((e) => e.name === file.name && Number(e.size) === Number(file.size));

/** "נשארו כ-4 דקות" from the bytes left and the speed (bytes a second); '' while there is no speed yet. */
export function etaText(bytesLeft, speed) {
  if (!(speed > 0) || !(bytesLeft > 0)) return "";
  const min = Math.ceil(bytesLeft / speed / 60);
  if (min <= 1) return "נשארה פחות מדקה";
  if (min < 60) return `נשארו כ-${min} דקות`;
  const h = Math.floor(min / 60);
  const m = Math.round((min % 60) / 5) * 5;
  return `נשארו ${h === 1 ? "כשעה" : `כ-${h} שעות`}${m ? ` ו-${m} דקות` : ""}`;
}

/** 1.1TB / 11.2GB / 840MB, for the progress line. */
export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1).replace(/\.0$/, "")}TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`;
  return `${Math.max(0, Math.round(n / 1024 ** 2))}MB`;
}

/** The photographers on the event's team (as work status shows them), with the work-status field each one marks. */
export const MATERIAL_ROLES = [
  { role: "photographer1", label: "צלם 1", field: "photographer1_done" },
  { role: "photographer2", label: "צלם 2", field: "photographer2_done" },
];
export function teamPhotographers(team) {
  const list = Array.isArray(team) ? team : [];
  return MATERIAL_ROLES.flatMap((r) => {
    const m = list.find((x) => x?.role === r.role);
    return m ? [{ ...r, name: String(m.staffMemberName || "") }] : [];
  });
}

/**
 * Whose materials an upload is, chosen at first (2026-11-07): the first of the event's photographers whose materials
 * are not marked on work status yet — the second photographer's upload comes after the first one's, and "צלם 1" was
 * chosen again. Every one marked: the first. `team` = teamPhotographers(…), `ev` = the event's photographerN_done.
 */
export function defaultUploadRoles(team, ev) {
  if (!team?.length) return [];
  return [(team.find((t) => ev?.[t.field] !== true) || team[0]).role];
}
