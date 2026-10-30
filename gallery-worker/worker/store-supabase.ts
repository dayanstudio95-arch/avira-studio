// Store backed by the StudioOS Supabase database, called over its REST API with
// the service role (RLS bypassed). Every query is scoped by tenant_id explicitly.
import type { Album, AlbumTemplate } from '../shared/album';
import { defaultFilmsStudio, GALLERY_LIST_FIELDS, MIT4MIT_TAKEN, type AlbumGuardState, type AuditEntry, type BlockedTrash, KEYS_PER_DELETE, LIST_NAME_TAKEN, SLUG_CHANGES_LIMIT, SLUG_INVALID, SLUG_RESERVED, SLUG_TAKEN, type Access, type GalleriesSummary, type GalleryOption, type AlbumOrderState, type AlbumDesignBank, type AlbumExpect, type AlbumWrite, type PrintAlbum, type CleanupRun, type CountedEvent, type DropboxImpact, type FilmCheckGallery, type StudioMail, type FaceChunkRead, type FaceCleanupCandidate, type FacePlan, type FaceSearchRole, type FaceSwap, type FacesMeta, type FilmsStudio, type GalleryFields, type GalleryGuard, type PatchedPhotos, type PhotoDiff, type PhotoItemRead, type PhotoList, type Store, type StudioUser, type TenantInfo, type TermsAccept, type TermsSummary } from './store';
import type { Film, Gallery, Lead, MusicTrack, PhotoData, PhotoItem, Review, StudioPage } from './types';
import { randomId } from './auth';
import { HttpError } from './types';

type Row = Record<string, unknown>;

export class SupabaseStore implements Store {
  constructor(private url: string, private key: string) {}

  private calls = 0;
  /** Every request goes through here, so the clean-up can keep to its subrequest budget. */
  private fetch(input: string, init?: RequestInit): Promise<Response> {
    this.calls++;
    return fetch(input, init);
  }

  callCount(): number {
    return this.calls;
  }

  private async req(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
    };
    if (init.prefer) headers.Prefer = init.prefer;
    return this.fetch(`${this.url.replace(/\/$/, '')}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  }

  private async rows(path: string): Promise<Row[]> {
    const res = await this.req(path);
    if (!res.ok) throw new Error(`supabase ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as Row[];
  }

  /**
   * Every row a read matches, page by page (fix plan P70): PostgREST answers at most 1,000 rows, so a
   * single read of a gallery with 2,500 hearts or a studio with 1,200 galleries came back cut, without an
   * error. `path` must carry a fixed `order` (ending in a unique column), so pages never overlap. The first
   * page asks for the total (Prefer: count=exact) and the reading stops there; a failed page throws —
   * never a partial list.
   */
  private async allRows(path: string): Promise<Row[]> {
    const out: Row[] = [];
    let total = Infinity;
    while (out.length < total) {
      const first = out.length === 0;
      const res = await this.req(`${path}&limit=${ROWS_PER_PAGE}&offset=${out.length}`, first ? { prefer: 'count=exact' } : {});
      if (!res.ok) throw new Error(`supabase ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const rows = (await res.json()) as Row[];
      if (first) total = countOf(res, rows.length);
      if (rows.length === 0) break;
      out.push(...rows);
    }
    return out;
  }

  private async write(path: string, method: string, body?: unknown, prefer?: string): Promise<Response> {
    const res = await this.req(path, { method, body: body === undefined ? undefined : JSON.stringify(body), prefer });
    if (!res.ok) throw Object.assign(new Error(`supabase ${method} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
    return res;
  }

  async userFromToken(token: string): Promise<StudioUser | null> {
    const res = await this.fetch(`${this.url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: this.key, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    if (!user?.id) return null;
    const [profile] = await this.rows(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=tenant_id,role,is_active`);
    if (!profile?.tenant_id || profile.is_active === false) return null;
    return { userId: user.id, tenantId: String(profile.tenant_id), role: String(profile.role) };
  }

  /**
   * Reads kept for this request only (fix plan P62): a SupabaseStore is made for one request
   * (storeFor), and the studio, its films settings and its secrets were read several times in one.
   * Forgotten on every write to them (setSlug, patchFilmsStudio, setSecret) and on every failure;
   * a failed read is never kept.
   */
  private memo = new Map<string, Promise<unknown>>();

  private remember<T>(key: string, load: () => Promise<T>): Promise<T> {
    const kept = this.memo.get(key) as Promise<T> | undefined;
    if (kept) return kept;
    const p = load();
    this.memo.set(key, p);
    p.catch(() => this.memo.clear());
    return p;
  }

  /** A write to what `remember` keeps: whatever happens, the next read asks the database again. */
  private async forgetting<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } finally {
      this.memo.clear();
    }
  }

  async getTenant(tenantId: string): Promise<TenantInfo | null> {
    // One call (films_tenant_info, 0130) instead of a select and three RPCs.
    const t = await this.remember(`tenant:${tenantId}`, async () => {
      const res = await this.write('/rest/v1/rpc/films_tenant_info', 'POST', { p_tenant_id: tenantId });
      return (await res.json()) as Row | null;
    });
    if (!t) return null;
    return {
      id: String(t.id),
      name: String(t.name ?? ''),
      displayName: String(t.display_name_to_clients || t.name || ''),
      logoUrl: String(t.logo_url ?? ''),
      phone: String(t.whatsapp_number || t.phone || ''),
      instagramUrl: String(t.instagram_url ?? ''),
      facebookUrl: String(t.facebook_url ?? ''),
      slug: String(t.slug ?? ''),
      accentColor: String(t.accent_color ?? ''),
      access: ((t.access as Access) || 'blocked'),
      films: t.films === true,
      photos: t.photos === true,
      accessVersion: Number(t.access_version ?? 0),
    };
  }

  async tenantIdBySlug(slug: string): Promise<string | null> {
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
    const [t] = await this.rows(`/rest/v1/tenants?slug=eq.${encodeURIComponent(slug)}&select=id`);
    return t ? String(t.id) : null;
  }

  async tenantIdByOldSlug(slug: string): Promise<string | null> {
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
    const [h] = await this.rows(`/rest/v1/tenant_slug_history?slug=eq.${encodeURIComponent(slug)}&select=tenant_id&order=released_at.desc,id.desc&limit=1`);
    return h ? String(h.tenant_id) : null;
  }

  async setSlug(tenantId: string, slug: string): Promise<void> {
    try {
      await this.forgetting(() => this.write(`/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}`, 'PATCH', { slug }));
    } catch (e) {
      const status = (e as { status?: number }).status;
      // The trigger on tenants (0134) says which rule refused it; a unique clash is another studio's address now.
      const text = (e as Error).message;
      if (text.includes('slug_reserved')) throw new HttpError(400, SLUG_RESERVED);
      if (text.includes('slug_change_limit')) throw new HttpError(400, SLUG_CHANGES_LIMIT);
      if (status === 409) throw new HttpError(400, SLUG_TAKEN);
      if (status === 400) throw new HttpError(400, SLUG_INVALID);
      throw e;
    }
  }

  async bumpAccessVersion(tenantId: string): Promise<number> {
    return this.forgetting(async () => {
      const res = await this.write('/rest/v1/rpc/films_bump_access_version', 'POST', { p_tenant_id: tenantId });
      return Number(await res.json());
    });
  }

