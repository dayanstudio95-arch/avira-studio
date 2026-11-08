import { isTopFolder } from "@films-shared/photosets";

// What a gallery's photos still need after they were loaded from the folder (2026-11-09, the owner's request: the upload
// and what comes after it in the background, on any page — src/lib/photoProcessing.js runs it), and whose materials
// get marked on work status. Pure — tested in scripts/test-whatsapp-bot.mjs.

/** A photo read with no colour, outside the teaser ("top") folders — those go to the teaser instead. */
export const isUnmarked = (it) => it.label === "" && !(it.folder && isTopFolder(it.folder));

/**
 * The photos still to measure (no shape yet: its small preview is loaded once) and to read (capture time and Lightroom
 * colour: no `label` yet). `again` = "קריאת זמנים מחדש": every photo when the list's times were read before P64 (they
 * may be made up), else the photos without a time.
 */
export function processingTodo(data, { again = false } = {}) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const old = data?.timesV !== 2;
  return {
    measure: items.filter((i) => !i.ar).map((i) => i.key),
    dates: items.filter((i) => (again ? old || typeof i.t !== "number" : i.label === undefined)).map((i) => i.key),
  };
}

export const hasWork = (data) => {
  const t = processingTodo(data);
  return t.measure.length + t.dates.length > 0;
};

/**
 * What the Worker read (readPhotoDates: { dates, labels, failed }) as the list's patch. A photo it could not read stays
 * unread (no label: tried again next time); its old time goes only when every time is replaced by one from the files.
 * `markV2` = save `timesV: 2` after the patch (every photo read this way).
 */
export function datePatches(data, keys, { dates = {}, labels = {}, failed = [] } = {}) {
  const old = data?.timesV !== 2;
  const whole = keys.length > 0 && keys.length === (data?.items?.length || 0);
  const skip = new Set(failed);
  const patches = {};
  for (const k of keys) {
    if (skip.has(k)) {
      if (whole && old) patches[k] = { t: null };
      continue;
    }
    const t = dates[k];
    patches[k] = { t: typeof t === "number" ? t : null, label: labels[k] || "" };
  }
  return { patches, markV2: whole && old };
}

/** Photos with no set go to the set their Lightroom colour stands for ("none" = no colour). { key: { set } }. */
export function labelSetPatches(data, map = {}) {
  const idByName = new Map((data?.sets || []).map((x) => [x.name, x.id]));
  const items = {};
  for (const it of data?.items || []) {
    if (it.set || !(it.label || isUnmarked(it))) continue;
    const id = idByName.get(map[it.label || "none"] || "");
    if (id) items[it.key] = { set: id };
  }
  return items;
}

/**
 * Whose materials an upload was (2026-11-09: "מה קורה אם העליתי חומרים של צלם אבל אני צריך להעלות עוד"): `people` =
 * the photographers chosen (teamPhotographers rows), `later` = the roles with more to come. Marked = the rest.
 */
export function uploadMarks(people, later = []) {
  const rest = new Set(later);
  return { mark: (people || []).filter((p) => !rest.has(p.role)), later: (people || []).filter((p) => rest.has(p.role)) };
}

/** "אני (דניאל)" / "סלבה ויונתן" — the photographers' names (their role when the team has no name). */
export function peopleText(people) {
  const names = (people || []).map((p) => p.name || p.label);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}` : names[0] || "";
}

/** Loaded from a link: the event's photographers not marked on work status yet (asked whose materials these were). */
export const notMarkedYet = (team, ev) => (team || []).filter((t) => ev?.[t.field] !== true);
