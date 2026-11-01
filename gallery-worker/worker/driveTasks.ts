// Work for the owner's Google Drive helper (Avira, 2026-11-02, the owner's request; 0101). The system only reads
// Drive, so it never moves or deletes there itself: it writes a task, and a small Apps Script in the owner's Google
// account (Settings ← חיבורים ← גוגל דרייב) asks drive-helper for it every 5 minutes and does it.
//   trash         a photo gallery removed for good → its folder to the Drive trash (30 more days to restore there);
//   to_favorites  a starred gallery → its folder into "גלריות מועדפים";
//   restore       the star taken off → the folder back where it was.
// Only Drive folders; never a folder another gallery of the studio still uses. Never throws: the gallery's own
// change is already saved, a Drive task that could not be written is logged.
import { kindOf } from './galleries';
import type { Store } from './store';
import type { Gallery } from './types';

export type DriveTaskKind = 'trash' | 'to_favorites' | 'restore';

export interface DriveTaskInput {
  tenantId: string;
  galleryId: string;
  coupleName: string;
  folderId: string;
  kind: DriveTaskKind;
  parentId?: string;
}

/** The Drive folder a photo gallery reads ("drive.google.com/drive/folders/<id>"), or null. */
export function driveFolderId(g: Pick<Gallery, 'folderProvider' | 'folderUrl'>): string | null {
  if (g.folderProvider !== 'gdrive' || !g.folderUrl) return null;
  const m = /\/folders\/([A-Za-z0-9_-]{10,100})/.exec(g.folderUrl);
  return m ? m[1] : null;
}

const taskOf = (g: Gallery, folderId: string, kind: DriveTaskKind, parentId?: string): DriveTaskInput => ({
  tenantId: g.tenantId,
  galleryId: g.id,
  coupleName: g.coupleName,
  folderId,
  kind,
  ...(parentId ? { parentId } : {}),
});

/** After galleries were removed for good: each one's Drive folder to the Drive trash, unless another gallery uses it. */
export async function queueDriveTrash(store: Store, gone: Gallery[]): Promise<number> {
  try {
    const goneIds = new Set(gone.map((g) => g.id));
    const tasks: DriveTaskInput[] = [];
    const seen = new Set<string>();
    for (const g of gone) {
      const folderId = kindOf(g) === 'photos' ? driveFolderId(g) : null;
      if (!folderId || seen.has(folderId)) continue;
      seen.add(folderId);
      // A gallery that still reads it (also one in the trash, which may be restored) keeps it.
      const users = (await store.folderUsers(g.tenantId, g.folderUrl!)).filter((id) => !goneIds.has(id));
      if (users.length === 0) tasks.push(taskOf(g, folderId, 'trash'));
    }
    if (tasks.length) await store.queueDriveTasks(tasks);
    return tasks.length;
  } catch (e) {
    console.error('[films] drive trash tasks not written:', (e as Error).message);
    return 0;
  }
}

/** The studio's star changed (`was` = before): the folder into "גלריות מועדפים", or back where it was. */
export async function queueStarMove(store: Store, g: Gallery, was: boolean): Promise<void> {
  const now = g.studioFavorite === true;
  const folderId = kindOf(g) === 'photos' ? driveFolderId(g) : null;
  if (now === was || !folderId) return;
  try {
    if (now) {
      // Starred again before it went back: the folder never left "גלריות מועדפים".
      if (await store.cancelDriveTasks(g.id, 'restore')) return;
      await store.queueDriveTasks([taskOf(g, folderId, 'to_favorites')]);
    } else {
      // Unstarred before it moved: it never left its place.
      if (await store.cancelDriveTasks(g.id, 'to_favorites')) return;
      // Moved by the helper (it noted where from); otherwise there is nothing to move back.
      if (g.drivePrevParent) await store.queueDriveTasks([taskOf(g, folderId, 'restore', g.drivePrevParent)]);
    }
  } catch (e) {
    console.error(`[films] drive star task for ${g.id} not written:`, (e as Error).message);
  }
}

/** Why a starred gallery is not moved to the trash (Avira, 2026-11-02: the owner's choice). */
export const STARRED_WORDS = 'הגלריה מסומנת בכוכב. כדי למחוק אותה, קודם להוריד את הכוכב.';