  async getFilmsStudio(tenantId: string): Promise<FilmsStudio> {
    // A copy each time: a route that edits what it read never changes what the next read gets.
    return structuredClone(await this.remember(`films:${tenantId}`, () => this.readFilmsStudio(tenantId)));
  }

  private async readFilmsStudio(tenantId: string): Promise<FilmsStudio> {
    const [r] = await this.rows(`/rest/v1/films_studio_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`);
    if (!r) return defaultFilmsStudio();
    return {
      defaultDays: Number(r.default_days ?? 30),
      termsText: (r.terms_text as string | null) ?? null,
      contactLine: String(r.contact_line ?? ''),
      vimeo: String(r.vimeo_url ?? ''),
      youtube: String(r.youtube_url ?? ''),
      headline: String(r.headline ?? ''),
      about: String(r.about ?? ''),
      pageEnabled: Boolean(r.page_enabled),
      mit4mitUrl: (r.mit4mit_url as string) || undefined,
      showcase: { ...((r.showcase as StudioPage['showcase']) ?? {}), films: (r.showcase as StudioPage['showcase'] | null)?.films ?? [] },
      reviews: (r.reviews as Review[]) ?? [],
      dropboxAccountName: (r.dropbox_account_name as string) || undefined,
      labelSetsOn: r.label_sets_on === true,
      labelMap: (r.label_map as Record<string, string>) ?? undefined,
      music: (r.music as MusicTrack[]) ?? [],
      albumLayouts: (r.album_layouts as AlbumTemplate[]) ?? [],
      musicDefault: (r.music_default as string) || undefined,
      designDefault: (r.design_default as FilmsStudio['designDefault']) ?? undefined,
      mit4mitBizId: (r.mit4mit_biz_id as string) || undefined,
      mit4mitRemoved: (r.mit4mit_removed as string[]) ?? [],
      mit4mitLinkedAt: (r.mit4mit_linked_at as string) || undefined,
      mit4mitApprovedAt: (r.mit4mit_approved_at as string) || undefined,
    };
  }

  async patchFilmsStudio(tenantId: string, fields: Partial<FilmsStudio>): Promise<void> {
    // An upsert with only these columns: PostgREST updates just them, so a song uploaded while
    // other settings were saved stays (fix plan P60).
    try {
      await this.forgetting(() =>
        this.write(
          '/rest/v1/films_studio_settings?on_conflict=tenant_id',
          'POST',
          { tenant_id: tenantId, ...studioColumns(fields), updated_at: new Date().toISOString() },
          'resolution=merge-duplicates',
        ),
      );
    } catch (e) {
      // Another studio has this mit4mit business (the unique index of 0135).
      if ((e as { status?: number }).status === 409 && (e as Error).message.includes('mit4mit_biz')) throw new HttpError(409, MIT4MIT_TAKEN);
      throw e;
    }
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.write('/rest/v1/audit_logs', 'POST', {
      tenant_id: entry.tenantId,
      actor_id: entry.actorId,
      actor_role: entry.actorRole,
      action: 'update',
      table_name: entry.table,
      record_id: entry.recordId,
      changed_fields: entry.changes,
    });
  }

  async getGallery(id: string): Promise<Gallery | null> {
    if (!/^[a-f0-9]{16}$/.test(id)) return null;
    const [r] = await this.rows(`/rest/v1/films_galleries?id=eq.${id}&select=*`);
    return r ? toGallery(r) : null;
  }

  async getGalleryByGuestId(guestId: string): Promise<Gallery | null> {
    if (!/^[a-f0-9]{16}$/.test(guestId)) return null;
    const [r] = await this.rows(`/rest/v1/films_galleries?guest_id=eq.${guestId}&select=*`);
    return r ? toGallery(r) : null;
  }

