// In-memory Store for unit tests and CLOUD_MOCK previews. Sessions are fake:
// a bearer token "test:<userId>:<tenantId>:<role>" signs in as that member.
import type { Album } from '../shared/album';
import { summaryFrom } from './dashboard';
import { extendedTo, kindOf } from './galleries';
import { applyPhotoDiff, coverOf, patchChangesShown } from './photos';
import { defaultFilmsStudio, LIST_NAME_TAKEN, MIT4MIT_TAKEN, type AlbumGuardState, type AuditEntry, type BlockedTrash, SLUG_CHANGES_LIMIT, SLUG_CHANGES_PER_30_DAYS, SLUG_INVALID, SLUG_KEPT_DAYS, SLUG_RESERVED, SLUG_TAKEN, listView, MAX_LISTS, type GalleriesSummary, type GalleryOption, type AlbumOrderState, type AlbumDesignBank, type AlbumExpect, type AlbumWrite, type PrintAlbum, type CleanupRun, type CountedEvent, type DropboxImpact, type FilmCheckGallery, type StudioMail, type FaceCleanupCandidate, type FaceSearchRole, type FaceSwap, type FacesMeta, type FilmsStudio, type GalleryFields, type GalleryGuard, type PhotoDiff, type PhotoList, type Store, type StudioUser, type TenantInfo, type TermsAccept, type TermsSummary, termsSummary } from './store';
import type { Gallery, Lead, PhotoData, PhotoItem } from './types';
import { CONNECTION_PROVIDERS } from '../shared/providers';
import { HttpError } from './types';
import { whatsappNumber } from './settings';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'assets', 'watch', 'join', 'demo', 'login', 'signup', 'films', 'app', 'www', 'static', 'accessibility', 'print']);

const withDisplayName = (t: TenantInfo): TenantInfo => ({ ...t, displayName: t.displayName || t.name });

export class MemoryStore implements Store {
  tenants = new Map<string, TenantInfo>();
  studios = new Map<string, FilmsStudio>();
  galleries = new Map<string, Gallery>();
  secrets = new Map<string, string>();
  leads: { tenantId: string; lead: Lead }[] = [];
  /** Addresses studios gave up (tenant_slug_history, P73), oldest first. */
  slugHistory: { slug: string; tenantId: string; releasedAt: number }[] = [];
  accessVersions = new Map<string, number>();

  /**
   * Test helper: add or update a studio. The display name is kept as given ('' = none) and falls
   * back to the name on read, like SupabaseStore (display_name_to_clients || name): a rename then
   * shows up even when the studio was first created by a sign-in with the default name.
   */
  seedTenant(t: Partial<TenantInfo> & { id: string }): TenantInfo {
    const full: TenantInfo = {
      name: 'סטודיו לדוגמה',
      displayName: '',
      logoUrl: '',
      phone: '',
      instagramUrl: '',
      facebookUrl: '',
      slug: '',
      accentColor: '#FACC15',
      access: 'ok',
      films: true,
      photos: true,
      ...this.tenants.get(t.id),
      ...t,
    };
    this.tenants.set(t.id, full);
    return withDisplayName(full);
  }

  async userFromToken(token: string): Promise<StudioUser | null> {
    const m = /^test:([^:]+):([^:]+):([a-z_]+)$/.exec(token);
    if (!m) return null;
    if (!this.tenants.has(m[2])) this.seedTenant({ id: m[2], slug: `studio-${m[2]}`.slice(0, 40).toLowerCase() });
    return { userId: m[1], tenantId: m[2], role: m[3] };
  }

  async getTenant(id: string) {
    const t = this.tenants.get(id);
    return t ? { ...withDisplayName(t), accessVersion: this.accessVersions.get(id) ?? 0 } : null;
  }

  async tenantIdBySlug(slug: string) {
    for (const t of this.tenants.values()) if (t.slug === slug) return t.id;
    return null;
  }

  async tenantIdByOldSlug(slug: string) {
    const last = this.slugHistory.filter((h) => h.slug === slug).at(-1);
    return last?.tenantId ?? null;
  }

  /** As the trigger on tenants (0134): kept a year for the studio that gave it up, 3 changes in 30 days. */
  async setSlug(tenantId: string, slug: string) {
    const current = this.tenants.get(tenantId)?.slug ?? '';
    if (slug === current) return;
    const day = 86_400_000;
    if (current && this.slugHistory.filter((h) => h.tenantId === tenantId && h.releasedAt > Date.now() - 30 * day).length >= SLUG_CHANGES_PER_30_DAYS) throw new HttpError(400, SLUG_CHANGES_LIMIT);
    if (this.slugHistory.some((h) => h.slug === slug && h.tenantId !== tenantId && h.releasedAt > Date.now() - SLUG_KEPT_DAYS * day)) throw new HttpError(400, SLUG_RESERVED);
    if (!SLUG_RE.test(slug) || RESERVED.has(slug)) throw new HttpError(400, SLUG_INVALID);
    const owner = await this.tenantIdBySlug(slug);
    if (owner && owner !== tenantId) throw new HttpError(400, SLUG_TAKEN);
    if (current) this.slugHistory.push({ slug: current, tenantId, releasedAt: Date.now() });
    this.seedTenant({ id: tenantId, slug });
  }

  async bumpAccessVersion(tenantId: string) {
    const next = (this.accessVersions.get(tenantId) ?? 0) + 1;
    this.accessVersions.set(tenantId, next);
    return next;
  }

  async getFilmsStudio(tenantId: string) {
    return structuredClone(this.studios.get(tenantId) ?? defaultFilmsStudio());
  }

