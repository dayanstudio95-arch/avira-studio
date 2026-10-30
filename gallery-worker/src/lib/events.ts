// Views and downloads for the studio's list (/api/watch/:id/event). Best effort: never in the way.
import { api } from './api';

export function countEvent(id: string, type: 'view' | 'download'): void {
  if (id) api('POST', `/api/watch/${id}/event`, { type }).catch(() => {});
}

/** A photo download: the gallery's link id is in the photos' address (/api/photos/<id>). */
export function countPhotoDownload(base: string): void {
  countEvent(/\/api\/photos\/([a-f0-9]{16})/.exec(base)?.[1] ?? '', 'download');
}

/** Once per visit (this page load) per link: a reload or a new visit counts again. */
const viewed = new Set<string>();
export function countViewOnce(id: string): void {
  if (viewed.has(id)) return;
  viewed.add(id);
  countEvent(id, 'view');
}