  async getGalleryByPrintToken(token: string): Promise<Gallery | null> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const [r] = await this.rows(`/rest/v1/films_galleries?print_token=eq.${encodeURIComponent(token)}&select=*`);
    return r ? toGallery(r) : null;
  }

  async listGalleries(tenantId: string): Promise<Gallery[]> {
    return (await this.allRows(`/rest/v1/films_galleries?tenant_id=eq.${encodeURIComponent(tenantId)}&select=${LIST_COLUMNS}&order=created_at.desc,id.desc`)).map(toGallery);
  }

  async pageGalleries(tenantId: string, limit: number, offset: number): Promise<{ galleries: Gallery[]; total: number }> {
    const n = Math.max(1, Math.min(ROWS_PER_PAGE, Math.floor(limit)));
    const res = await this.req(`/rest/v1/films_galleries?tenant_id=eq.${encodeURIComponent(tenantId)}&select=${LIST_COLUMNS}&order=created_at.desc,id.desc&limit=${n}&offset=${Math.max(0, Math.floor(offset))}`, { prefer: 'count=exact' });
    if (!res.ok) throw new Error(`supabase /rest/v1/films_galleries: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as Row[];
    return { galleries: rows.map(toGallery), total: countOf(res, rows.length) };
  }

  async galleryOptions(tenantId: string): Promise<GalleryOption[]> {
    const rows = await this.allRows(`/rest/v1/films_galleries?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,kind,couple_name,event_date,deleted_at&order=created_at.desc,id.desc`);
    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind === 'photos' ? 'photos' : 'films',
      coupleName: String(r.couple_name ?? ''),
      date: String(r.event_date ?? ''),
      ...(r.deleted_at ? { deletedAt: String(r.deleted_at) } : {}),
    }));
  }

  async getGalleries(tenantId: string, ids: string[]): Promise<Gallery[]> {
    const wanted = galleryIds(ids);
    if (!wanted.length) return [];
    const rs = await this.rows(`/rest/v1/films_galleries?id=in.(${wanted.join(',')})&tenant_id=eq.${encodeURIComponent(tenantId)}&select=*`);
    return rs.map(toGallery);
  }

  async putGallery(g: Gallery): Promise<void> {
    // A plain insert: a stale copy of an existing gallery can't overwrite it (fix plan P60).
    await this.write('/rest/v1/films_galleries', 'POST', fromGallery(g));
  }

  async putGalleries(list: Gallery[]): Promise<void> {
    // One statement: every row goes in, or (any row refused) none does.
    if (list.length) await this.write('/rest/v1/films_galleries', 'POST', list.map(fromGallery));
  }

  async patchGalleries(tenantId: string, ids: string[], fields: GalleryFields, only: GalleryGuard = {}): Promise<string[]> {
    const wanted = galleryIds(ids);
    const cols = galleryColumns(fields);
    if (!wanted.length || Object.keys(cols).length === 0) return [];
    const res = await this.write(`/rest/v1/films_galleries?${guarded(`id=in.(${wanted.join(',')})&tenant_id=eq.${encodeURIComponent(tenantId)}`, only)}&select=id`, 'PATCH', { ...cols, updated_at: new Date().toISOString() }, 'return=representation');
    return ((await res.json()) as Row[]).map((r) => String(r.id));
  }

  async deleteGalleries(tenantId: string, ids: string[]): Promise<string[]> {
    const wanted = galleryIds(ids);
    if (!wanted.length) return [];
    const res = await this.write(`/rest/v1/films_galleries?id=in.(${wanted.join(',')})&tenant_id=eq.${encodeURIComponent(tenantId)}&deleted_at=not.is.null&select=id`, 'DELETE', undefined, 'return=representation');
    return ((await res.json()) as Row[]).map((r) => String(r.id));
  }

  async extendGalleries(tenantId: string, items: { id: string; seen: string }[], days: number): Promise<{ id: string; expiresAt: string; days: number }[]> {
    if (!items.length) return [];
    const res = await this.write('/rest/v1/rpc/films_galleries_extend', 'POST', { p_tenant_id: tenantId, p_items: items, p_days: Math.floor(days) });
    return ((await res.json()) as { id: string; expiresAt: string; days: number }[] | null ?? []).map((r) => ({ id: String(r.id), expiresAt: String(r.expiresAt), days: Number(r.days) }));
  }

  async galleriesSummary(tenantId: string, kinds: { films: boolean; photos: boolean }): Promise<GalleriesSummary> {
    const res = await this.write('/rest/v1/rpc/films_dashboard', 'POST', { p_tenant_id: tenantId, p_films: Boolean(kinds.films), p_photos: Boolean(kinds.photos) });
    const r = (await res.json()) as GalleriesSummary;
    const briefs = (list: GalleriesSummary['closing'] | null) => (list ?? []).map((b) => ({ ...b, id: String(b.id), date: String(b.date ?? ''), expiresAt: String(b.expiresAt) }));
    return {
      open: Number(r.open),
      closed: Number(r.closed),
      trash: Number(r.trash),
      closing: briefs(r.closing),
      mostViewed: briefs(r.mostViewed),
      albumsSent: (r.albumsSent ?? []).map((a) => ({ galleryId: String(a.galleryId), coupleName: String(a.coupleName ?? ''), submittedAt: String(a.submittedAt ?? '') })),
    };
  }

  async patchGallery(tenantId: string, id: string, fields: GalleryFields, only: GalleryGuard = {}): Promise<Gallery | null> {
    if (!/^[a-f0-9]{16}$/.test(id)) return null;
    const where = guarded(`id=eq.${id}&tenant_id=eq.${encodeURIComponent(tenantId)}`, only);
    const cols = galleryColumns(fields);
    if (Object.keys(cols).length === 0) {
      const [r] = await this.rows(`/rest/v1/films_galleries?${where}&select=*`);
      return r ? toGallery(r) : null;
    }
    const res = await this.write(`/rest/v1/films_galleries?${where}&select=*`, 'PATCH', { ...cols, updated_at: new Date().toISOString() }, 'return=representation');
    const [r] = (await res.json()) as Row[];
    return r ? toGallery(r) : null;
  }

  async deleteGallery(id: string): Promise<void> {
    await this.write(`/rest/v1/films_galleries?id=eq.${encodeURIComponent(id)}`, 'DELETE');
  }

  async listSubmittedAlbums(tenantId: string): Promise<{ galleryId: string; submittedAt: string }[]> {
    const rows = await this.rows(`/rest/v1/films_albums?tenant_id=eq.${encodeURIComponent(tenantId)}&status=eq.submitted&select=gallery_id,submitted_at&order=submitted_at.desc&limit=50`);
    return rows.map((r) => ({ galleryId: String(r.gallery_id), submittedAt: String(r.submitted_at ?? '') }));
  }

  async trashCandidates(iso: string, limit: number): Promise<{ ids: string[]; total: number; blocked?: BlockedTrash[]; blockedTotal?: number }> {
    const res = await this.write('/rest/v1/rpc/films_trash_candidates', 'POST', { p_before: iso, p_limit: limit });
    const rows = (await res.json()) as Row[];
    // Galleries kept for their album order come apart (0135), with their own count.
    const free = rows.filter((r) => !r.blocked);
    const kept = rows.filter((r) => r.blocked);
    const out = { ids: free.map((r) => String(r.gallery_id)), total: Number(free[0]?.total ?? 0) };
    if (!kept.length) return out;
    return { ...out, blocked: kept.map((r) => ({ id: String(r.gallery_id), reason: r.blocked as BlockedTrash['reason'] })), blockedTotal: Number(kept[0].total ?? kept.length) };
  }

  async albumGuards(tenantId: string, ids: string[]): Promise<Record<string, AlbumGuardState>> {
    const wanted = galleryIds(ids);
    if (!wanted.length) return {};
    const res = await this.write('/rest/v1/rpc/films_album_guards', 'POST', { p_tenant_id: tenantId, p_ids: wanted });
    const out: Record<string, AlbumGuardState> = {};
    for (const r of (await res.json()) as Row[]) {
      out[String(r.gallery_id)] = {
        album: r.album_status === 'submitted' || r.album_status === 'draft' ? r.album_status : null,
        order: r.workflow_status ? { workflowStatus: String(r.workflow_status), paymentStatus: String(r.payment_status ?? 'unpaid') } : null,
      };
    }
    return out;
  }

  async markPurgeFailed(galleryId: string): Promise<void> {
    await this.write(`/rest/v1/films_galleries?id=eq.${encodeURIComponent(galleryId)}`, 'PATCH', { purge_failed_at: new Date().toISOString() });
  }

  async recordCleanupRun(run: CleanupRun): Promise<void> {
    await this.write('/rest/v1/rpc/films_cleanup_record', 'POST', { p_run: run });
  }

  async sweepRateHits(): Promise<void> {
    await this.write('/rest/v1/rpc/films_sweep_rate_hits', 'POST', {});
  }

  async countEvent(id: string, type: CountedEvent): Promise<void> {
    await this.write('/rest/v1/rpc/films_count_event', 'POST', { p_id: id, p_type: type });
  }

  async getSecret(tenantId: string, key: string): Promise<string | null> {
    return this.remember(`secret:${tenantId}:${key}`, async () => {
      const [r] = await this.rows(`/rest/v1/tenant_secrets?tenant_id=eq.${encodeURIComponent(tenantId)}&key=eq.${encodeURIComponent(key)}&select=value`);
      return (r?.value as string) ?? null;
    });
  }

  async setSecret(tenantId: string, key: string, value: string | null): Promise<void> {
    await this.forgetting(async () => {
      if (value === null) {
        await this.write(`/rest/v1/tenant_secrets?tenant_id=eq.${encodeURIComponent(tenantId)}&key=eq.${encodeURIComponent(key)}`, 'DELETE');
        return;
      }
      await this.write(
        '/rest/v1/tenant_secrets?on_conflict=tenant_id,key',
        'POST',
        { tenant_id: tenantId, key, value, updated_at: new Date().toISOString() },
        'resolution=merge-duplicates',
      );
    });
  }

  async insertLead(tenantId: string, lead: Lead): Promise<{ duplicate: boolean }> {
    // One call (0154): the same phone in the last 30 days is not a second lead; the lead and its bell together.
    const notes = [lead.guests ? `מוזמנים: ${lead.guests}` : '', lead.note].filter(Boolean).join('\n');
    const res = await this.write('/rest/v1/rpc/films_insert_studio_lead', 'POST', {
      p_tenant_id: tenantId,
      p_lead: { coupleName: lead.coupleName, phone: lead.phone, date: lead.date || '', venue: lead.venue || '', notes },
    });
    const out = (await res.json()) as { duplicate?: boolean } | null;
    return { duplicate: out?.duplicate === true };
  }

  async getPhotos(galleryId: string): Promise<PhotoData | null> {
    const [r] = await this.rows(`/rest/v1/films_photos?gallery_id=eq.${encodeURIComponent(galleryId)}&select=data`);
    return (r?.data as PhotoData) ?? null;
  }

  async getPhotosVersioned(galleryId: string): Promise<{ data: PhotoData; version: number } | null> {
    const [r] = await this.rows(`/rest/v1/films_photos?gallery_id=eq.${encodeURIComponent(galleryId)}&select=data,version`);
    return r ? { data: r.data as PhotoData, version: Number(r.version ?? 1) } : null;
  }

  async savePhotos(tenantId: string, galleryId: string, data: PhotoData, expected?: number | null): Promise<boolean> {
    const updated_at = new Date().toISOString();
    const g = encodeURIComponent(galleryId);
    if (expected === undefined) {
      await this.write('/rest/v1/films_photos?on_conflict=gallery_id', 'POST', { gallery_id: galleryId, tenant_id: tenantId, data, updated_at }, 'resolution=merge-duplicates');
      return true;
    }
    if (expected === null) {
      // First list of the gallery: an insert that yields to one made meanwhile. A gallery removed
      // meanwhile fails its foreign key (409) instead of coming back.
      try {
        const res = await this.write('/rest/v1/films_photos?on_conflict=gallery_id&select=version', 'POST', { gallery_id: galleryId, tenant_id: tenantId, data, updated_at }, 'resolution=ignore-duplicates,return=representation');
        return ((await res.json()) as Row[]).length > 0;
      } catch (e) {
        if ((e as { status?: number }).status === 409) throw new HttpError(404, 'הגלריה לא נמצאה');
        throw e;
      }
    }
    const res = await this.write(
      `/rest/v1/films_photos?gallery_id=eq.${g}&tenant_id=eq.${encodeURIComponent(tenantId)}&version=eq.${Math.floor(expected)}&select=version`,
      'PATCH',
      { data, updated_at },
      'return=representation',
    );
    return ((await res.json()) as Row[]).length > 0;
  }

  async getPhotoItem(tenantId: string, galleryId: string, key: string, opts: { copies?: boolean } = {}): Promise<PhotoItemRead | null> {
    const res = await this.write('/rest/v1/rpc/films_photo_item', 'POST', { p_gallery_id: galleryId, p_tenant_id: tenantId, p_key: key, p_copies: opts.copies === true });
    const r = (await res.json()) as { item: PhotoItem | null; folder: Omit<PhotoData, 'items' | 'sets'>; copies: PhotoItem[]; version: number; visibleVersion: number } | null;
    if (!r) return null;
    return {
      data: { ...r.folder, sets: [], items: r.item ? [r.item, ...(r.copies ?? [])] : [] },
      item: r.item ?? null,
      version: Number(r.version),
      visibleVersion: Number(r.visibleVersion ?? 0),
    };
  }

  async patchPhotos(tenantId: string, galleryId: string, expected: number, diff: PhotoDiff): Promise<PatchedPhotos | 'conflict' | null> {
    const res = await this.write('/rest/v1/rpc/films_photos_patch', 'POST', {
      p_gallery_id: galleryId,
      p_tenant_id: tenantId,
      p_expected: Math.floor(expected),
      p_items: diff.items,
      p_order: diff.order,
      p_fields: diff.fields,
    });
    const r = (await res.json()) as (PatchedPhotos & { conflict?: boolean }) | null;
    if (!r) return null;
    if (r.conflict) return 'conflict';
    return { version: Number(r.version), photoCount: Number(r.photoCount), coverKey: r.coverKey ?? null, visibleVersion: Number(r.visibleVersion) };
  }

  async listHearts(galleryId: string): Promise<Record<string, string[]>> {
    // Hearts given together share their time: the key, then the name, keep the order fixed.
    const rows = await this.allRows(`/rest/v1/films_hearts?gallery_id=eq.${encodeURIComponent(galleryId)}&select=photo_key,who&order=created_at.asc,photo_key.asc,who.asc`);
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[String(r.photo_key)] ??= []).push(String(r.who ?? ''));
    return out;
  }

  async setHearts(tenantId: string, galleryId: string, keys: string[], on: boolean, who: string): Promise<void> {
    const unique = [...new Set(keys)];
    if (!unique.length) return;
    if (on) {
      const rows = unique.map((key) => ({ gallery_id: galleryId, tenant_id: tenantId, photo_key: key, who }));
      await this.write('/rest/v1/films_hearts?on_conflict=gallery_id,photo_key,who', 'POST', rows, 'resolution=ignore-duplicates');
      return;
    }
    for (const part of groupsOf(unique, KEYS_PER_DELETE)) {
      await this.write(`/rest/v1/films_hearts?gallery_id=eq.${encodeURIComponent(galleryId)}&photo_key=in.(${part.map(inValue).join(',')})&who=eq.${encodeURIComponent(who)}`, 'DELETE');
    }
  }

  async getAlbum(galleryId: string): Promise<Album | null> {
    const [r] = await this.rows(`/rest/v1/films_albums?gallery_id=eq.${encodeURIComponent(galleryId)}&select=data,rev`);
    return r?.data ? { ...(r.data as Album), rev: Number(r.rev ?? 0) } : null;
  }

  async putAlbum(tenantId: string, galleryId: string, album: Album, expect: AlbumExpect = {}): Promise<AlbumWrite> {
    const { rev: _rev, ...data } = album;
    const res = await this.write('/rest/v1/rpc/films_album_put', 'POST', {
      p_tenant_id: tenantId,
      p_gallery_id: galleryId,
      p_data: data,
      p_rev: expect.rev ?? null,
      p_draft_only: expect.draftOnly === true,
    });
    const r = (await res.json()) as { ok: boolean; rev?: number; reason?: 'conflict' | 'submitted' | 'not_found'; data?: Album | null };
    if (r.ok) return { ok: true, rev: Number(r.rev) };
    return { ok: false, reason: r.reason ?? 'conflict', current: r.data ? { ...r.data, rev: Number(r.rev ?? 0) } : null };
  }

  async getPrintAlbum(galleryId: string): Promise<PrintAlbum | null> {
    const [r] = await this.rows(`/rest/v1/films_albums?gallery_id=eq.${encodeURIComponent(galleryId)}&select=print_data,print_submitted_at,status`);
    if (!r) return null;
    return { album: (r.print_data as Album | null) ?? null, submittedAt: r.print_submitted_at ? new Date(String(r.print_submitted_at)).toISOString() : '', open: r.status !== 'submitted' };
  }

  // ---------- face numbers (0081): private bucket films-faces/<gallery>/<file>.bin ----------
  private storage(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    return this.fetch(`${this.url.replace(/\/$/, '')}/storage/v1${path}`, { ...init, headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, ...(init.headers ?? {}) } });
  }

  async facesMeta(galleryId: string): Promise<FacesMeta> {
    // Never the scanned photos (P68: a guest's phone doesn't need them; facesDone reads them for the studio).
    const [r] = await this.rows(`/rest/v1/films_faces?gallery_id=eq.${encodeURIComponent(galleryId)}&select=chunks:files,photos,faces,version`);
    return { chunks: ((r?.chunks as string[]) ?? []).length, photos: Number(r?.photos ?? 0), faces: Number(r?.faces ?? 0), version: Number(r?.version ?? 0) };
  }

  async facesDone(galleryId: string): Promise<string[]> {
    const res = await this.write('/rest/v1/rpc/films_faces_done_keys', 'POST', { p_gallery_id: galleryId });
    return ((await res.json()) as string[] | null) ?? [];
  }

  async faceSearchOn(galleryId: string): Promise<boolean> {
    const [r] = await this.rows(`/rest/v1/films_photos?gallery_id=eq.${encodeURIComponent(galleryId)}&select=on:data->faceSearch`);
    return r?.on === true;
  }

  async addFacesChunk(tenantId: string, galleryId: string, bytes: Uint8Array, keys: string[], faces: number): Promise<FacesMeta> {
    const name = `${galleryId}/${Date.now().toString(36)}-${randomId()}.bin`;
    const up = await this.storage(`/object/films-faces/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
    if (!up.ok) throw new Error(`supabase storage upload: ${up.status} ${(await up.text()).slice(0, 200)}`);
    const res = await this.write('/rest/v1/rpc/films_faces_add', 'POST', { p_gallery_id: galleryId, p_tenant_id: tenantId, p_file: name, p_keys: keys, p_faces: faces });
    const m = (await res.json()) as { chunks: number; photos: number; faces: number; version?: number; duplicate?: boolean };
    // Nothing new in it (two tabs, a retry): the file is not listed, so it goes.
    if (m.duplicate) await this.deleteFaceObjects([name]).catch(() => {});
    return { chunks: m.chunks, photos: m.photos, faces: m.faces, version: Number(m.version ?? 0), ...(m.duplicate ? { duplicate: true } : {}) };
  }

  async facesChunk(galleryId: string, n: number): Promise<FaceChunkRead | null> {
    const res = await this.write('/rest/v1/rpc/films_faces_chunk', 'POST', { p_gallery_id: galleryId, p_n: n });
    const c = (await res.json()) as { file?: string; keys?: string[]; version?: number } | null;
    if (!c?.file) return null;
    const bytes = await this.faceFile(c.file);
    return bytes ? { bytes, keys: c.keys ?? [], version: Number(c.version ?? 0) } : null;
  }

  async removeFaceKeys(galleryId: string, keys: string[]): Promise<{ removed: number; version: number }> {
    if (!keys.length) return { removed: 0, version: 0 };
    const res = await this.write('/rest/v1/rpc/films_faces_remove', 'POST', { p_gallery_id: galleryId, p_keys: keys });
    const r = (await res.json()) as { removed?: number; version?: number };
    return { removed: Number(r?.removed ?? 0), version: Number(r?.version ?? 0) };
  }

  async facePlan(galleryId: string, keys: string[] | null, limit: number): Promise<FacePlan> {
    const res = await this.write('/rest/v1/rpc/films_faces_plan', 'POST', { p_gallery_id: galleryId, p_keys: keys, p_limit: limit });
    const p = (await res.json()) as FacePlan | null;
    return { version: Number(p?.version ?? 0), more: Number(p?.more ?? 0), files: p?.files ?? [] };
  }

  async faceFile(name: string): Promise<Uint8Array | null> {
    const res = await this.storage(`/object/films-faces/${name}`);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  }

  private async deleteFaceObjects(names: string[]): Promise<void> {
    if (!names.length) return;
    const del = await this.storage('/object/films-faces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }) });
    if (!del.ok) throw new Error(`supabase storage delete: ${del.status}`);
  }

  async swapFaceFiles(galleryId: string, swaps: FaceSwap[]): Promise<string[]> {
    if (!swaps.length) return [];
    const made: (string | null)[] = [];
    for (const s of swaps) {
      if (!s.bytes) {
        made.push(null);
        continue;
      }
      const name = `${galleryId}/${Date.now().toString(36)}-${randomId()}.bin`;
      const up = await this.storage(`/object/films-faces/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([s.bytes as Uint8Array<ArrayBuffer>]) });
      if (!up.ok) {
        await this.deleteFaceObjects(made.filter((m): m is string => Boolean(m))).catch(() => {});
        throw new Error(`supabase storage upload: ${up.status} ${(await up.text()).slice(0, 200)}`);
      }
      made.push(name);
    }
    const body = swaps.map((s, i) => ({ old: s.old, new: made[i], keys: s.keys, faces: s.faces }));
    const res = await this.write('/rest/v1/rpc/films_faces_swap', 'POST', { p_gallery_id: galleryId, p_swaps: body });
    const swapped = new Set(((await res.json()) as string[] | null) ?? []);
    // The old files swapped out, and the new files of swaps that no longer applied (changed meanwhile).
    const gone = body.flatMap((b) => (swapped.has(b.old) ? [b.old] : b.new ? [b.new] : []));
    await this.deleteFaceObjects(gone);
    return [...swapped];
  }

  async faceDirtyCandidates(limit: number): Promise<{ ids: string[]; total: number }> {
    const res = await this.write('/rest/v1/rpc/films_faces_dirty_candidates', 'POST', { p_limit: limit });
    const rows = (await res.json()) as Row[];
    return { ids: rows.map((r) => String(r.gallery_id)), total: Number(rows[0]?.total ?? 0) };
  }

  async logFaceSearch(tenantId: string, galleryId: string, role: FaceSearchRole, consent: string): Promise<void> {
    await this.write('/rest/v1/films_face_searches', 'POST', { gallery_id: galleryId, tenant_id: tenantId, role, consent }, 'return=minimal');
  }

  async deleteFaces(galleryId: string, opts: { searchOff?: boolean } = {}): Promise<void> {
    // A prefix of '' would list the whole bucket.
    if (!/^[a-f0-9]{16}$/.test(galleryId)) throw new Error(`deleteFaces: bad gallery id`);
    // Everything under the gallery's folder (also files a failed upload left without a record).
    // Usually one list and one delete: a page shorter than the limit was the last one.
    for (let round = 0; round < 50; round++) {
      const list = await this.storage('/object/list/films-faces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: galleryId, limit: 1000, offset: 0 }) });
      if (!list.ok) throw new Error(`supabase storage list: ${list.status}`);
      const names = ((await list.json()) as { name: string }[]).map((o) => `${galleryId}/${o.name}`);
      if (!names.length) break;
      const del = await this.storage('/object/films-faces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: names }) });
      if (!del.ok) throw new Error(`supabase storage delete: ${del.status}`);
      if (names.length < 1000) break;
    }
    // The record, and (searchOff) face search switched off, in one call (films_faces_forget, 0105).
    await this.write('/rest/v1/rpc/films_faces_forget', 'POST', { p_gallery_id: galleryId, p_search_off: Boolean(opts.searchOff) });
  }

  async faceGalleriesAmong(ids: string[]): Promise<string[]> {
    const wanted = galleryIds(ids);
    if (!wanted.length) return [];
    const rows = await this.rows(`/rest/v1/films_faces?gallery_id=in.(${wanted.join(',')})&select=gallery_id&order=gallery_id.asc`);
    return rows.map((r) => String(r.gallery_id));
  }

  async faceGalleryIds(): Promise<string[]> {
    const rows = await this.rows('/rest/v1/films_faces?select=gallery_id&order=gallery_id.asc&limit=5000');
    return rows.map((r) => String(r.gallery_id));
  }

  async faceCleanupCandidates(opts: { maxAgeDays: number; graceDays: number; limit: number }): Promise<{ items: FaceCleanupCandidate[]; total: number }> {
    const res = await this.write('/rest/v1/rpc/films_faces_cleanup_candidates', 'POST', { p_max_age_days: opts.maxAgeDays, p_grace_days: opts.graceDays, p_limit: opts.limit });
    const rows = (await res.json()) as Row[];
    return { items: rows.map((r) => ({ galleryId: String(r.gallery_id), reason: String(r.reason) as FaceCleanupCandidate['reason'] })), total: Number(rows[0]?.total ?? 0) };
  }

  async markFaceCleanupFailed(galleryId: string): Promise<void> {
    await this.write(`/rest/v1/films_faces?gallery_id=eq.${encodeURIComponent(galleryId)}`, 'PATCH', { cleanup_failed_at: new Date().toISOString() });
  }

  async albumOrderState(galleryId: string): Promise<AlbumOrderState> {
    const res = await this.write('/rest/v1/rpc/films_album_order_state', 'POST', { p_gallery_id: galleryId });
    const r = (await res.json()) as AlbumOrderState | null;
    return {
      crm: Boolean(r?.crm),
      extraPagePrice: r?.extraPagePrice == null ? null : Number(r.extraPagePrice),
      includedSpreads: r?.includedSpreads == null ? null : Number(r.includedSpreads),
      order: r?.order ? { ...r.order, spreads: r.order.spreads == null ? null : Number(r.order.spreads) } : null,
    };
  }

  async albumDesignBank(tokenHash: string): Promise<AlbumDesignBank> {
    const res = await this.write('/rest/v1/rpc/films_album_design_bank', 'POST', { p_token_hash: tokenHash });
    const r = (await res.json()) as { ok?: boolean; reason?: string; tenantId?: string; orderId?: string; readOnly?: boolean; galleries?: unknown } | null;
    if (!r?.ok || !r.tenantId || !r.orderId) {
      const reason = r?.reason === 'revoked' || r?.reason === 'unavailable' || r?.reason === 'closed' ? r.reason : 'not_found';
      return { ok: false, reason };
    }
    const galleries = Array.isArray(r.galleries) ? r.galleries.filter((g): g is string => typeof g === 'string') : [];
    return { ok: true, tenantId: String(r.tenantId), orderId: String(r.orderId), readOnly: Boolean(r.readOnly), galleries };
  }

  async albumOrderFromDesign(galleryId: string, spreads: number, tokenHash: string) {
    const res = await this.write('/rest/v1/rpc/films_album_order_from_design', 'POST', { p_gallery_id: galleryId, p_spread_count: spreads, p_token_hash: tokenHash });
    return (await res.json()) as { id: string; workflowStatus: string; created: boolean; joined?: boolean } | null;
  }

  async confirmAlbumSpreads(galleryId: string, spreads: number) {
    const res = await this.write('/rest/v1/rpc/films_album_order_confirm_spreads', 'POST', { p_gallery_id: galleryId, p_spreads: spreads });
    const r = (await res.json()) as { ok: boolean; id?: string; spreads?: number; before?: number | null } | null;
    return r?.ok ? { id: String(r.id), spreads: Number(r.spreads), before: r.before == null ? null : Number(r.before) } : null;
  }

  async expirePrintLinks(days: number): Promise<number> {
    const res = await this.write('/rest/v1/rpc/films_print_links_expire', 'POST', { p_days: days });
    return Number((await res.json()) ?? 0);
  }

  async closeLapsedStudios(graceDays: number) {
    const res = await this.write('/rest/v1/rpc/films_close_lapsed_studios', 'POST', { p_grace_days: graceDays });
    const r = ((await res.json()) ?? {}) as { studios?: number; galleries?: number; printLinks?: number };
    return { studios: Number(r.studios ?? 0), galleries: Number(r.galleries ?? 0), printLinks: Number(r.printLinks ?? 0) };
  }

  async eventInStudio(tenantId: string, eventId: string): Promise<boolean> {
    if (!UUID_RE.test(eventId)) return false;
    const rows = await this.rows(`/rest/v1/events?id=eq.${eventId}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=id`);
    return rows.length > 0;
  }

  async listLists(galleryId: string): Promise<PhotoList[]> {
    const rows = await this.rows(`/rest/v1/films_photo_lists?gallery_id=eq.${encodeURIComponent(galleryId)}&select=id,name,keys&order=created_at.asc`);
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), keys: (r.keys as string[]) ?? [] }));
  }

  async createList(galleryId: string, list: PhotoList): Promise<PhotoList | 'too_many' | null> {
    const res = await this.write('/rest/v1/rpc/films_photo_list_create', 'POST', { p_gallery_id: galleryId, p_id: list.id, p_name: list.name, p_keys: list.keys });
    const r = (await res.json()) as (PhotoList & { error?: string }) | null;
    if (!r) return null;
    if (r.error === 'too_many') return 'too_many';
    return { id: String(r.id), name: String(r.name), keys: (r.keys as string[]) ?? [] };
  }

  async toggleList(galleryId: string, listId: string, keys: string[], on: boolean): Promise<PhotoList | null> {
    const res = await this.write('/rest/v1/rpc/films_photo_list_toggle', 'POST', { p_gallery_id: galleryId, p_list_id: listId, p_keys: keys, p_on: on });
    const r = (await res.json()) as PhotoList | null;
    return r ? { id: String(r.id), name: String(r.name), keys: r.keys ?? [] } : null;
  }

  async renameList(galleryId: string, listId: string, name: string): Promise<PhotoList | null> {
    try {
      const res = await this.write(
        `/rest/v1/films_photo_lists?gallery_id=eq.${encodeURIComponent(galleryId)}&id=eq.${encodeURIComponent(listId)}&select=id,name,keys`,
        'PATCH',
        { name, updated_at: new Date().toISOString() },
        'return=representation',
      );
      const [r] = (await res.json()) as Row[];
      return r ? { id: String(r.id), name: String(r.name), keys: (r.keys as string[]) ?? [] } : null;
    } catch (e) {
      // films_photo_lists_gallery_name_key (0103): another list already has the name.
      if ((e as { status?: number }).status === 409) throw new HttpError(400, LIST_NAME_TAKEN);
      throw e;
    }
  }

  async deleteList(galleryId: string, listId: string): Promise<void> {
    await this.write(`/rest/v1/films_photo_lists?gallery_id=eq.${encodeURIComponent(galleryId)}&id=eq.${encodeURIComponent(listId)}`, 'DELETE');
  }

  async listInsta(galleryId: string): Promise<string[]> {
    const rows = await this.allRows(`/rest/v1/films_insta?gallery_id=eq.${encodeURIComponent(galleryId)}&select=photo_key&order=created_at.asc,photo_key.asc`);
    return rows.map((r) => String(r.photo_key));
  }

  async setInstaMany(tenantId: string, galleryId: string, keys: string[], on: boolean): Promise<void> {
    const unique = [...new Set(keys)];
    if (!unique.length) return;
    if (on) {
      const rows = unique.map((key) => ({ gallery_id: galleryId, tenant_id: tenantId, photo_key: key }));
      await this.write('/rest/v1/films_insta?on_conflict=gallery_id,photo_key', 'POST', rows, 'resolution=ignore-duplicates');
      return;
    }
    for (const part of groupsOf(unique, KEYS_PER_DELETE)) {
      await this.write(`/rest/v1/films_insta?gallery_id=eq.${encodeURIComponent(galleryId)}&photo_key=in.(${part.map(inValue).join(',')})`, 'DELETE');
    }
  }

  private musicPath(tenantId: string, id: string): string {
    return `/storage/v1/object/films-music/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}`;
  }

  async putMusic(tenantId: string, id: string, bytes: ArrayBuffer, type: string): Promise<void> {
    const res = await this.fetch(`${this.url.replace(/\/$/, '')}${this.musicPath(tenantId, id)}`, {
      method: 'POST',
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': type, 'x-upsert': 'true' },
      body: bytes,
    });
    if (!res.ok) throw new Error(`supabase storage upload: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  async getMusic(tenantId: string, id: string, range: string | null): Promise<Response | null> {
    const headers: Record<string, string> = { apikey: this.key, Authorization: `Bearer ${this.key}` };
    if (range) headers.Range = range;
    const res = await this.fetch(`${this.url.replace(/\/$/, '')}${this.musicPath(tenantId, id)}`, { headers });
    if (res.status === 400 || res.status === 404) return null;
    return res;
  }

  async deleteMusic(tenantId: string, id: string): Promise<void> {
    await this.fetch(`${this.url.replace(/\/$/, '')}/storage/v1/object/films-music`, {
      method: 'DELETE',
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [`${tenantId}/${id}`] }),
    });
  }

  async hit(key: string, max: number, windowSeconds: number, opts: { failClosed?: boolean } = {}): Promise<boolean> {
    try {
      const res = await this.write('/rest/v1/rpc/films_rate_hit', 'POST', { p_key: `films:${key}`, p_max: max, p_window_seconds: windowSeconds });
      const out = await res.json();
      if (typeof out !== 'boolean') throw new Error('films_rate_hit: not a yes/no');
      return out;
    } catch (e) {
      // The lead form fails closed (fix plan P10): the caller refuses with 503.
      if (opts.failClosed) throw e;
      // Fail open, like the Edge Functions: a hiccup here must not block a couple.
      console.error('[films] rate limit check failed, allowing:', (e as Error).message);
      return true;
    }
  }

  async failures(key: string, windowSeconds: number, add: boolean): Promise<number> {
    // No try/catch: an unknown count must refuse the attempt (the caller answers 503).
    const res = await this.write('/rest/v1/rpc/films_rate_count', 'POST', { p_key: `films:${key}`, p_window_seconds: windowSeconds, p_add: add });
    const n = Number(await res.json());
    if (!Number.isFinite(n)) throw new Error('films_rate_count: not a number');
    return n;
  }

  async notifyStudio(tenantId: string, n: { type: string; title: string; body: string }): Promise<void> {
    await this.write('/rest/v1/notifications', 'POST', { tenant_id: tenantId, type: n.type, title: n.title, body: n.body });
  }

  async emailStudio(tenantId: string, mail: StudioMail): Promise<'sent' | 'skipped' | 'failed'> {
    // The platform's mail lives in the Edge Functions (_shared/email.ts, P11-b): the Worker asks films-link-alert,
    // which sends only from the verified sender and only to the studio's active owners.
    try {
      const res = await this.fetch(`${this.url.replace(/\/$/, '')}/functions/v1/films-link-alert`, {
        method: 'POST',
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...mail }),
      });
      const r = (await res.json().catch(() => null)) as { result?: string } | null;
      if (!res.ok) {
        console.error(`[films] studio email: films-link-alert answered ${res.status}`);
        return 'failed';
      }
      return r?.result === 'sent' ? 'sent' : r?.result === 'failed' ? 'failed' : 'skipped';
    } catch (e) {
      console.error('[films] studio email failed:', (e as Error).message);
      return 'failed';
    }
  }

  async dropboxImpact(tenantId: string): Promise<DropboxImpact> {
    const res = await this.write('/rest/v1/rpc/films_dropbox_impact', 'POST', { p_tenant_id: tenantId });
    const r = (await res.json()) as Partial<DropboxImpact> | null;
    return { photoGalleries: Number(r?.photoGalleries ?? 0), films: Number(r?.films ?? 0), filmGalleries: Number(r?.filmGalleries ?? 0) };
  }

  async filmCheckCandidates(opts: { after?: string; start?: string; limit: number }): Promise<FilmCheckGallery[]> {
    const res = await this.write('/rest/v1/rpc/films_link_check_candidates', 'POST', { p_after: opts.after ?? '', p_limit: opts.limit, p_start: opts.start ?? null });
    const rows = ((await res.json()) as Row[] | null) ?? [];
    return rows.map((r) => ({ id: String(r.id), tenantId: String(r.tenantId), coupleName: String(r.coupleName ?? ''), films: Array.isArray(r.films) ? (r.films as Film[]) : [] }));
  }

  async recordTermsAccept(a: TermsAccept): Promise<void> {
    await this.write('/rest/v1/films_terms_accepts', 'POST', {
      tenant_id: a.tenantId,
      gallery_id: a.galleryId,
      terms_hash: a.termsHash,
      ip_hash: a.ipHash,
      user_agent: a.userAgent.slice(0, 200),
      role: a.role,
      link_id: a.linkId,
    });
  }

  async termsAccepts(galleryId: string): Promise<TermsSummary> {
    // Counted in the database (films_terms_summary, 0133): a gallery's guests may accept thousands of times.
    const res = await this.write('/rest/v1/rpc/films_terms_summary', 'POST', { p_gallery_id: galleryId });
    const r = (await res.json()) as Partial<TermsSummary> | null;
    return { count: Number(r?.count ?? 0), first: String(r?.first ?? ''), last: String(r?.last ?? ''), guests: Number(r?.guests ?? 0), unknown: Number(r?.unknown ?? 0) };
  }
}

