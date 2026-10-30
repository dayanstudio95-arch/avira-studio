// The print shop's private link (/print/<token>), fix plan P55 (0140; decisions D17(3) and D12(1)).
// The link works PRINT_LINK_DAYS from when it was made or last renewed ("חדש לעוד 30 יום" in the hub), then answers
// 404 and the clean-up removes it. It serves only the album as the couple SENT it (films_albums.print_data), never a
// draft: while the studio has the album open for the couple again it is paused (409 'album_open', D17(3): paused, not
// only a warning), and when the couple sent a different page count after paying it waits for the studio to accept it
// (409 'pages_changed'). Before the first send there is nothing to print (409 'not_sent') and no link can be made.
import type { AlbumOrderState, PrintAlbum } from './store';
import type { Gallery } from './types';

export const PRINT_LINK_DAYS = 30;
const DAY = 86_400_000;

/** Why the link gives no files now; null = it does. */
export type PrintBlock = 'not_sent' | 'album_open' | 'pages_changed';

export const PRINT_BLOCK_WORDS: Record<PrintBlock, string> = {
  not_sent: 'הזוג עוד לא שלח את האלבום. הקישור יעבוד אחרי השליחה.',
  album_open: 'האלבום נפתח מחדש לעריכה אצל הזוג. הקישור מושהה עד שהזוג ישלח אותו שוב.',
  pages_changed: 'הזוג שלח מספר דפים שונה מההזמנה ששולמה. הקישור מושהה עד שהסטודיו יאשר את מספר הדפים החדש.',
};

export const PRINT_EXPIRED_WORDS = 'תוקף הקישור פג. בקשו מהסטודיו לחדש אותו.';

/** When the link stops (ISO), from its date; '' = no link. A link from before P55 with no date counts from now. */
export function printLinkExpiresAt(g: Pick<Gallery, 'printToken' | 'printTokenAt'>, now = Date.now()): string {
  if (!g.printToken) return '';
  const from = Date.parse(g.printTokenAt ?? '');
  return new Date((Number.isFinite(from) ? from : now) + PRINT_LINK_DAYS * DAY).toISOString();
}

export function printLinkExpired(g: Pick<Gallery, 'printToken' | 'printTokenAt'>, now = Date.now()): boolean {
  const at = printLinkExpiresAt(g, now);
  return Boolean(at) && Date.parse(at) <= now;
}

/** The order was paid (or is in print): its page count is the one paid for. */
const paidOrder = (o: NonNullable<AlbumOrderState['order']>) => o.paymentStatus === 'paid' || ['paid', 'in_print', 'delivered', 'completed'].includes(o.workflowStatus);

/**
 * What stops the print shop now. `state` = the album order (null: the studio has none, or it was not read — the
 * page count is then not checked).
 */
export function printBlock(copy: PrintAlbum | null, state: AlbumOrderState | null): PrintBlock | null {
  if (!copy?.album) return 'not_sent';
  if (copy.open) return 'album_open';
  const o = state?.crm ? state.order : null;
  if (o && paidOrder(o) && o.spreads != null && o.spreads !== copy.album.spreads.length) return 'pages_changed';
  return null;
}
