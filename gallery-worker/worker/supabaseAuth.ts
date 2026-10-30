// Who is calling the admin API: a signed-in member of a StudioOS studio, proven by
// their Supabase session token (Authorization: Bearer <access token>), exactly the
// same login as the hub. The films screens are for the studio's admins only, like
// the rest of the hub's admin panel.
import type { Store, StudioUser } from './store';
import { HttpError } from './types';

const ADMIN_ROLES = ['owner', 'admin', 'studio_manager'];

export interface RequireOptions {
  /** A change (not a read): refused when the studio's subscription is not in good standing. */
  write?: boolean;
  /** Only for studios with this gallery module (films: the studio page; photos: photo tools). */
  module?: 'films' | 'photos';
  /**
   * With `write`: a studio whose subscription is not active (read only) may still call this route — only for actions
   * that LOWER exposure (fix plan P55: the trash and removal, closing, deleting face data, revoking the print link,
   * switching face search off, a new non-empty password or code, an earlier closing day). The answer carries
   * `readOnly: true`, and a route that also does other things refuses those itself. A blocked studio is refused as before.
   */
  allowReadOnly?: boolean;
  /**
   * Who may call besides the studio's admins — only the album sketch editor's read routes (port B9) add the album
   * manager (`DESIGNER_ROLES`, worker/albumDesigner.ts). Default: owner, admin, studio manager.
   */
  roles?: readonly string[];
}

/** The studio bought (or is trying) the module this kind of gallery belongs to. */
export function requireKind(me: StudioUser, kind: 'films' | 'photos'): void {
  if (kind === 'photos' && !me.photos) throw new HttpError(402, 'גלריות התמונות אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב".');
  if (kind === 'films' && !me.films) throw new HttpError(402, 'גלריות הסרטים אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב".');
}

export const READ_ONLY_WORDS = 'המנוי של הסטודיו אינו פעיל. אפשר לצפות, אבל לא לשנות.';
/** A read-only studio asked for more than lowering exposure (P55). */
export const READ_ONLY_REDUCE_WORDS = 'המנוי של הסטודיו אינו פעיל. אפשר רק לסגור, למחוק, לבטל קישורים או להחליף סיסמה — לא לשנות או להאריך.';

export async function requireStudioAdmin(request: Request, store: Store, opts: RequireOptions = {}): Promise<StudioUser> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'צריך להתחבר מחדש');
  const user = await store.userFromToken(token);
  if (!user) throw new HttpError(401, 'צריך להתחבר מחדש');
  if (!(opts.roles ?? ADMIN_ROLES).includes(user.role)) throw new HttpError(403, 'רק מנהלי הסטודיו יכולים לנהל גלריות');
  const tenant = await store.getTenant(user.tenantId);
  if (!tenant || tenant.access === 'blocked') throw new HttpError(403, 'החשבון של הסטודיו מושהה');
  if (!tenant.films && !tenant.photos) throw new HttpError(402, 'הגלריות אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב".');
  if (opts.module) requireKind({ ...user, films: tenant.films, photos: tenant.photos }, opts.module);
  const readOnly = tenant.access !== 'ok';
  if (opts.write && readOnly && !opts.allowReadOnly) throw new HttpError(402, READ_ONLY_WORDS);
  return { ...user, films: tenant.films, photos: tenant.photos, ...(readOnly ? { readOnly: true } : {}) };
}