/** Rows per page of a read (PostgREST's max-rows on Supabase). */
const ROWS_PER_PAGE = 1000;
/** The hub's row ids (events) are uuids; anything else is never sent in a filter. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How many rows the read matched, from `Content-Range: 0-999/2500` (Prefer: count=exact); else what came back. */
function countOf(res: Response, got: number): number {
  const m = /\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '');
  return m ? Number(m[1]) : got;
}

/** Gallery ids only in their own shape (16 hex): nothing else ever reaches an address. */
function galleryIds(ids: string[]): string[] {
  return [...new Set(ids.map(String))].filter((id) => /^[a-f0-9]{16}$/.test(id));
}

/** A value inside `in.(…)`: photo keys (8 hex) as they are, anything else quoted. */
const inValue = (v: string) => (/^[0-9a-f]{8}$/.test(v) ? v : `"${encodeURIComponent(v.replace(/"/g, ''))}"`);

function groupsOf<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The filter plus a guard (patchGallery's `only`): a value, or null = still empty. */
function guarded(where: string, only: GalleryGuard): string {
  let out = where;
  for (const [k, v] of Object.entries(only)) {
    const col = GALLERY_COLUMNS[k as keyof GalleryFields][0];
    out += v === null ? `&${col}=is.null` : `&${col}=eq.${encodeURIComponent(v)}`;
  }
  return out;
}

function toGallery(r: Row): Gallery {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    coupleName: String(r.couple_name ?? ''),
    studioName: (r.studio_name_override as string) || undefined,
    date: String(r.event_date ?? ''),
    venue: (r.venue as string) || undefined,
    ...(r.event_id ? { eventId: String(r.event_id) } : {}),
    days: Number(r.days ?? 0),
    createdAt: String(r.created_at),
    expiresAt: String(r.expires_at),
    hasCover: Boolean(r.has_cover),
    folderUrl: (r.folder_url as string) || undefined,
    folderProvider: (r.folder_provider as Gallery['folderProvider']) || undefined,
    films: (r.films as Film[]) ?? [],
    kind: r.kind === 'photos' ? 'photos' : 'films',
    photoCount: Number(r.photo_count ?? 0),
    linkedId: (r.linked_id as string) || undefined,
    music: (r.music as string) || undefined,
    guestId: (r.guest_id as string) || undefined,
    password: (r.password as string) || undefined,
    downloadPin: (r.download_pin as string) || undefined,
    printToken: (r.print_token as string) || undefined,
    ...(r.print_token && r.print_token_created_at ? { printTokenAt: new Date(String(r.print_token_created_at)).toISOString() } : {}),
    deletedAt: (r.deleted_at as string) || undefined,
    coverKey: (r.cover_key as string) || undefined,
    hasThumb: r.has_thumb === true,
    views: Number(r.views ?? 0),
    guestViews: Number(r.guest_views ?? 0),
    downloads: Number(r.downloads ?? 0),
    ...(r.cover_version != null ? { coverVersion: Number(r.cover_version) } : {}),
    // 0131; 0 = no photo list yet (read only: never written from here).
    ...(Number(r.photos_version) > 0 ? { photosVersion: Number(r.photos_version) } : {}),
    ...(Number(r.photos_visible_version) > 0 ? { photosVisibleVersion: Number(r.photos_visible_version) } : {}),
    // 0132 (P66): the list's generation, copied by the trigger; 0 = none (addresses say v0).
    ...(Number(r.photos_gen) > 0 ? { photosGen: Number(r.photos_gen) } : {}),
    // 0136 (P68): face search switched off because its data was deleted (read only).
    ...(r.faces_off_at ? { facesOffAt: String(r.faces_off_at) } : {}),
  };
}

