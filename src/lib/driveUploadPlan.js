// Photos uploaded to Google Drive from the gallery page (Avira, 2026-11-03, 0109): what goes where. The owner drops the
// wedding's folder: its sub-folders are the gallery's sets ("02 התארגנות" fills that set, as a pasted Drive link does),
// photos lying in it directly go in the gallery's own folder. Only photos the gallery reads (IMAGE_EXT, as
// gallery-worker/worker/photos.ts); the rest is counted and left out. Pure — tested in scripts/test-whatsapp-bot.mjs.

export const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;

const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });
const natural = (a, b) => collator.compare(a, b);

/**
 * files: [{ path: "חתונה/02 התארגנות/AVIRA-1.jpg", size, file? }] (the dropped folder's relative paths) →
 * { sets: [{ name, files }], loose: [files], skipped, count, bytes }. One folder around everything is the wedding's
 * own folder and is not a set; deeper folders join their top folder's set. Two photos of one name in a set: the
 * second becomes "name (2).jpg" (Drive would keep both, the gallery would show one).
 */
export function planUpload(files) {
  const list = (files || []).filter((f) => f && typeof f.path === "string");
  const parts = list.map((f) => f.path.split("/").filter(Boolean));
  // The wedding's folder itself: every path starts with the same folder (and has more under it).
  const top = parts.length && parts.every((p) => p.length > 1 && p[0] === parts[0][0]) ? 1 : 0;
  const sets = new Map();
  const loose = [];
  let skipped = 0;
  list.forEach((f, i) => {
    const p = parts[i].slice(top);
    const name = p[p.length - 1] || "";
    if (name.startsWith(".") || !IMAGE_EXT.test(name)) {
      skipped++;
      return;
    }
    const item = { ...f, name };
    if (p.length > 1) {
      const set = p[0].trim();
      if (!sets.has(set)) sets.set(set, []);
      sets.get(set).push(item);
    } else loose.push(item);
  });
  const unique = (items) => {
    const seen = new Map();
    return items
      .sort((a, b) => natural(a.name, b.name))
      .map((it) => {
        const key = it.name.toLowerCase();
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        return n === 1 ? it : { ...it, name: it.name.replace(/(\.[^.]+)$/, ` (${n})$1`) };
      });
  };
  const out = [...sets.entries()].sort((a, b) => natural(a[0], b[0])).map(([name, items]) => ({ name, files: unique(items) }));
  const looseOut = unique(loose);
  const all = [...out.flatMap((s) => s.files), ...looseOut];
  return { sets: out, loose: looseOut, skipped, count: all.length, bytes: all.reduce((s, f) => s + (Number(f.size) || 0), 0) };
}

/** "6 תמונות" / "תמונה אחת". */
export const photosText = (n) => (n === 1 ? "תמונה אחת" : `${Number(n).toLocaleString("he-IL")} תמונות`);

/** "עידן & ליני · 02.11.2026" — the gallery's folder in "גלריות אווירה". */
export function galleryFolderName(coupleName, date) {
  const d = String(date || "").slice(0, 10);
  const shown = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "";
  const name = String(coupleName || "").replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim() || "גלריה";
  return shown ? `${name} · ${shown}` : name;
}

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
