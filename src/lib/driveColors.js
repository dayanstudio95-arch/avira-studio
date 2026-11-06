// The galleries' folder colours in Google Drive (2026-11-06, the owner's request): a gallery uploaded through the system
// is red in Drive until it went to the couple, then green. Only the folders the system made (drive.file — the uploads,
// as drive_tasks 'file' rows record them); a folder the owner made himself is never touched. Pure — tested in
// scripts/test-whatsapp-bot.mjs; driveUpload.js paints.

// Drive's own folder palette (the About resource's folderColorPalette); another value is moved to the nearest one.
export const DRIVE_RED = "#f83a22";
export const DRIVE_GREEN = "#16a765";

/**
 * What to paint: tasks = drive_tasks rows ({ gallery_id, folder_id }), items = [{ galleryId, sent }] (the list on the
 * screen), seen = { folderId: "sent" | "open" } this browser already painted. → [{ folderId, sent }], one per folder.
 */
export function colorPlan(tasks, items, seen = {}) {
  const folderOf = new Map();
  for (const t of tasks || []) if (t?.gallery_id && t?.folder_id) folderOf.set(t.gallery_id, t.folder_id);
  const out = new Map();
  for (const it of items || []) {
    const folderId = folderOf.get(it?.galleryId);
    if (!folderId || out.has(folderId)) continue;
    const sent = Boolean(it.sent);
    if (seen[folderId] === (sent ? "sent" : "open")) continue;
    out.set(folderId, { folderId, sent });
  }
  return [...out.values()];
}