/** Gallery field → the column the list reads (GALLERY_LIST_FIELDS). */
const LIST_COLUMN: Partial<Record<keyof Gallery, string>> = {
  id: 'id', tenantId: 'tenant_id', kind: 'kind', coupleName: 'couple_name', studioName: 'studio_name_override', date: 'event_date', venue: 'venue',
  days: 'days', createdAt: 'created_at', expiresAt: 'expires_at', hasCover: 'has_cover', films: 'films', photoCount: 'photo_count', linkedId: 'linked_id',
  deletedAt: 'deleted_at', coverKey: 'cover_key', hasThumb: 'has_thumb', views: 'views', guestViews: 'guest_views', downloads: 'downloads',
  coverVersion: 'cover_version', photosGen: 'photos_gen', eventId: 'event_id',
};
const LIST_COLUMNS = GALLERY_LIST_FIELDS.map((k) => LIST_COLUMN[k]).join(',');

/** Gallery field → column and how it is stored (an empty value is null). */
const GALLERY_COLUMNS: Record<keyof GalleryFields, [string, (v: never) => unknown]> = {
  coupleName: ['couple_name', (v: string) => v],
  studioName: ['studio_name_override', (v?: string) => v ?? null],
  date: ['event_date', (v?: string) => v ?? ''],
  venue: ['venue', (v?: string) => v ?? null],
  days: ['days', (v: number) => v],
  expiresAt: ['expires_at', (v: string) => v],
  hasCover: ['has_cover', (v?: boolean) => v === true],
  folderUrl: ['folder_url', (v?: string) => v ?? null],
  folderProvider: ['folder_provider', (v?: string) => v ?? null],
  films: ['films', (v?: Film[]) => v ?? []],
  photoCount: ['photo_count', (v?: number) => v ?? 0],
  linkedId: ['linked_id', (v?: string) => v ?? null],
  music: ['music', (v?: string) => v ?? null],
  guestId: ['guest_id', (v?: string) => v ?? null],
  password: ['password', (v?: string) => v ?? null],
  downloadPin: ['download_pin', (v?: string) => v ?? null],
  printToken: ['print_token', (v?: string) => v ?? null],
  printTokenAt: ['print_token_created_at', (v?: string) => v ?? null],
  deletedAt: ['deleted_at', (v?: string) => v ?? null],
  coverKey: ['cover_key', (v?: string) => v ?? null],
  hasThumb: ['has_thumb', (v?: boolean) => v === true],
  coverVersion: ['cover_version', (v?: number) => v ?? null],
  eventId: ['event_id', (v?: string) => v ?? null],
};