  async patchFilmsStudio(tenantId: string, fields: Partial<FilmsStudio>) {
    // One business, one studio (the unique index of 0135).
    const biz = fields.mit4mitBizId;
    if (biz && [...this.studios].some(([id, f]) => id !== tenantId && f.mit4mitBizId === biz)) throw new HttpError(409, MIT4MIT_TAKEN);
    const next: FilmsStudio = { ...(this.studios.get(tenantId) ?? defaultFilmsStudio()), ...structuredClone(fields) };
    for (const [k, v] of Object.entries(fields)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
    this.studios.set(tenantId, next);
  }

  /** The studio's audit log (audit_logs): what the Worker wrote there. */
  audits: AuditEntry[] = [];
  async audit(entry: AuditEntry) {
    this.audits.push(structuredClone(entry));
  }

  /**
   * Requests SupabaseStore would send, for the clean-up's budget: counted for the calls the clean-up
   * makes, weighted like SupabaseStore (deleteFaces = list + delete + record).
   */
  calls = 0;
  callCount() {
    return this.calls;
  }

  async getGallery(id: string) {
    this.calls++;
    const g = this.galleries.get(id);
    return g ? structuredClone(g) : null;
  }

  async getGalleryByGuestId(guestId: string) {
    for (const g of this.galleries.values()) if (g.guestId === guestId) return structuredClone(g);
    return null;
  }

  async getGalleryByPrintToken(token: string) {
    for (const g of this.galleries.values()) if (g.printToken === token) return structuredClone(g);
    return null;
  }

  /** The studio's galleries, newest first (created_at desc, id desc: SupabaseStore's order). */
  private newest(tenantId: string): Gallery[] {
    return [...this.galleries.values()]
      .filter((g) => g.tenantId === tenantId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  }

  async listGalleries(tenantId: string) {
    this.calls++;
    return this.newest(tenantId).map((g) => structuredClone(listView(g)));
  }

  async pageGalleries(tenantId: string, limit: number, offset: number) {
    this.calls++;
    const all = this.newest(tenantId);
    const n = Math.max(1, Math.min(1000, Math.floor(limit)));
    const from = Math.max(0, Math.floor(offset));
    return { galleries: all.slice(from, from + n).map((g) => structuredClone(listView(g))), total: all.length };
  }

  async galleryOptions(tenantId: string): Promise<GalleryOption[]> {
    this.calls++;
    return this.newest(tenantId).map((g) => ({ id: g.id, kind: kindOf(g), coupleName: g.coupleName, date: g.date, ...(g.deletedAt ? { deletedAt: g.deletedAt } : {}) }));
  }

  async getGalleries(tenantId: string, ids: string[]) {
    this.calls++;
    const wanted = new Set(ids);
    return [...this.galleries.values()].filter((g) => wanted.has(g.id) && g.tenantId === tenantId).map((g) => structuredClone(g));
  }

  async putGallery(g: Gallery) {
    await this.putGalleries([g]);
  }

  async putGalleries(list: Gallery[]) {
    this.calls++;
    // A plain insert, like SupabaseStore: an existing gallery is never overwritten, and one refused row
    // leaves the whole list out (one statement).
    const ids = list.map((g) => g.id);
    const clash = ids.find((id, i) => this.galleries.has(id) || ids.indexOf(id) !== i);
    if (clash) throw Object.assign(new Error(`gallery ${clash} already exists`), { status: 409 });
    for (const g of list) {
      // The photo versions are the database's (0131), never written from a gallery.
      const { photosVersion: _v, photosVisibleVersion: _vv, photosGen: _gen, ...row } = structuredClone(g);
      // As the trigger films_galleries_print_token_at (0140): a link has its date, no link no date.
      if (!row.printToken) delete row.printTokenAt;
      else row.printTokenAt ??= new Date().toISOString();
      this.galleries.set(g.id, row);
    }
  }

  async patchGalleries(tenantId: string, ids: string[], fields: GalleryFields, only: GalleryGuard = {}) {
    this.calls++;
    const out: string[] = [];
    if (Object.keys(fields).length === 0) return out;
    for (const id of new Set(ids)) {
      const calls = this.calls;
      if (await this.patchGallery(tenantId, id, fields, only)) out.push(id);
      this.calls = calls;
    }
    return out;
  }

  async deleteGalleries(tenantId: string, ids: string[]) {
    this.calls++;
    const out: string[] = [];
    for (const id of new Set(ids)) {
      const g = this.galleries.get(id);
      if (!g || g.tenantId !== tenantId || !g.deletedAt) continue;
      const calls = this.calls;
      await this.deleteGallery(id);
      this.calls = calls;
      out.push(id);
    }
    return out;
  }

  async extendGalleries(tenantId: string, items: { id: string; seen: string }[], days: number) {
    this.calls++;
    // As films_galleries_extend (0133): only while the closing time is still the one seen, never in the trash.
    const out: { id: string; expiresAt: string; days: number }[] = [];
    const done = new Set<string>();
    for (const { id, seen } of items) {
      const g = this.galleries.get(id);
      if (done.has(id) || !g || g.tenantId !== tenantId || g.deletedAt || Date.parse(g.expiresAt) !== Date.parse(seen)) continue;
      done.add(id);
      Object.assign(g, extendedTo(g, days));
      out.push({ id, expiresAt: g.expiresAt, days: g.days });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async galleriesSummary(tenantId: string, kinds: { films: boolean; photos: boolean }): Promise<GalleriesSummary> {
    this.calls++;
    return summaryFrom(this.newest(tenantId), await this.listSubmittedAlbums(tenantId), kinds);
  }

  async patchGallery(tenantId: string, id: string, fields: GalleryFields, only: GalleryGuard = {}) {
    this.calls++;
    const g = this.galleries.get(id);
    if (!g || g.tenantId !== tenantId) return null;
    for (const [k, v] of Object.entries(only)) if ((g[k as keyof GalleryGuard] ?? null) !== v) return null;
    const row = g as unknown as Record<string, unknown>;
    const token = g.printToken;
    const tokenAt = g.printTokenAt;
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete row[k];
      else row[k] = structuredClone(v);
    }
    // As the trigger films_galleries_print_token_at (0140): a new link written without a date gets now, no link no date.
    if (!g.printToken) delete g.printTokenAt;
    else if (g.printToken !== token && g.printTokenAt === tokenAt) g.printTokenAt = new Date().toISOString();
    else g.printTokenAt ??= tokenAt ?? new Date().toISOString();
    return structuredClone(g);
  }

  async deleteGallery(id: string) {
    this.calls++;
    this.galleries.delete(id);
    // What Postgres does by itself (on delete cascade / set null).
    this.photos.delete(id);
    this.photoVersions.delete(id);
    this.hearts = this.hearts.filter((h) => h.galleryId !== id);
    this.insta = this.insta.filter((x) => x.galleryId !== id);
    this.lists = this.lists.filter((x) => x.galleryId !== id);
    this.albums.delete(id);
    this.printCopies.delete(id);
    this.terms = this.terms.filter((t) => t.galleryId !== id);
    for (const g of this.galleries.values()) if (g.linkedId === id) g.linkedId = undefined;
  }

  async countEvent(id: string, type: CountedEvent) {
    const g = this.galleries.get(id);
    if (!g) return;
    if (type === 'view') g.views += 1;
    else if (type === 'guest_view') g.guestViews = (g.guestViews ?? 0) + 1;
    else g.downloads += 1;
  }

  async getSecret(tenantId: string, key: string) {
    return this.secrets.get(`${tenantId}:${key}`) ?? null;
  }

  async setSecret(tenantId: string, key: string, value: string | null) {
    if (value === null) this.secrets.delete(`${tenantId}:${key}`);
    else this.secrets.set(`${tenantId}:${key}`, value);
  }

  async insertLead(tenantId: string, lead: Lead) {
    // films_insert_studio_lead (0154): the same phone (any spelling) of the same studio in the last 30 days is one lead.
    const key = whatsappNumber(lead.phone) || lead.phone.replace(/\D/g, '');
    const since = Date.now() - 30 * 86_400_000;
    const twin = this.leads.find((l) => l.tenantId === tenantId && Date.parse(l.lead.createdAt) > since && (whatsappNumber(l.lead.phone) || l.lead.phone.replace(/\D/g, '')) === key);
    if (twin) return { duplicate: true };
    this.leads.unshift({ tenantId, lead });
    return { duplicate: false };
  }

  photos = new Map<string, PhotoData>();
  photoVersions = new Map<string, number>();
  async getPhotos(galleryId: string) {
    this.calls++;
    const d = this.photos.get(galleryId);
    return d ? structuredClone(d) : null;
  }

  async getPhotosVersioned(galleryId: string) {
    const d = this.photos.get(galleryId);
    return d ? { data: structuredClone(d), version: this.photoVersions.get(galleryId) ?? 1 } : null;
  }

  async savePhotos(_tenantId: string, galleryId: string, data: PhotoData, expected?: number | null) {
    const had = this.photos.has(galleryId);
    if (expected === null && !had && !this.galleries.has(galleryId)) throw new HttpError(404, 'הגלריה לא נמצאה');
    if (expected === null && had) return false;
    if (typeof expected === 'number' && (!had || (this.photoVersions.get(galleryId) ?? 1) !== expected)) return false;
    this.photos.set(galleryId, structuredClone(data));
    this.photoVersions.set(galleryId, had ? (this.photoVersions.get(galleryId) ?? 1) + 1 : 1);
    this.followPhotos(galleryId, true);
    return true;
  }

  /**
   * What films_photos_follow (0131, 0132) does after a write of the list: the gallery's two versions, and the list's
   * generation (a patch never changes it: `gen` is not an edit field).
   */
  private followPhotos(galleryId: string, shownMayChange: boolean) {
    const g = this.galleries.get(galleryId);
    if (!g) return;
    g.photosVersion = this.photoVersions.get(galleryId) ?? 1;
    if (shownMayChange) g.photosVisibleVersion = (g.photosVisibleVersion ?? 0) + 1;
    const gen = this.photos.get(galleryId)?.gen;
    if (typeof gen === 'number' && gen >= 1) g.photosGen = Math.floor(gen);
    else delete g.photosGen;
    // films_faces_off_clear (0136): face search on again, the gallery forgets why it was off.
    if (this.photos.get(galleryId)?.faceSearch === true) delete g.facesOffAt;
  }

  async getPhotoItem(tenantId: string, galleryId: string, key: string, opts: { copies?: boolean } = {}) {
    this.calls++;
    const g = this.galleries.get(galleryId);
    const d = this.photos.get(galleryId);
    if (!g || g.tenantId !== tenantId || !d) return null;
    // As films_photo_item: the first photo with the key; copies by name or capture time and shape, at most 50.
    const at = d.items.findIndex((i) => i.key === key);
    const item = at >= 0 ? d.items[at] : null;
    const shape = (a: PhotoItem, b: PhotoItem) => typeof a.ar !== 'number' || typeof b.ar !== 'number' || Math.abs(a.ar - b.ar) < 0.03;
    const copies =
      item && opts.copies
        ? d.items.filter((c, n) => n !== at && (c.name.toLowerCase() === item.name.toLowerCase() || (typeof item.t === 'number' && c.t === item.t)) && shape(c, item)).slice(0, 50)
        : [];
    const folder = JSON.parse(JSON.stringify({ folderUrl: d.folderUrl, provider: d.provider, pathRoot: d.pathRoot ?? null, timesV: d.timesV ?? null }, (_k, v) => (v === null ? undefined : v)));
    return {
      data: structuredClone({ ...folder, sets: [], items: item ? [item, ...copies] : [] }) as PhotoData,
      item: item ? structuredClone(item) : null,
      version: this.photoVersions.get(galleryId) ?? 1,
      visibleVersion: g.photosVisibleVersion ?? 0,
    };
  }

  async patchPhotos(tenantId: string, galleryId: string, expected: number, diff: PhotoDiff) {
    this.calls++;
    const g = this.galleries.get(galleryId);
    const d = this.photos.get(galleryId);
    if (!g || g.tenantId !== tenantId || !d) return null;
    const version = this.photoVersions.get(galleryId) ?? 1;
    if (version !== expected) return 'conflict' as const;
    const next = applyPhotoDiff(d, diff);
    const shown = patchChangesShown(d, diff);
    this.photos.set(galleryId, next);
    this.photoVersions.set(galleryId, version + 1);
    this.followPhotos(galleryId, shown);
    // As films_photos_patch: the count of shown photos and the cover (films_photo_cover: a photo key or none).
    g.photoCount = next.items.filter((i) => !i.hidden).length;
    const cover = coverOf(next);
    if (/^[0-9a-f]{8}$/.test(cover)) g.coverKey = cover;
    else delete g.coverKey;
    return { version: version + 1, photoCount: g.photoCount, coverKey: g.coverKey ?? null, visibleVersion: g.photosVisibleVersion ?? 0 };
  }

  hearts: { galleryId: string; key: string; who: string }[] = [];
  async listHearts(galleryId: string) {
    const out: Record<string, string[]> = {};
    for (const h of this.hearts) if (h.galleryId === galleryId) (out[h.key] ??= []).push(h.who);
    return out;
  }

  async setHearts(_tenantId: string, galleryId: string, keys: string[], on: boolean, who: string) {
    this.calls++;
    // Hearts given together share their time in the database: they are read back in key order.
    for (const key of [...new Set(keys)].sort()) {
      const i = this.hearts.findIndex((h) => h.galleryId === galleryId && h.key === key && h.who === who);
      if (on && i < 0) this.hearts.push({ galleryId, key, who });
      if (!on && i >= 0) this.hearts.splice(i, 1);
    }
  }

  albums = new Map<string, Album>();
  /** The album as sent (films_albums.print_data / print_submitted_at, P55), kept like the trigger films_albums_print_copy. */
  printCopies = new Map<string, { album: Album; submittedAt: string }>();
  async getPrintAlbum(galleryId: string): Promise<PrintAlbum | null> {
    const a = this.albums.get(galleryId);
    if (!a) return null;
    const copy = this.printCopies.get(galleryId);
    return { album: copy ? structuredClone(copy.album) : null, submittedAt: copy?.submittedAt ?? '', open: a.status !== 'submitted' };
  }
  async getAlbum(galleryId: string) {
    const a = this.albums.get(galleryId);
    return a ? structuredClone(a) : null;
  }

  /** As films_album_put (0139): only onto the rev read, only onto a draft; every write raises the rev. (A gallery
   * the tests never made is not checked.) */
  async putAlbum(tenantId: string, galleryId: string, album: Album, expect: AlbumExpect = {}): Promise<AlbumWrite> {
    const g = this.galleries.get(galleryId);
    if (g && g.tenantId !== tenantId) return { ok: false, reason: 'not_found', current: null };
    const current = this.albums.get(galleryId);
    const refuse = (reason: 'conflict' | 'submitted'): AlbumWrite => ({ ok: false, reason, current: current ? structuredClone(current) : null });
    if (!current && (expect.rev ?? 0) !== 0) return refuse('conflict');
    if (current && expect.draftOnly && current.status === 'submitted') return refuse('submitted');
    if (current && expect.rev !== undefined && (current.rev ?? 1) !== expect.rev) return refuse('conflict');
    const rev = current ? (current.rev ?? 1) + 1 : 1;
    const { rev: _old, ...data } = structuredClone(album);
    this.albums.set(galleryId, { ...data, rev });
    if (data.status === 'submitted') {
      const { rev: _r, ...before } = current ?? ({} as Album);
      if (!current || current.status !== 'submitted' || JSON.stringify(before) !== JSON.stringify(data)) {
        this.printCopies.set(galleryId, { album: structuredClone(data) as Album, submittedAt: data.submittedAt || new Date().toISOString() });
      }
    }
    return { ok: true, rev };
  }

  async listSubmittedAlbums(tenantId: string) {
    const out: { galleryId: string; submittedAt: string }[] = [];
    for (const [galleryId, a] of this.albums) {
      if (a.status === 'submitted' && this.galleries.get(galleryId)?.tenantId === tenantId) out.push({ galleryId, submittedAt: a.submittedAt ?? '' });
    }
    return out.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  /** Galleries whose removal from the trash failed (films_galleries.purge_failed_at). */
  purgeFailed = new Map<string, string>();
  async trashCandidates(iso: string, limit: number) {
    this.calls++;
    // Like films_trash_candidates (0105): per studio in turn, oldest first, failed ones last — and
    // those in the order they failed (a studio's turns count them by purge_failed_at, P88-b).
    // P71 (0135): galleries kept for their album order come apart, oldest first, at most 50.
    const turn = new Map<string, number>();
    const failed = (id: string) => this.purgeFailed.has(id);
    const failedAt = (id: string) => this.purgeFailed.get(id) ?? '';
    const waiting = [...this.galleries.values()].filter((g) => g.deletedAt && g.deletedAt < iso);
    const kept = waiting
      .map((g) => ({ g, reason: trashBlock(this.albumOrders.get(g.id)) }))
      .filter((x): x is { g: Gallery; reason: BlockedTrash['reason'] } => x.reason !== null)
      .sort((a, b) => a.g.deletedAt!.localeCompare(b.g.deletedAt!) || a.g.id.localeCompare(b.g.id));
    const keptIds = new Set(kept.map((x) => x.g.id));
    const rows = waiting
      .filter((g) => !keptIds.has(g.id))
      .sort((a, b) => Number(failed(a.id)) - Number(failed(b.id)) || failedAt(a.id).localeCompare(failedAt(b.id)) || a.deletedAt!.localeCompare(b.deletedAt!) || a.id.localeCompare(b.id))
      .map((g) => {
        const n = (turn.get(g.tenantId) ?? 0) + 1;
        turn.set(g.tenantId, n);
        return { g, n };
      })
      .sort((a, b) => Number(failed(a.g.id)) - Number(failed(b.g.id)) || a.n - b.n || a.g.deletedAt!.localeCompare(b.g.deletedAt!) || a.g.id.localeCompare(b.g.id));
    const out = { ids: rows.slice(0, Math.max(0, limit)).map((r) => r.g.id), total: rows.length };
    if (!kept.length) return out;
    return { ...out, blocked: kept.slice(0, 50).map((x) => ({ id: x.g.id, reason: x.reason })), blockedTotal: kept.length };
  }

  async albumGuards(tenantId: string, ids: string[]) {
    this.calls++;
    // Like films_album_guards (0135): this studio's galleries that have an album or an album order.
    const out: Record<string, AlbumGuardState> = {};
    for (const id of new Set(ids)) {
      const g = this.galleries.get(id);
      if (!g || g.tenantId !== tenantId) continue;
      const a = this.albums.get(id);
      const o = this.albumOrders.get(id);
      if (!a && !o) continue;
      out[id] = { album: a ? (a.status === 'submitted' ? 'submitted' : 'draft') : null, order: o ? { workflowStatus: o.workflowStatus, paymentStatus: o.paymentStatus } : null };
    }
    return out;
  }

  async markPurgeFailed(galleryId: string) {
    this.calls++;
    this.purgeFailed.set(galleryId, new Date().toISOString());
  }

  async sweepRateHits() {
    this.calls++;
  }

  runs: CleanupRun[] = [];
  async recordCleanupRun(run: CleanupRun) {
    this.calls++;
    this.runs.push(structuredClone(run));
  }

  /**
   * Face data as 0081 + 0136 keep it: the files in order, one entry per scanned photo (its file; null = not known),
   * the files still holding faces no longer shown (`dirty`), and a version raised on every change.
   */
  faces = new Map<string, { tenantId: string; files: { name: string; bytes: Uint8Array }[]; faces: number; done: Map<string, string | null>; dirty: Set<string>; version: number; createdAt: string; failedAt?: string }>();
  /** Test helpers: face files without a record (gallery id → when the last was uploaded), and studios canceled or suspended since. */
  orphanFaces = new Map<string, string>();
  studioEnded = new Map<string, string>();
  /** films_face_searches (0136). */
  faceSearches: { galleryId: string; tenantId: string; role: FaceSearchRole; consent: string; at: string }[] = [];
  private faceSeq = 0;
  private nextFaceVersion(f: { version: number }) {
    f.version = Math.max(f.version + 1, Date.now());
  }

  async facesMeta(galleryId: string): Promise<FacesMeta> {
    this.calls++;
    const f = this.faces.get(galleryId);
    return f ? { chunks: f.files.length, photos: f.done.size, faces: f.faces, version: f.version } : { chunks: 0, photos: 0, faces: 0, version: 0 };
  }

  async facesDone(galleryId: string) {
    this.calls++;
    return [...(this.faces.get(galleryId)?.done.keys() ?? [])].sort();
  }

  async faceSearchOn(galleryId: string) {
    this.calls++;
    return this.photos.get(galleryId)?.faceSearch === true;
  }

  async addFacesChunk(tenantId: string, galleryId: string, bytes: Uint8Array, keys: string[], faces: number): Promise<FacesMeta> {
    this.calls += 2;
    const f = this.faces.get(galleryId) ?? { tenantId, files: [], faces: 0, done: new Map<string, string | null>(), dirty: new Set<string>(), version: 0, createdAt: new Date().toISOString() };
    if (f.tenantId !== tenantId) throw new Error('face data belongs to another studio');
    this.faces.set(galleryId, f);
    const asked = [...new Set(keys)];
    const fresh = asked.filter((k) => !f.done.has(k));
    // As films_faces_add (0136): nothing new, nothing added (the file is deleted).
    if (!fresh.length) return { ...(await this.facesMeta(galleryId)), duplicate: true };
    const name = `${galleryId}/m${++this.faceSeq}.bin`;
    f.files.push({ name, bytes: bytes.slice() });
    for (const k of fresh) f.done.set(k, name);
    if (fresh.length < asked.length) f.dirty.add(name);
    f.faces += Math.max(0, faces);
    this.nextFaceVersion(f);
    return this.facesMeta(galleryId);
  }

  async facesChunk(galleryId: string, n: number) {
    this.calls += 2;
    const f = this.faces.get(galleryId);
    const file = f?.files[n];
    if (!f || !file) return null;
    const keys = [...f.done].filter(([, at]) => at === file.name || at === null).map(([k]) => k);
    return { bytes: file.bytes.slice(), keys, version: f.version };
  }

  async removeFaceKeys(galleryId: string, keys: string[]) {
    this.calls++;
    const f = this.faces.get(galleryId);
    if (!f) return { removed: 0, version: 0 };
    let removed = 0;
    let unknown = false;
    for (const k of new Set(keys)) {
      if (!f.done.has(k)) continue;
      const at = f.done.get(k);
      f.done.delete(k);
      removed++;
      if (at === null) unknown = true;
      else if (at) f.dirty.add(at);
    }
    if (unknown) for (const file of f.files) f.dirty.add(file.name);
    if (removed) this.nextFaceVersion(f);
    return { removed, version: f.version };
  }

  async facePlan(galleryId: string, keys: string[] | null, limit: number) {
    this.calls++;
    const f = this.faces.get(galleryId);
    if (!f) return { version: 0, more: 0, files: [] };
    const listed = f.files.map((x) => x.name);
    const wanted =
      keys === null
        ? listed.filter((n) => f.dirty.has(n)).sort()
        : keys.some((k) => f.done.get(k) === null)
          ? listed
          : [...new Set(keys.map((k) => f.done.get(k)).filter((n): n is string => Boolean(n) && listed.includes(n!)))].sort();
    const picked = wanted.slice(0, Math.max(0, limit));
    return {
      version: f.version,
      more: wanted.length - picked.length,
      files: picked.map((name) => ({ name, keys: [...f.done].filter(([, at]) => at === name || at === null).map(([k]) => k) })),
    };
  }

  async faceFile(name: string) {
    this.calls++;
    for (const f of this.faces.values()) {
      const file = f.files.find((x) => x.name === name);
      if (file) return file.bytes.slice();
    }
    return null;
  }

  async swapFaceFiles(galleryId: string, swaps: FaceSwap[]) {
    this.calls += swaps.filter((s) => s.bytes).length + 2;
    const f = this.faces.get(galleryId);
    if (!f) return [];
    const out: string[] = [];
    for (const s of swaps) {
      const i = f.files.findIndex((x) => x.name === s.old);
      if (i < 0) continue;
      if (!s.bytes) {
        f.files.splice(i, 1);
        for (const [k, at] of f.done) if (at === s.old) f.done.delete(k);
      } else {
        const name = `${galleryId}/m${++this.faceSeq}.bin`;
        f.files[i] = { name, bytes: s.bytes.slice() };
        for (const [k, at] of f.done) if (at === s.old || (at === null && s.keys.includes(k))) f.done.set(k, name);
      }
      f.dirty.delete(s.old);
      f.faces = Math.max(0, f.faces - Math.max(0, s.faces));
      out.push(s.old);
    }
    if (out.length) this.nextFaceVersion(f);
    return out;
  }

  async faceDirtyCandidates(limit: number) {
    this.calls++;
    const rows = [...this.faces].filter(([, f]) => f.dirty.size > 0);
    rows.sort(([a, x], [b, y]) => Number(Boolean(x.failedAt)) - Number(Boolean(y.failedAt)) || (x.failedAt ?? '').localeCompare(y.failedAt ?? '') || a.localeCompare(b));
    return { ids: rows.slice(0, Math.max(0, limit)).map(([id]) => id), total: rows.length };
  }

  async logFaceSearch(tenantId: string, galleryId: string, role: FaceSearchRole, consent: string) {
    this.calls++;
    this.faceSearches.push({ tenantId, galleryId, role, consent, at: new Date().toISOString() });
  }

  async deleteFaces(galleryId: string, opts: { searchOff?: boolean } = {}) {
    this.calls += 3;
    const had = this.faces.has(galleryId);
    this.faces.delete(galleryId);
    this.orphanFaces.delete(galleryId);
    const p = this.photos.get(galleryId);
    // As films_faces_forget (0136): off only when there was face data, and the gallery remembers why.
    if (opts.searchOff && had && p?.faceSearch) {
      p.faceSearch = false;
      this.photoVersions.set(galleryId, (this.photoVersions.get(galleryId) ?? 1) + 1);
      this.followPhotos(galleryId, true);
      const g = this.galleries.get(galleryId);
      if (g) g.facesOffAt = new Date().toISOString();
    }
  }

  async faceGalleriesAmong(ids: string[]) {
    this.calls++;
    return [...new Set(ids)].filter((id) => this.faces.has(id)).sort();
  }

  async faceGalleryIds() {
    this.calls++;
    return [...this.faces.keys()].sort();
  }

  async faceCleanupCandidates(opts: { maxAgeDays: number; graceDays: number; limit: number }) {
    this.calls++;
    // Like films_faces_cleanup_candidates (0105).
    const now = Date.now();
    const DAY = 86_400_000;
    const rows: (FaceCleanupCandidate & { failedAt?: string; grp: number })[] = [];
    for (const [id, f] of this.faces) {
      const g = this.galleries.get(id);
      const p = this.photos.get(id);
      const ended = this.studioEnded.get(f.tenantId);
      const reason: FaceCleanupCandidate['reason'] | null = !g
        ? 'gone'
        : g.deletedAt
          ? 'trashed'
          : Date.parse(g.expiresAt) <= now
            ? 'closed'
            : g.kind !== 'photos' || p?.faceSearch !== true
              ? 'off'
              : Date.parse(f.createdAt) < now - opts.maxAgeDays * DAY
                ? 'too_old'
                : ended && Date.parse(ended) < now - opts.graceDays * DAY
                  ? 'studio_ended'
                  : null;
      if (reason) rows.push({ galleryId: id, reason, failedAt: f.failedAt, grp: 0 });
    }
    for (const [id, at] of this.orphanFaces) if (!this.faces.has(id) && Date.parse(at) < now - DAY) rows.push({ galleryId: id, reason: 'orphan_files', grp: 1 });
    rows.sort((a, b) => Number(Boolean(a.failedAt)) - Number(Boolean(b.failedAt)) || a.grp - b.grp || (a.failedAt ?? '').localeCompare(b.failedAt ?? '') || a.galleryId.localeCompare(b.galleryId));
    return { items: rows.slice(0, Math.max(0, opts.limit)).map(({ galleryId, reason }) => ({ galleryId, reason })), total: rows.length };
  }

  async markFaceCleanupFailed(galleryId: string) {
    this.calls++;
    const f = this.faces.get(galleryId);
    if (f) f.failedAt = new Date().toISOString();
  }

  /** The hub's album orders, as films_album_order_from_design (0080) keeps them. Every mock studio has album orders, at
   * a made-up ₪52 a page and 30 included pages (fix plan P53: not the real studio's 45 — no price comes from the code). */
  albumExtraPagePrice: number | null = 52;
  albumIncludedSpreads: number | null = 30;
  albumOrders = new Map<string, { id: string; workflowStatus: string; paymentStatus: string; tokenHash: string | null; revoked: boolean; spreads: number }>();
  noAlbumOrders = new Set<string>();
  /** The studio's open album orders of an event with no gallery yet (P57: a sent album joins the first), by event id. */
  eventAlbumOrders = new Map<string, { id: string; tenantId: string; paid?: boolean; sketches?: boolean }[]>();
  /** The hub's events, id → studio (seedEvent). */
  events = new Map<string, string>();
  seedEvent(id: string, tenantId: string) {
    this.events.set(id, tenantId);
  }
  async eventInStudio(tenantId: string, eventId: string) {
    return this.events.get(eventId) === tenantId;
  }
  /** As films_album_order_confirm_spreads (0140). */
  async confirmAlbumSpreads(galleryId: string, spreads: number) {
    const o = this.albumOrders.get(galleryId);
    if (!o || !this.galleries.has(galleryId)) return null;
    const before = o.spreads ?? null;
    o.spreads = spreads;
    return { id: o.id, spreads, before };
  }
  /** As films_print_links_expire (0140). */
  async expirePrintLinks(days: number) {
    this.calls++;
    const before = Date.now() - Math.max(1, days) * 86_400_000;
    let n = 0;
    for (const g of this.galleries.values()) {
      if (g.printToken && g.printTokenAt && Date.parse(g.printTokenAt) < before) {
        delete g.printToken;
        delete g.printTokenAt;
        n++;
      }
    }
    return n;
  }
  /** Test hook: when a studio was cancelled (tenants.status 'canceled' + status_changed_at), by studio id. */
  canceledAt = new Map<string, string>();
  /** As films_close_lapsed_studios (0140): cancelled more than the grace (at least 30 days) ago and not active. */
  async closeLapsedStudios(graceDays: number) {
    this.calls++;
    const before = Date.now() - Math.max(30, graceDays) * 86_400_000;
    const now = Date.now();
    const iso = new Date(now).toISOString();
    const out = { studios: 0, galleries: 0, printLinks: 0 };
    for (const [tenantId, at] of this.canceledAt) {
      if (Date.parse(at) >= before || this.tenants.get(tenantId)?.access === 'ok') continue;
      const mine = [...this.galleries.values()].filter((g) => g.tenantId === tenantId);
      const open = mine.filter((g) => !g.deletedAt && Date.parse(g.expiresAt) > now);
      const linked = mine.filter((g) => g.printToken);
      if (!open.length && !linked.length) continue;
      out.studios++;
      for (const g of open) {
        g.expiresAt = iso;
        g.days = Math.max(g.days || 1, 1);
      }
      for (const g of linked) {
        delete g.printToken;
        delete g.printTokenAt;
      }
      out.galleries += open.length;
      out.printLinks += linked.length;
    }
    return out;
  }
  /**
   * The hub's sketch designs open to the couple, by the SHA-256 of the portal link (as films_album_design_bank, 0173,
   * reads album_orders + album_designs). A test seeds them; the studio's standing and `photos` come from its TenantInfo.
   */
  designBanks = new Map<string, { tenantId: string; orderId: string; galleries: string[]; open: boolean; revoked?: boolean }>();
  seedDesignBank(tokenHash: string, d: { tenantId: string; orderId: string; galleries: string[]; open?: boolean; revoked?: boolean }) {
    this.designBanks.set(tokenHash, { open: true, ...d });
  }
  async albumDesignBank(tokenHash: string): Promise<AlbumDesignBank> {
    const d = /^[0-9a-f]{64}$/.test(tokenHash) ? this.designBanks.get(tokenHash) : undefined;
    if (!d) return { ok: false, reason: 'not_found' };
    if (d.revoked) return { ok: false, reason: 'revoked' };
    const t = this.tenants.get(d.tenantId);
    if (!t || t.access === 'blocked' || !t.photos) return { ok: false, reason: 'unavailable' };
    if (!d.open) return { ok: false, reason: 'closed' };
    return { ok: true, tenantId: d.tenantId, orderId: d.orderId, readOnly: t.access === 'read_only', galleries: [...new Set(d.galleries.filter((g) => /^[0-9a-f]{8,32}$/.test(g)))] };
  }

  /** Test hook: the next albumOrderState / albumOrderFromDesign calls throw (a passing database error). */
  failAlbumOrders = { state: 0, fromDesign: 0 };
  async albumOrderState(galleryId: string): Promise<AlbumOrderState> {
    if (this.failAlbumOrders.state > 0 && this.failAlbumOrders.state--) throw new Error('album order state failed (test)');
    const g = this.galleries.get(galleryId);
    if (!g || this.noAlbumOrders.has(g.tenantId)) return { crm: false };
    const o = this.albumOrders.get(galleryId);
    return {
      crm: true,
      extraPagePrice: this.albumExtraPagePrice,
      includedSpreads: this.albumIncludedSpreads,
      order: o ? { id: o.id, workflowStatus: o.workflowStatus, paymentStatus: o.paymentStatus, tokenHash: o.tokenHash, revoked: o.revoked, spreads: o.spreads } : null,
    };
  }

  /** As films_album_order_from_design (0139): the three payment states, and a gallery of an event joins its open order. */
  async albumOrderFromDesign(galleryId: string, spreads: number, tokenHash: string) {
    if (this.failAlbumOrders.fromDesign > 0 && this.failAlbumOrders.fromDesign--) throw new Error('album order failed (test)');
    const g = this.galleries.get(galleryId);
    if (!g || this.noAlbumOrders.has(g.tenantId)) return null;
    const o = this.albumOrders.get(galleryId);
    if (!o) {
      const open = g.eventId ? (this.eventAlbumOrders.get(g.eventId) ?? []) : [];
      const i = open.findIndex((x) => x.tenantId === g.tenantId && !x.paid && !x.sketches);
      const joined = i >= 0;
      const id = joined ? open.splice(i, 1)[0].id : crypto.randomUUID();
      const made = { id, workflowStatus: 'approved', paymentStatus: 'unpaid', tokenHash, revoked: false, spreads };
      this.albumOrders.set(galleryId, made);
      return { id: made.id, workflowStatus: made.workflowStatus, created: !joined, joined };
    }
    if (o.paymentStatus === 'unpaid' && !['paid', 'in_print', 'delivered', 'completed'].includes(o.workflowStatus)) {
      Object.assign(o, { spreads, workflowStatus: 'approved', tokenHash: o.tokenHash ?? tokenHash });
    } else if (o.paymentStatus === 'transfer_pending_review' && ['approved', 'product_selected', 'awaiting_payment'].includes(o.workflowStatus)) {
      // A proof the studio has not checked is not a payment: the new pages are bought again.
      Object.assign(o, { spreads, workflowStatus: 'approved', paymentStatus: 'unpaid', tokenHash: o.tokenHash ?? tokenHash });
    }
    return { id: o.id, workflowStatus: o.workflowStatus, created: false, joined: false };
  }

  lists: (PhotoList & { galleryId: string })[] = [];
  async listLists(galleryId: string) {
    return this.lists.filter((l) => l.galleryId === galleryId).map(({ id, name, keys }) => ({ id, name, keys: [...keys] }));
  }
  async createList(galleryId: string, list: PhotoList) {
    if (!this.galleries.has(galleryId)) return null;
    const found = this.lists.find((l) => l.galleryId === galleryId && l.name === list.name);
    if (found) return this.toggleList(galleryId, found.id, list.keys, true);
    if (this.lists.filter((l) => l.galleryId === galleryId).length >= MAX_LISTS) return 'too_many' as const;
    this.lists.push({ id: list.id, name: list.name, keys: [...new Set(list.keys)], galleryId });
    return { id: list.id, name: list.name, keys: [...new Set(list.keys)] };
  }
  async toggleList(galleryId: string, listId: string, keys: string[], on: boolean) {
    const l = this.lists.find((x) => x.galleryId === galleryId && x.id === listId);
    if (!l) return null;
    l.keys = on ? [...new Set([...l.keys, ...keys])] : l.keys.filter((k) => !keys.includes(k));
    return { id: l.id, name: l.name, keys: [...l.keys] };
  }
  async renameList(galleryId: string, listId: string, name: string) {
    const l = this.lists.find((x) => x.galleryId === galleryId && x.id === listId);
    if (!l) return null;
    if (this.lists.some((x) => x.galleryId === galleryId && x.id !== listId && x.name === name)) throw new HttpError(400, LIST_NAME_TAKEN);
    l.name = name;
    return { id: l.id, name: l.name, keys: [...l.keys] };
  }
  async deleteList(galleryId: string, listId: string) {
    this.lists = this.lists.filter((l) => !(l.galleryId === galleryId && l.id === listId));
  }

  insta: { galleryId: string; key: string }[] = [];
  async listInsta(galleryId: string) {
    return this.insta.filter((x) => x.galleryId === galleryId).map((x) => x.key);
  }

  async setInstaMany(_tenantId: string, galleryId: string, keys: string[], on: boolean) {
    this.calls++;
    for (const key of [...new Set(keys)].sort()) {
      const i = this.insta.findIndex((x) => x.galleryId === galleryId && x.key === key);
      if (on && i < 0) this.insta.push({ galleryId, key });
      if (!on && i >= 0) this.insta.splice(i, 1);
    }
  }

  music = new Map<string, { bytes: ArrayBuffer; type: string }>();
  async putMusic(tenantId: string, id: string, bytes: ArrayBuffer, type: string) {
    this.music.set(`${tenantId}/${id}`, { bytes, type });
  }

  async getMusic(tenantId: string, id: string, range: string | null) {
    const m = this.music.get(`${tenantId}/${id}`);
    if (!m) return null;
    const total = m.bytes.byteLength;
    const r = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
    if (r && (r[1] || r[2])) {
      const start = r[1] ? Number(r[1]) : Math.max(0, total - Number(r[2]));
      const end = r[1] && r[2] ? Math.min(total - 1, Number(r[2])) : total - 1;
      if (start >= total || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      return new Response(m.bytes.slice(start, end + 1), { status: 206, headers: { 'Content-Type': m.type, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(m.bytes, { headers: { 'Content-Type': m.type, 'Content-Length': String(total) } });
  }

  async deleteMusic(tenantId: string, id: string) {
    this.music.delete(`${tenantId}/${id}`);
  }

  hits = new Map<string, number[]>();
  /** Test switch: the rate-limit table cannot be read (fix plan P10: the lead form refuses then). */
  failHits = false;
  async hit(key: string, max: number, windowSeconds: number, opts: { failClosed?: boolean } = {}) {
    if (this.failHits) {
      if (opts.failClosed) throw new Error('rate limit unavailable');
      return true;
    }
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - windowSeconds * 1000);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Test switch: the guess counter fails (the database is unreachable). */
  failCounter = false;
  async failures(key: string, windowSeconds: number, add: boolean) {
    if (this.failCounter) throw new Error('counter unavailable');
    const now = Date.now();
    const recent = (this.hits.get(`fail:${key}`) ?? []).filter((t) => t > now - windowSeconds * 1000);
    if (add) recent.push(now);
    this.hits.set(`fail:${key}`, recent);
    return recent.length;
  }

  notices: { tenantId: string; type: string; title: string; body: string }[] = [];
  /** Test switch: the bell cannot be written (the database is unreachable). */
  failNotify = false;
  async notifyStudio(tenantId: string, n: { type: string; title: string; body: string }) {
    this.calls++;
    if (this.failNotify) throw new Error('notifications unavailable');
    this.notices.push({ tenantId, ...n });
  }

  /** Mails films-link-alert would have sent. `mailSender`: the platform's verified sender is set up (else 'skipped'). */
  mails: { tenantId: string; mail: StudioMail }[] = [];
  mailSender = false;
  async emailStudio(tenantId: string, mail: StudioMail): Promise<'sent' | 'skipped' | 'failed'> {
    this.calls++;
    if (!this.mailSender) return 'skipped';
    this.mails.push({ tenantId, mail: structuredClone(mail) });
    return 'sent';
  }

  /** As films_dropbox_impact (0153). */
  async dropboxImpact(tenantId: string): Promise<DropboxImpact> {
    this.calls++;
    const now = Date.now();
    const open = [...this.galleries.values()].filter((g) => g.tenantId === tenantId && !g.deletedAt && Date.parse(g.expiresAt) > now);
    const perGallery = open.filter((g) => kindOf(g) === 'films').map((g) => g.films.filter((f) => CONNECTION_PROVIDERS.includes(f.provider)).length);
    return {
      photoGalleries: open.filter((g) => kindOf(g) === 'photos' && ['dropbox', 'dropbox-link'].includes(this.photos.get(g.id)?.provider ?? '')).length,
      films: perGallery.reduce((a, b) => a + b, 0),
      filmGalleries: perGallery.filter((n) => n > 0).length,
    };
  }

  /** As films_link_check_candidates (0153). */
  async filmCheckCandidates(opts: { after?: string; start?: string; limit: number }): Promise<FilmCheckGallery[]> {
    this.calls++;
    const now = Date.now();
    const reachable = (tenantId: string) => {
      const t = this.tenants.get(tenantId);
      return Boolean(t && t.access !== 'blocked' && t.films);
    };
    return [...this.galleries.values()]
      .filter((g) => kindOf(g) === 'films' && !g.deletedAt && Date.parse(g.expiresAt) > now && g.films.length > 0 && reachable(g.tenantId))
      .filter((g) => (opts.start ? g.id >= opts.start : g.id > (opts.after ?? '')))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, Math.max(1, Math.min(opts.limit, 50)))
      .map((g) => ({ id: g.id, tenantId: g.tenantId, coupleName: g.coupleName, films: structuredClone(g.films) }));
  }

  terms: ((Omit<TermsAccept, 'role' | 'linkId'> & Partial<Pick<TermsAccept, 'role' | 'linkId'>>) & { acceptedAt: string })[] = [];
  async recordTermsAccept(a: TermsAccept) {
    this.terms.push({ ...a, userAgent: a.userAgent.slice(0, 200), acceptedAt: new Date().toISOString() });
  }

  async termsAccepts(galleryId: string): Promise<TermsSummary> {
    return termsSummary(this.terms.filter((t) => t.galleryId === galleryId).map((t) => ({ acceptedAt: t.acceptedAt, role: t.role ?? null })));
  }
}

/** The trash queue's `blocked` (films_trash_candidates, 0135) for a gallery's album order. */
function trashBlock(o: { workflowStatus: string; paymentStatus: string } | undefined): BlockedTrash['reason'] | null {
  if (!o) return null;
  if (o.paymentStatus === 'paid' || o.workflowStatus === 'paid' || o.workflowStatus === 'in_print') return 'album_paid';
  if (o.workflowStatus !== 'delivered' && o.workflowStatus !== 'completed') return 'album_order';
  return null;
}