/** Written only when it has a value: a copy read before the column existed never clears it. */
const ONLY_WHEN_SET = new Set<keyof GalleryFields>(['coverVersion']);

/** Only the fields present in `fields` (a field set to undefined is cleared, never skipped). */
function galleryColumns(fields: GalleryFields): Row {
  const out: Row = {};
  for (const k of Object.keys(fields) as (keyof GalleryFields)[]) {
    const col = GALLERY_COLUMNS[k];
    if (ONLY_WHEN_SET.has(k) && fields[k] === undefined) continue;
    if (col) out[col[0]] = col[1](fields[k] as never);
  }
  return out;
}

function fromGallery(g: Gallery): Row {
  const fields: Record<string, unknown> = {};
  for (const k of Object.keys(GALLERY_COLUMNS)) fields[k] = g[k as keyof Gallery];
  return {
    id: g.id,
    tenant_id: g.tenantId,
    created_at: g.createdAt,
    kind: g.kind ?? 'films',
    ...galleryColumns(fields as GalleryFields),
    // views/downloads are left to films_count_event; never overwritten from a stale copy.
    updated_at: new Date().toISOString(),
  };
}

/** Films settings field → column (only the fields given; undefined clears). */
const STUDIO_COLUMNS: Record<keyof FilmsStudio, [string, (v: never) => unknown]> = {
  defaultDays: ['default_days', (v: number) => v],
  termsText: ['terms_text', (v: string | null) => v ?? null],
  contactLine: ['contact_line', (v?: string) => v ?? ''],
  vimeo: ['vimeo_url', (v?: string) => v ?? ''],
  youtube: ['youtube_url', (v?: string) => v ?? ''],
  headline: ['headline', (v?: string) => v ?? ''],
  about: ['about', (v?: string) => v ?? ''],
  pageEnabled: ['page_enabled', (v?: boolean) => v === true],
  mit4mitUrl: ['mit4mit_url', (v?: string) => v ?? null],
  showcase: ['showcase', (v?: StudioPage['showcase']) => v ?? { films: [] }],
  reviews: ['reviews', (v?: Review[]) => v ?? []],
  dropboxAccountName: ['dropbox_account_name', (v?: string) => v ?? null],
  labelSetsOn: ['label_sets_on', (v?: boolean) => v === true],
  labelMap: ['label_map', (v?: Record<string, string>) => v ?? null],
  music: ['music', (v?: MusicTrack[]) => v ?? []],
  musicDefault: ['music_default', (v?: string) => v ?? null],
  albumLayouts: ['album_layouts', (v?: AlbumTemplate[]) => v ?? []],
  designDefault: ['design_default', (v?: unknown) => v ?? null],
  mit4mitBizId: ['mit4mit_biz_id', (v?: string) => v ?? null],
  mit4mitRemoved: ['mit4mit_removed', (v?: string[]) => v ?? []],
  mit4mitLinkedAt: ['mit4mit_linked_at', (v?: string) => v ?? null],
  mit4mitApprovedAt: ['mit4mit_approved_at', (v?: string) => v ?? null],
};

function studioColumns(fields: Partial<FilmsStudio>): Row {
  const out: Row = {};
  for (const k of Object.keys(fields) as (keyof FilmsStudio)[]) {
    const col = STUDIO_COLUMNS[k];
    if (col) out[col[0]] = col[1](fields[k] as never);
  }
  return out;
}
