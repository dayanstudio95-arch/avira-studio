# Photo galleries — backend & data model spec (Studio Plan / studio-os)

Researched read-only on 2026-10-30. Scope: PHOTO galleries only. Films, faces, album designer, print shop,
studio page, mit4mit are described only where photo galleries depend on them.

Path abbreviations used for file:line references:

- `W/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/films-worker/worker/`
- `S/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/films-worker/shared/`
- `SRC/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/films-worker/src/` (the couple's SPA, same Worker)
- `T/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/films-worker/test/`
- `M/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/supabase/migrations/`
- `DBT/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/tools/db-test/tests/`
- `HUB/` = `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/hub/src/`
- `ORIG/` = `/Users/danieldayan/Downloads/מערכת צפיה וידאו/` (the standalone app it was copied from; reference only)

---

## 0. Architecture at a glance

```
 Studio (hub, app.studioplan.co.il)             Couple / guests (browser)          WhatsApp crawler
        │  fetch + Authorization: Bearer <Supabase JWT>     │ same-origin, cookies          │
        │  (CORS, origin must equal HUB_URL)                 ▼                               ▼
        └────────────────────────►  Cloudflare Worker "studio-os-films"  @ films.studioplan.co.il
                                     - serves the couple SPA (ASSETS = ./dist), HTML with OG tags
                                     - /api/admin/*  (studio admin API)
                                     - /api/watch/*, /api/photos/*, /api/cover/*, /api/music/*, /api/manifest/*
                                     - edge Cache API (previews 1y, covers 10min), KV (covers, Dropbox access token)
                                     - cron hourly clean-up (+ films-only link check)
                                           │ service-role REST/RPC                │ outbound fetch
                                           ▼                                      ▼
                                 Supabase (Postgres + Storage)         Dropbox API / Google Drive / pCloud
```

- ONE Worker serves everything: static SPA, couple JSON API, studio admin API, photo proxy, crons
  (`W/index.ts:1-5`, `W/index.ts:2088-2155`).
- All data in Supabase; the Worker uses the **service role** for every DB call and scopes by `tenant_id` in code
  (`W/store-supabase.ts:1-2`). RLS is not relied on by the Worker.
- Photos are never copied: every preview/original is fetched from the studio's cloud on demand and **proxied**
  through the Worker (no redirects, never exposing cloud URLs/tokens), with an edge-cache layer for previews.

---

## 1. Deployment, bindings, crons, secrets

### wrangler.jsonc (`apps/films-worker/wrangler.jsonc`)
| Item | Value | Line |
|---|---|---|
| name | `studio-os-films` (deliberately not `films`, the live Avira worker) | 5 |
| account_id | `c59e01f9f4e70a3205affcf2b6eec18f` (Studio Plan Cloudflare account) | 8 |
| main | `worker/index.ts` | 9 |
| route | `films.studioplan.co.il`, `custom_domain: true` | 10 |
| compatibility_date | `2026-09-01` | 11 |
| assets | dir `./dist`, binding `ASSETS`, `not_found_handling: single-page-application`, `run_worker_first: ["/*", "!/assets/*", "!/models/*", "!/demo/*", "!/favicon.svg"]` (everything except static files goes through the Worker, for OG tags) | 12-18 |
| crons | `"0 * * * *"` (hourly clean-up) and `"20 0-3,22-23 * * *"` (films link check; must equal `LINK_CHECK_CRON` in `W/cleanup.ts:227`) | 23 |
| KV | binding `KV`, id `a38f86f2117b4cb6acfe84eb9f2628a8` | 26-28 |
| vars | `CLOUD_MOCK: ""`, `CLEANUP_MAX_SUBREQUESTS: "45"` (free plan = 50 subrequests/run; paid up to ~900) | 30 |
| observability | logs on, `invocation_logs: false` (URLs contain `?pt=` tokens, so per-request logs are off) | 33 |

### Deploy (`apps/films-worker/scripts/deploy.mjs`)
Refuses unless name == `studio-os-films`, account id pinned, KV id not `LOCAL_PLACEHOLDER` and not the Avira KV id
(`63ffc893…`); runs `tsc --noEmit`, `vite build`, deletes `dist/demo`, `wrangler deploy`. Prints the secrets to set.
The full prod deploy is `tools/prod/deploy-cloudflare.mjs` (`--films-url https://films.studioplan.co.il`), which
creates KV once, refuses without `TENANT_SECRETS_KEY`, sets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HUB_URL`,
`FILMS_STATE_SECRET` (random 32 bytes hex, kept unless `--rotate`) and builds the hub with
`VITE_FILMS_BASE_URL=<films url>` + hub var `FILMS_URL` (CSP) (`tools/prod/deploy-cloudflare.mjs:112,122,126-166`).

### Env / secrets (`W/types.ts:4-36`)
| Name | Kind | Used for |
|---|---|---|
| `KV` | binding | covers (`cover:<galleryId>`), film frames (`thumb:<id>`, films only), Dropbox access-token cache (`dropbox:access_token:<tenantId>`), link-check marks (films only) |
| `ASSETS` | binding | the SPA (`dist`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | secret | every DB / Storage call; also verifying hub sessions via `/auth/v1/user` |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | secret | ONE platform-level Dropbox app; every studio connects its own Dropbox account through it |
| `GOOGLE_API_KEY` | secret | platform-level Drive API key (NOT per studio, despite comments; `W/settings.ts:64`) |
| `FILMS_STATE_SECRET` | secret | HMAC root: Dropbox OAuth `state`, gallery cookies, preview/thumbs tokens, album-order tokens, IP hashing for terms. Rotating it logs every couple out and kills every token |
| `TENANT_SECRETS_KEY` | secret | AES-GCM key (32 bytes, base64url) sealing each studio's Dropbox refresh token; SAME value as the Supabase Edge Functions' secret; never rotate |
| `HUB_URL` | secret | CORS allow-origin; Dropbox callback returns to `${HUB_URL}/films/settings`; album order links |
| `CLOUD_MOCK` | var | non-empty = fake clouds + in-memory store (tests/local only) |
| `CLEANUP_MAX_SUBREQUESTS` | var | clean-up / link-check request budget (20..1000, default 45) |
| `TURNSTILE_SITE_KEY/SECRET_KEY` | var/secret | studio page lead form only (not photos) |

`storeFor` (`W/store.ts:699-712`) uses Supabase when both Supabase secrets exist; memory store only with `CLOUD_MOCK`;
otherwise throws (fails loudly).

---

## 2. Data model

### 2.1 `films_galleries` (one row per gallery; films and photos share the table)
Created `M/0069_films_module.sql:30-50`, extended by many migrations. Photo-relevant columns:

| Column | Type / constraint | Origin | Notes |
|---|---|---|---|
| `id` | text PK, `check (id ~ '^[a-f0-9]{16}$')` | 0069:31 | the couple's link id (`randomId()` 8 random bytes hex, `W/auth.ts:26-30`) |
| `tenant_id` | uuid not null → tenants on delete cascade | 0069:32 | |
| `couple_name` | text not null | 0069:33 | stored as typed (whitespace collapsed); "X & Y" is only a hub suggestion (`S/names.ts`) |
| `studio_name_override` | text | 0069:34 | only stored when different from studio name (`W/galleries.ts:144-148`) |
| `event_date` | text not null default '' | 0069:35 | ISO yyyy-mm-dd or '' (old free text kept if sent back unchanged) (`W/galleries.ts:149-154`) |
| `venue` | text | 0069:36 | |
| `days` | int not null default 30 | 0069:37 | days from creation (recomputed on extend) |
| `expires_at` | timestamptz not null | 0069:38 | always 23:59:59 Israel time of the last day |
| `has_cover` | bool default false | 0069:39 | custom cover uploaded to KV |
| `folder_url` | text | 0069:40 | photo galleries: mirror of `films_photos.data.folderUrl` (canonical link) |
| `folder_provider` | text check in (`dropbox`,`dropbox-link`,`gdrive`,`myairbridge`,`pcloud`) | 0069:41, 0074:11-13 | photo galleries: `dropbox`/`dropbox-link`/`gdrive`/`pcloud` |
| `films` | jsonb default '[]' | 0069:42 | unused by photo galleries |
| `views`, `downloads` | int default 0 | 0069:43-44 | written only by `films_count_event` |
| `lead_id` | uuid → leads on delete set null | 0069:45 | |
| `event_id` | uuid → events on delete set null; trigger `films_galleries_event_same_tenant` (event must be same tenant) | 0069:46, 0139:114-131 | hub event link |
| `created_at`, `updated_at` | timestamptz | 0069:47-48 | |
| `kind` | text not null default 'films', check in ('films','photos') | 0075:22-26 | |
| `photo_count` | int default 0 | 0075:23 | visible (not hidden) photos; written by Worker / `films_photos_patch` |
| `linked_id` | text → films_galleries(id) on delete set null | 0075:24 | the same couple's film gallery ↔ photo gallery |
| `music` | text | 0076:27-28 | '' = studio default, 'none' = silent, else track id (`^[A-Za-z0-9_-]{6,20}$`) |
| `guest_id` | text check `^[a-f0-9]{16}$`, unique where not null | 0077:8,13,17 | guests' link id (look + download only) |
| `password` | text, ≤40 chars | 0077:9,15-16 | **plain text**; compare is trimmed + case-insensitive |
| `download_pin` | text, ≤40 chars | 0077:10,15-16 | **plain text**; new codes ≥ 6 chars (`W/access.ts:259`) |
| `print_token` | text check `^[A-Za-z0-9_-]{20,64}$`, unique | 0079:6-9 | print shop link (album) |
| `print_token_created_at` | timestamptz (+ trigger) | 0140:76-82 | |
| `deleted_at` | timestamptz, partial index | 0082:8-9 | in trash since |
| `cover_key` | text check `^[0-9a-f]{8}$` | 0084:35 | photo key of the cover photo (list thumbnail, OG image) |
| `has_thumb` | bool default false | 0084:36 | films only |
| `purge_failed_at` | timestamptz | 0105:25 | clean-up retry ordering |
| `guest_views` | int default 0 | 0106:15 | views through the guests' link |
| `cover_version` | bigint | 0106:16 | custom cover version (cache busting) |
| `photos_version` | int default 0 | 0131:23 | mirror of `films_photos.version` |
| `photos_visible_version` | bigint default 0 | 0131:24 | +1 whenever what the public may see can change (whole save, hide/show); part of every edge-cache key |
| `photos_gen` | bigint default 0 | 0132:12-13 | mirror of `films_photos.data.gen`; in every photo URL (`/v<gen>/`) |
| `faces_off_at` | timestamptz | 0136:34 | face search switched off because face data was deleted (faces feature) |

Indexes: `(tenant_id, created_at desc)` 0069:50; `deleted_at` partial 0082:9; `lead_id`, `event_id`, `linked_id`
(`M/0098_missing_indexes_and_token_uniqueness.sql:69-76`); unique `guest_id`, unique `print_token`.

Worker mapping row ⇄ object: `toGallery` (`W/store-supabase.ts:920-960`), `GALLERY_COLUMNS` (`:972-996`). Writable
fields (`W/store.ts:656-660`): never id/tenant/kind/created/counters/photo versions. Gallery list reads only
`GALLERY_LIST_FIELDS` (`W/store.ts:508-513`) — never password/pin/print token/guest id.

### 2.2 `films_photos` — the photo list (ONE jsonb document per gallery)
`M/0075_photo_galleries.sql:29-34`, `M/0103_photos_version_and_list_rpc.sql:13-28`:

| Column | Type | Notes |
|---|---|---|
| `gallery_id` | text PK → films_galleries on delete cascade | |
| `tenant_id` | uuid → tenants cascade | |
| `data` | jsonb not null | `PhotoData` below |
| `updated_at` | timestamptz | |
| `version` | int not null default 1 | +1 on every UPDATE by trigger `films_photos_bump_version` (0103:15-28) |

Trigger `films_photos_follow` (after insert/update; 0131:36-56, redefined 0132:16-36): unless the transaction set
`films.photos_patch = 'on'`, copies `version` → `films_galleries.photos_version`, does `photos_visible_version + 1`
and copies `data.gen` → `photos_gen` (clamped 0..2^53-1).

Decision D16(1): the single-JSON list stays (no row per photo). Max 20,000 photos (`W/photos.ts:29`).

#### `PhotoData` JSON schema (`W/types.ts:278-306`)
```ts
{
  folderUrl: string;                       // canonical cloud link
  provider: 'dropbox' | 'dropbox-link' | 'gdrive' | 'pcloud' | 'mock';
  pathRoot?: string;                       // Dropbox team root namespace id (Dropbox-API-Path-Root)
  timeOrder?: boolean;                     // false = folder/filename order; default time order
  timesV?: 2;                              // all capture times were read from files (trust for "largest copy")
  coverPos?: { x: number; y: number };     // 0..100 %, default 50/50
  gen?: number;                            // generation, in every photo URL; changes only when link/file changes
  sets: { id: string; name: string }[];    // max 40, name ≤40 chars
  items: PhotoItem[];                      // in display order
  cover?: string;                          // photo key
  faceSearch?: boolean;                    // faces feature switch
  design?: Partial<Design>;                // gallery look (S/design.ts; couple-page researcher)
}
PhotoItem = {
  key: string;      // 8 hex, FNV-1a of ref (unique within list)
  name: string;     // file name (shown to couple, used as download name)
  ref: string;      // 'p:<dropbox id or path>' | 'l:<path inside shared link>' | 'g:<drive file id>' | 'c:<pcloud fileid>' | 'm:<demo>'
  set?: string;     // set id
  ar?: number;      // width/height, measured by the hub from the preview (0.2..5, 3 decimals)
  hidden?: boolean;
  folder?: string;  // top subfolder name (photographer etc.)
  t?: number;       // capture time ms (EXIF, read as UTC)
  size?: number;    // bytes, when the cloud tells
  label?: string;   // Lightroom colour label ('red','yellow','green','blue','purple' or '')
  alt?: string;     // only on a fresh listing, never saved
  v?: string;       // file version hash (8 hex): Dropbox rev+content_hash, Drive modifiedTime+md5, pCloud hash+size
}
```

### 2.3 Couple choices
| Table | Definition | Key / constraints |
|---|---|---|
| `films_hearts` | `M/0075_photo_galleries.sql:37-45` | PK `(gallery_id, photo_key, who)`; `photo_key ~ '^[0-9a-f]{8}$'`; `who` text default '' ≤30 chars; `created_at`; index `(gallery_id, created_at)`; cascade on gallery delete |
| `films_insta` | `M/0076_photo_extras.sql:7-21` | PK `(gallery_id, photo_key)`; photo_key 8 hex; `created_at` |
| `films_photo_lists` | `M/0084_photo_lists_design_thumbs.sql:10-27` + unique name `M/0103:55` | `id ~ '^[0-9a-f]{12}$'` PK; `gallery_id` cascade; `name` 1..40 chars, unique per gallery; `keys` jsonb array; max 20 lists/gallery (`W/store.ts:636`, enforced in RPC) |

Hearts/marks of photos no longer in the list are KEPT (D16(3)), only filtered out on read (`W/photos.ts:815-826`).

### 2.4 Other tables photo galleries use
- `films_studio_settings` (PK tenant_id; `M/0069:12-28`): photo-relevant columns `default_days` (1..3650, default 30),
  `terms_text` (null = built-in default, `W/settings.ts:7-13`), `contact_line`, `label_sets_on`, `label_map` (0075:64-66),
  `music` jsonb `[{id,name,type,size}]` max 3, `music_default` (0076:24-26), `design_default` jsonb (0084:30-31),
  `dropbox_account_name`, `access_version` int ≥0 (0134:23-24).
- `films_terms_accepts` (`M/0074:17-35`, +role/link_id `M/0104:39-47`): id bigserial, tenant_id, gallery_id (cascade),
  accepted_at, terms_hash (12-byte SHA-256 hex of terms text), ip_hash (SHA-256 of `FILMS_STATE_SECRET:ip`, 12 bytes),
  user_agent ≤200, role couple|guest|null, link_id (16 hex).
- `tenant_secrets` (`M/0019_tenant_secrets.sql:37-69`): `(tenant_id, key)` unique, `value` text, `is_set` generated
  (`M/0152:27-28`). Key `dropbox_refresh_token` = sealed `ts1.<iv>.<ct>` (§4.4).
- `rate_limit_hits` (`M/0023_rate_limiting.sql:12-20`): id bigserial, bucket_key, created_at; indexes `(bucket_key, created_at)`
  and `(created_at)` (0154:77). Worker keys are prefixed `films:`.
- `films_cleanup_runs` (`M/0105:134-147`): one row per hourly run, kept 90 days.
- `notifications` (hub bell): Worker inserts `films_gallery_locked` (§9.3).
- `tenants` / `profiles` / `tenant_slug_history`: read for studio identity, slug, access state, modules.
- Storage bucket `films-music` (private, 10MB, audio types; `M/0076:31-34`), path `<tenant>/<trackId>`.
- (Faces: `films_faces`, `films_faces_done`, `films_face_searches`, bucket `films-faces` — faces researcher.)
- (Albums: `films_albums`, `album_orders` — album researcher; photo galleries depend via guards, §11.)

### 2.5 RLS / grants
- `films_galleries`, `films_photos`, `films_hearts`: since `M/0100_in_studio_role_policies.sql:176-179` **no privileges at all
  for anon/authenticated**, read policies dropped (they held plain-text passwords). Service role only. Verified by
  `DBT/photo-galleries.test.mjs` ("signed-in users cannot read photo lists or hearts directly").
- `films_insta`, `films_photo_lists`, `films_terms_accepts`, `films_studio_settings`: `select` to authenticated with
  `tenant_id = current_tenant_id()`; writes service role only. All have `apply_tenant_write_gate(...)` restrictive
  insert/update/delete policies + read gate (`M/0159_billing_gate.sql:219-235`).
- `tenant_secrets`: owner/admin/studio_manager policy (0019:51-60); hub reads only `is_set` (P16).
- Every `films_*` function: `revoke all from public, anon, authenticated; grant execute to service_role`.

### 2.6 RPCs (all `security definer`, service role only) used by photo galleries
| Function | Migration | What |
|---|---|---|
| `films_tenant_info(uuid) → jsonb` | 0130:20-44, 0134:42+ | branding + `access` (`tenant_access_state`) + `films`/`photos` (`tenant_has_module`) + `access_version`, one call |
| `films_photo_item(gallery, tenant, key, copies) → jsonb` | 0131:61-109 | ONE photo from the jsonb list: `{item, folder{folderUrl,provider,pathRoot,timesV}, copies[≤50 same name or same t + same shape], version, visibleVersion}` |
| `films_photos_patch(gallery, tenant, expected, items, order, fields) → jsonb` | 0131:117-220 | optimistic patch: replace whole items by key, optional full new order, edit fields only (`sets,cover,timeOrder,coverPos,faceSearch,design,timesV`); `{conflict:true}` on version mismatch; recomputes `photo_count`, `cover_key`, bumps `photos_visible_version` only if hidden/ref changed; marks txn `films.photos_patch=on` so the follow trigger skips |
| `films_photo_cover(jsonb) → text` | 0130:47-67 | chosen cover if shown, else first non-hidden; "hidden" = any JSON value except false/null/0/"" |
| `films_count_event(id, type)` | 0069:53-65, 0106:18-31 | atomic `views`/`guest_views`/`downloads` +1 |
| `films_rate_hit(key,max,window) → bool` | 0074:39-63, now wraps `rate_hit` 0154:22-74 | advisory lock per key, count in window, insert |
| `films_rate_count(key, window, add) → int` | 0104:11-36 | wrong-password counter (keys must start `films:`) |
| `films_photo_list_create / _toggle` | 0103:59-123 | list by name (merge into existing), ≤20 lists (`{"error":"too_many"}`), ordered add/remove of keys |
| `films_galleries_extend(tenant, items[{id,seen}], days)` | 0133:20-64 | extend ≤50 galleries only while `expires_at = seen`; from max(now, expires_at) + days, capped at created+3650 days, to 23:59:59 Asia/Jerusalem; days recomputed |
| `films_dashboard(tenant, films, photos)` | 0133:67-110 | open/closed/trash counts, closing ≤7 days (12), most viewed (5), albums sent (10) |
| `films_terms_summary(gallery)` | 0133:113-129 | couple count/first/last, guests, unknown |
| `films_bump_access_version(tenant) → int` | 0134:26-39 | "disconnect every access" |
| `films_trash_candidates(before, limit)` | 0105:99-115 (+`blocked` col in 0135) | trash >30 days, round-robin per tenant, failed last |
| `films_album_guards(tenant, ids)` | 0135 | album status + order status per gallery (trash/purge guard) |
| `films_sweep_rate_hits()` | 0082:11-27, 0154:79-95 | delete rate rows >2 days |
| `films_cleanup_record(jsonb)` | 0105:149-168 | log run, keep 90 days |
| `films_dropbox_impact(tenant)` | 0153:17-43 | open photo galleries read via Dropbox (`data->>'provider' in ('dropbox','dropbox-link')`) + films |
| `films_print_links_expire(days)`, `films_close_lapsed_studios(grace)` | 0140:244-279 | cron step 0: canceled studios >30 days → their open galleries close (`expires_at=now()`), print tokens cleared |
| `films_faces_forget`, `films_faces_cleanup_candidates`, … | 0105, 0136 | faces (dependency only) |

pg_cron: only `rate-limit-sweep-daily` `'50 2 * * *'` → `films_sweep_rate_hits()` (`M/0154_rate_hit.sql:97`).
Everything else periodic runs in the Worker cron (§13).

### 2.7 KV keys (Cloudflare)
| Key | Value | Written by |
|---|---|---|
| `cover:<galleryId>` | image bytes, metadata `{type, v}` | `W/covers.ts:21-28` (≤2MB JPEG/PNG/WebP) |
| `dropbox:access_token:<tenantId>` | `{token, expiresAt, refreshHash}`, TTL = token TTL | `W/providers/dropbox.ts:182` |
| `thumb:<galleryId>`, `filmcheck:*` | films only | |

### 2.8 Unit / DB test spec index
- `T/photos.test.ts` (listing, sets, keys, merge, edits, hearts, EXIF, Drive no-key, largest copy, P64/P70 rules)
- `T/photo-cache.test.ts` (edge cache, hidden never cached, access before cache, patch size, MAX_PHOTOS, gen, 415/502, waitUntil, covers)
- `T/dropbox-oauth.test.ts`, `T/dropbox-resolve.test.ts`, `T/dropbox-impact.test.ts`, `T/pcloud.test.ts`, `T/gdrive.test.ts`, `T/providers.test.ts`
- `T/access.test.ts` (guests link, password/pin, cookies, guessing, tokens, access version, rotate guest)
- `T/expiry.test.ts`, `T/cleanup.test.ts`, `T/lost-updates.test.ts`, `T/store-supabase-paging.test.ts`, `T/supabase-calls.test.ts`, `T/store-contract.test.ts`, `T/zip.test.ts`, `T/zip-names.test.ts`, `T/fav-state.test.ts`
- `DBT/photo-galleries.test.mjs`, `gallery-access.test.mjs`, `gallery-trash.test.mjs`, `photo-item-patch.test.mjs`, `photo-gen.test.mjs`, `photo-extras.test.mjs`, `photo-lists-design.test.mjs`, `films-tenant-info.test.mjs`, `films-batch-extend.test.mjs`, `films-cleanup.test.mjs`, `rate-hit.test.mjs`

---

## 3. Auth & identity

### 3.1 Hub → Worker (studio admin)
- Hub calls `${VITE_FILMS_BASE_URL}/api/admin/...` with `Authorization: Bearer <supabase access_token>`
  (`HUB/lib/filmsApi.js:47-60`).
- `requireStudioAdmin` (`W/supabaseAuth.ts:39-53`):
  1. `GET ${SUPABASE_URL}/auth/v1/user` with apikey=service key + the user's token (`W/store-supabase.ts:69-79`) — one network call per admin request (no local JWT verification);
  2. `profiles?id=eq.<uid>` → tenant_id, role, is_active (inactive → 401);
  3. role must be in `owner, admin, studio_manager` (album designer routes add `album_manager`) else 403 `רק מנהלי הסטודיו יכולים לנהל גלריות`;
  4. `films_tenant_info`: `blocked` → 403 `החשבון של הסטודיו מושהה`; neither module → 402;
  5. `module: 'photos'` → `requireKind` 402 `גלריות התמונות אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב".`;
  6. `write` + access ≠ 'ok' → 402 `המנוי של הסטודיו אינו פעיל. אפשר לצפות, אבל לא לשנות.` unless `allowReadOnly` (only exposure-lowering actions: close, trash, purge, new non-empty password/pin, earlier close date, face search off, revoke print link) → then `READ_ONLY_REDUCE_WORDS` for anything else.
- Secrets visibility: only `owner`/`admin` see/change `password` & `downloadPin` (`W/index.ts:85-111`); others get `hasPassword/hasDownloadPin`; input fields stripped.

### 3.2 Couple / guests (public)
- Link: `/<studio slug>/<16hex>` (or `/watch/<16hex>`). The slug is not a secret; a wrong slug still opens and the page fixes its URL (`W/index.ts:1074-1088`).
- `viewerGallery` (`W/access.ts:24-31`): id must be 16 hex; `getGallery(id)` → role `couple`; else `getGalleryByGuestId(id)` → role `guest`; trashed → not found.
- `publicGallery` (`W/index.ts:1080-1088`): tenant must exist, not `blocked`, and have the module of the gallery's kind, else 404 `הקישור לא נמצא`. (A `read_only` studio's galleries stay public.)
- `coupleGallery` (`:1091-1095`): guest link → 403 `הקישור לאורחים מיועד לצפייה ולהורדה בלבד` (hearts, Instagram, lists, album).
- Guest id: created lazily the first time the studio opens the gallery in the hub while access is 'ok' (`W/index.ts:397`, `W/access.ts:41-49`, guarded write `guestId is null`); rotate → old guest link 404 (`W/index.ts:409-414`, `W/access.ts:56-59`).

### 3.3 Access decision (`W/access.ts:206-218`)
```
studio   = valid preview token in ?pt= (or thumbs token where allowed) OR cookie gstudio_<galleryId>
view     = studio || !password || holds password cookie (for this role; a couple cookie also opens the guest link)
download = studio || !downloadPin || (view && holds pin cookie)
```
- Cookie names: `gp_<22 chars of HMAC(cookieKey, "name|pass|<gid>|<role>")>` / `gd_…` for pin; value
  `v1.<accessVersion>.<HMAC(cookieKey, "v1|kind|gid|role|version|<current secret lowercased>")>` — changing the password
  or bumping the access version invalidates cookies (`:101-117`). `cookieKey = HMAC(FILMS_STATE_SECRET, 'studio-plan/films/cookie-key/v1')`.
- Cookie attrs: `Path=/; HttpOnly; SameSite=Lax; Max-Age=` 180 days (password) / 30 days (pin); `Secure` on https (`:227-238`).
- Preview token (studio "open as couple"): `sign(previewKey, "pv2:<gid>:<tenant>:<userId>:<endsMs>:<version>")`, 12h
  (`:127-143`); the `?pt=` on `/api/watch/:id` sets cookie `gstudio_<gid>` = the same token, Max-Age = remaining time (`:245-249`).
- Thumbs token (hub list pictures, album bank): `th1:<gid>:<tenant>:<endsMs>:<version>`, 12h; opens only `?s=m` photo
  (not download), cover, film frame; never the gallery (`:146-148`, `W/index.ts:1228`).
- Token format `base64url(payload).base64url(HMAC-SHA256)` (`W/auth.ts:51-69`); `previewKey = HMAC(secret, 'studio-plan/films/preview-key/v1')`.
- "Disconnect every access" (`POST /api/admin/access/revoke`, owner/admin only; `W/index.ts:206-210`) bumps
  `films_studio_settings.access_version` → every cookie and token made before stops at once.

### 3.4 Dropbox OAuth (per studio, platform app)
1. Hub `GET /api/admin/dropbox/connect` (write) → JSON `{url}` (`W/index.ts:212-218`):
   `https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&response_type=code&token_access_type=offline&scope=account_info.read files.metadata.read files.content.read sharing.read&redirect_uri=<films origin>/api/admin/dropbox/callback&state=<sign(FILMS_STATE_SECRET, "dbx:<tenant>:<user>:<ms>")>`
   (`W/providers/dropbox.ts:19,58-67`). No `sharing.write` (P65). Missing app keys → 400 `חיבור דרופבוקס עדיין לא הוגדר במערכת. פנו לתמיכה.`
2. Dropbox redirects to `GET /api/admin/dropbox/callback?code&state` (no session): verifies the state signature only, then
   302 → `${HUB_URL}/films/settings?dropbox_code=…&dropbox_state=…` (or `?dropbox=error`) (`W/index.ts:225-236`). The
   connection is NOT finished here (anti login-CSRF).
3. Hub `POST /api/admin/dropbox/finish {code,state}` (`W/index.ts:238-264`): state valid, ≤15 min, same tenant AND same
   user (else 400 `חיבור הדרופבוקס פג תוקף. נסו שוב.` / 403 `החיבור הזה התחיל ממשתמש אחר…`); `exchangeCode` →
   `POST https://api.dropboxapi.com/oauth2/token` (grant authorization_code, same redirect_uri) → refresh token; if a
   different previous token existed → `revokeConnection` (`POST /2/auth/token/revoke`, one try); seal + upsert
   `tenant_secrets(tenant,'dropbox_refresh_token')`; forget cached access token; `users/get_current_account` → save
   `dropbox_account_name`.
4. `GET /api/admin/dropbox/impact` → `{photoGalleries, films, filmGalleries, studioFilms}` for the warning dialog.
5. `POST /api/admin/dropbox/disconnect` → revoke at Dropbox (one try), delete secret, clear account name, forget token.

### 3.5 Token storage & encryption (`W/secretBox.ts`)
AES-GCM 256, key = `TENANT_SECRETS_KEY` (32 bytes base64url), 12-byte random IV, AAD `tenant_secrets:<tenantId>:<key>`,
stored `ts1.<b64url iv>.<b64url ciphertext>` (`:55-64`). Unsealed legacy values read as-is; a `ts1.` value that fails
to open = "not connected" (logged) (`:83-90`). Same format as `supabase/functions/_shared/tenantSecrets.ts`.

### 3.6 Dropbox access token cache (`W/providers/dropbox.ts:84-202`)
- Key `dropbox:access_token:<tenantId>`; value carries `refreshHash` (first 12 bytes SHA-256 of the refresh token) so a token from
  before a reconnect is ignored.
- Lookup order: isolate memory → KV → refresh. Usable only if `expiresAt > now + 60s`.
- In-flight de-dupe per (tenant, refreshHash): concurrent requests wait ≤5s for the same refresh (`SHARED_WAIT_MS`).
- Refresh: `POST oauth2/token grant_type=refresh_token` (+ client id/secret); temporary errors (network, 429, 5xx, no token)
  retried once after Retry-After (≤3s); TTL = clamp(expires_in, 600..14400 s); KV write failures ignored.
- On a 401 from a content call: drop the token only if it is still the cached one, refresh, retry once
  (`W/photos.ts:1135-1141`); `missing_scope` → no retry (studio must reconnect).
- Errors → Hebrew (`dropboxError`, `:46-56`): app lacks scope → `לאפליקציית הדרופבוקס של המערכת חסרה ההרשאה <x>. פנו לתמיכה.`;
  connection lacks scope → `לחיבור הדרופבוקס חסרה הרשאה (<x>). נתקו וחברו מחדש את דרופבוקס בהגדרות.`; 401 → `חיבור הדרופבוקס פג. חבר מחדש בהגדרות.`;
  429/5xx → 503 `דרופבוקס לא זמין כרגע, נסו שוב בעוד רגע`; else `שגיאה מדרופבוקס (<endpoint>): <first 200 chars>`.
  Not connected → `דרופבוקס לא מחובר. חבר את החשבון בהגדרות או הדבק קישור לכל סרט בנפרד.`; bad platform app → `אפליקציית הדרופבוקס של המערכת לא מוגדרת נכון. פנו לתמיכה.`

---

## 4. Admin API (photo-relevant)

All under `/api/admin/*`, CORS for `HUB_URL`, Bearer auth (§3.1). Body JSON unless noted. Errors: `{error, code?, ...extra}`.

| Method & path | Line | Auth opts | Behaviour |
|---|---|---|---|
| GET `/api/admin/settings` | 150-154 | admin | `adminView` (`W/settings.ts:69-96`): studio name/logo, defaultDays, terms (+isDefault), contactLine, instagram, phone, dropbox {appConfigured, connected, accountName}, google {hasKey}, labelSetsOn, labelMap (merged with `DEFAULT_LABEL_MAP` `S/exif.ts:107`), music, musicDefault, designDefault, slug, redirectUri |
| PUT `/api/admin/settings` | 156-197 | write | defaultDays 1..3650; terms ('' = default); contactLine ≤200; vimeo/youtube; musicDefault; designDefault; labelSetsOn; labelMap (colours yellow/red/blue/purple/green → set name ≤40); headline/about; slug. Writes only changed columns (`studioChanges`) |
| POST `/api/admin/access/revoke` | 206-210 | owner/admin | bump access version |
| Dropbox connect/callback/finish/impact/disconnect | 212-289 | §3.4 | |
| GET `/api/admin/galleries[?limit&offset]` | 311-322 | admin | list (newest first), `listRow` + `thumb` (photo: `/api/photos/<id>/v<gen>/<coverKey>?s=m&pt=<thumbs token>`; trashed: '') via `withThumbs` 341-357; paged `{items,total}` (limit 1..1000) or all (paged internally 1000/page) |
| GET `/api/admin/galleries/options` | 328-331 | admin | id, kind, coupleName, date, deletedAt (link picker) |
| POST `/api/admin/galleries` | 359-365 | write + module | create (`buildGallery` `W/galleries.ts:214-232`): kind photos, coupleName required, date ISO or '', venue, days (default studio default) → `expires_at = closeAfterDays(created, days)`; optional password, downloadPin (≥6), music, eventId (checked same tenant), studioName. Plain insert |
| POST `/api/admin/galleries/bulk` | 368-390 | write | ≤100 `{coupleName,date,venue}` lines; all or none (one insert); errors `בשורה N: …` |
| GET `/api/admin/galleries/:id` | 392-403 | admin + kind | gallery (secrets per role) + `daysLeft`, `expired`, `terms` summary, `previewToken` (12h); ensures guestId |
| POST `/api/admin/galleries/:id/rotate-guest` | 409-414 | write, photos | new guest id; 409 if changed meanwhile |
| PUT `/api/admin/galleries/:id` | 416-429 | write (+readOnly lowering) | update only changed fields (`galleryChanges`); music must exist |
| DELETE `/api/admin/galleries/:id[?forever=1][&force=1]` | 431-448 | write+readOnly | trash (or purge if already trashed) with album guard 409; face data deleted first; cover edge copy forgotten |
| GET `/api/admin/dashboard[?kind=photos]` | 451-456 | admin | `films_dashboard` |
| POST `/api/admin/galleries/:id/restore` | 458-464 | write | clear deleted_at; `faceSearchOff:true` if faces were deleted |
| POST `/api/admin/galleries/batch` | 493-577 | write+readOnly | `{ids≤50, action: extend|close|trash|restore|purge, days?, seen?{id:expiresAt}, force?}`; fixed number of DB calls; faces deleted for ≤6 galleries per call (`remaining` returned); answer `{done, doneIds, skipped[{id,reason}], remaining, faceSearchOff?}` |
| POST `/api/admin/galleries/:id/extend` | 579-590 | write | `{days?, expiresAt(seen)}`; trash → 400 `הגלריה בסל המחזור. שחזרו אותה קודם.`; changed → 409 `תאריך הסגירה של הגלריה השתנה בינתיים. רעננו את הדף ונסו שוב.` |
| POST `/api/admin/galleries/:id/cover` | 592-605 | write, 200 uploads/h/studio | raw body image/jpeg|png|webp ≤2MB → KV; `cover_version = max(now, old+1)` |
| POST `/api/admin/galleries/:id/photos/load` | 664-691 | write, photos | `{url, confirm?}` read folder + merge (§5, §6) |
| GET `/api/admin/galleries/:id/photos` | 693-696 | photos | full `PhotoData` (with refs) + `favorites`, `favBy` (incl. hidden photos), `insta`, `previewToken` |
| POST `/api/admin/galleries/:id/photos/dates` | 706-766 | photos (read) | `{keys}` → `{dates{key:ms|null}, labels{key:color}, failed[], skipped[], batch}` (§6.2) |
| PUT `/api/admin/galleries/:id/photos` | 768-794 | write+readOnly(faceSearch:false only) | studio edits (§6.1) |
| PUT `/api/admin/galleries/:id/link` | 904-924 | write | link films↔photos gallery (guarded both sides) |
| POST/DELETE `/api/admin/music[/:id]` | 1813-1846 | write, photos, 200 uploads/h | ≤3 songs, audio mpeg/mp4/m4a/aac/ogg/wav, ≤10MB, name from `X-File-Name` header; Storage `films-music/<tenant>/<id>` |
| album-designer / print-link / faces admin routes | 806-870, 1495-1561, 1697-1733 | | dependencies (§11) |

---

## 5. Creating a gallery from a cloud link (folder load)

Entry: `POST /api/admin/galleries/:id/photos/load {url, confirm?}` (`W/index.ts:664-691`) → `listPhotos(env, settings, url, origin)`
(`W/photos.ts:538-546`) → merge with saved list inside an optimistic edit loop → save whole → update gallery columns
(`photo_count`, `cover_key`, `folder_url`, `folder_provider`; `W/index.ts:628-640`).

### 5.1 Link parsing (`S/providers.ts`, `S/dropbox.ts`)
`detectLink` (`S/providers.ts:114-118`) tries Dropbox, Drive, MyAirBridge, pCloud:
- **Dropbox** (`S/dropbox.ts:29-61`): hosts `www.dropbox.com`, `dropbox.com`, `dl.dropboxusercontent.com`. `/scl/fi/…` file,
  `/scl/fo/…` folder, `/s/…` file, `/sh/…` folder. Canonical = host `www.dropbox.com`, drop `dl`, `raw`, `st`, hash (keeps `rlkey`).
- **Drive** (`S/providers.ts:53-76`): `drive.google.com`, `drive.usercontent.google.com`, `docs.google.com`; `/file/d/<id>` (file),
  `/folders/<id>` (folder, incl `/drive/u/0/folders`), `uc?id=` / `download?id=` (file), `open?id=` (unknown). id `^[A-Za-z0-9_-]{10,}$`.
  Canonical folder `https://drive.google.com/drive/folders/<id>`.
- **pCloud** (`S/providers.ts:98-107`): host `*.pcloud.link|com`, `code` param `^[A-Za-z0-9]{8,80}$`; canonical
  `https://(e|u).pcloud.link/publink/show?code=…`; API hosts `eapi.pcloud.com` for EU links else `api.pcloud.com`, other region as fallback.
- **MyAirBridge**: recognised but refused for photos.

`listPhotos` refusals (Hebrew, all 400):
- unknown link: `הקישור לא מזוהה. אפשר להדביק תיקייה מדרופבוקס, מגוגל דרייב או מ-pCloud.`
- MyAirBridge: `גלריות תמונות עובדות עם דרופבוקס, גוגל דרייב ו-pCloud. MyAirBridge נתמך רק לסרטים.`
- file link: `זה קישור לקובץ בודד. צריך קישור לתיקייה עם התמונות.`

### 5.2 Dropbox (`W/photos.ts:312-400`, `W/providers/dropbox.ts:309-338`)
1. Not a folder link → `זה לא קישור לתיקיית דרופבוקס`. Get access token (studio must be connected).
2. `locateOwnFolder`: `users/get_current_account` → if team account (`root_namespace_id ≠ home_namespace_id`) try two sessions
   (home, then `Dropbox-API-Path-Root: {".tag":"root","root":<teamNs>}`); per session `sharing/get_shared_link_metadata {url}`
   (file → 400 `הקישור הזה הוא לקובץ, לא לתיקייה`), then `files/list_folder` on `path_lower`, then on `id` (409 not_found → try next).
3. **Folder is in the connected account** → provider `dropbox`, refs `p:<id:…>` (or `p:/path_lower` if no id), `alt` = old path ref:
   - found by path → ONE recursive `files/list_folder {path, recursive:true, limit:2000}` + `list_folder/continue` pages; subfolder name =
     path part right under the root (`listOwnByPath` :357-366) — no depth limit here;
   - found only by id → walk folder by folder by id, depth ≤3, ≤40 subfolders (`walkOwnById` :369-384).
   `pathRoot` stored for team accounts.
4. **Someone else's folder** → provider `dropbox-link`, refs `l:/<relative path>`, walk with
   `files/list_folder {path:'', shared_link:{url}, limit:2000}` per folder (+continue), depth ≤3 (`MAX_DEPTH` :403), ≤40 subfolders;
   each photo's `folder` = its TOP subfolder name. Password/private link → 400
   `הקישור מוגן בסיסמה או לא ציבורי. צריך קישור פתוח ("כל מי שיש לו את הקישור").`
5. Each file: `size`, `v = fileVersion(rev, content_hash)`.
Even for someone else's link the STUDIO'S Dropbox connection is required (API calls are authenticated with it).

### 5.3 Google Drive (`W/photos.ts:405-494`)
- With `GOOGLE_API_KEY` (platform secret): `GET https://www.googleapis.com/drive/v3/files?q='<id>' in parents and trashed = false&fields=nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&key=…`
  with header `Referer: <films origin>/`, paginated; subfolders (mime `application/vnd.google-apps.folder`) depth ≤3, ≤40.
  A file counts only if Google's mimeType matches `SAFE_IMAGE_TYPE` (`^image/(jpeg|png|webp|gif|avif|heic|heif|tiff)$`) — then the
  name must ALSO match `IMAGE_EXT`. `v = fileVersion(modifiedTime, md5Checksum)`. Errors → 400
  `גוגל דרייב לא החזיר את רשימת הקבצים (<status>). בדוק שהתיקייה משותפת ל"כל מי שיש לו את הקישור".`
- Without a key: scrapes `https://drive.google.com/embeddedfolderview?id=<id>` (UA Mozilla, Accept-Language en), parsing
  `class="flip-entry" id="entry-<id>"` blocks and `flip-entry-title` (`parseEmbeddedFolder` :409-424); same depth/40 limits; no size,
  no version. Empty → `לא ראיתי קבצים בתיקייה. בדוק שהיא משותפת ל"כל מי שיש לו את הקישור" (Viewer).` Non-200 →
  `גוגל דרייב לא החזיר את התיקייה (<status>). …`
- Refs `g:<fileId>`.

### 5.4 pCloud (`W/providers/pcloud.ts`, `W/photos.ts:520-536`)
- One call `GET https://<host>/showpublink?code=<code>` returns the whole recursive tree; tries the link's region host then the other
  on error 7001; remembers the working host per code in isolate memory (`:34-54`).
- Single file link → `זה קישור לקובץ בודד. צריך קישור לתיקייה ב-pCloud.` Walk depth <4; folder = first-level subfolder name; refs `c:<fileid>`; `v = fileVersion(hash, size)`. No 40-subfolder cap.
- Errors (`:24-31`): 7001 `הקישור של pCloud לא תקין. בדוק שהעתקת את כולו.`, 7002 `…נמחק.`, 7003 `…מוגן בסיסמה. צריך קישור בלי סיסמה.`, 7004 `…פג תוקף.`, 7005 traffic limit, 7006 download limit; else `pCloud החזיר שגיאה: <x>`.

### 5.5 Building the list (`buildPhotoData`, `W/photos.ts:107-122`)
- Filter by name `IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i` (`:18`). None → `לא נמצאו תמונות בתיקייה (JPG / PNG / HEIC).`
- > 20,000 → `בתיקייה יש N תמונות, וגלריה אחת יכולה להכיל עד 20,000. חלקו את התמונות לשתי תיקיות ופתחו גלריה לכל אחת.`
- Sort `sortByName` (`:79-85`): folders ordered by `Intl.Collator('he',{numeric:true})`, then file names lowercased with digit runs
  zero-padded to 12 (IMG_2 < IMG_10).
- Sets: always the 8 preset sets `s1..s8` = `טיזר, התארגנות, צילומי חוץ, משפחות, אולם, טקס חופה, מסיבה, בחירת אלבום` (`S/photosets.ts:3`).
  A subfolder whose name (minus leading number/separators, normalised) equals or contains a preset fills that set (`presetForFolder` `S/photosets.ts:8-11`);
  other subfolders (per photographer, "טופ1") stay `folder` only. `isTopFolder` recognises `טופ1/top 2/2top…` (used by the UI).
- Keys: `photoKey(ref)` = FNV-1a 32-bit → 8 hex (`:32-39`); clash → hash of `ref#1`, `ref#2`… (`uniqueKey` :46-51).
- Cover = first item.
- Warning for Dropbox photos without preview (HEIC/HEIF or > 20MB) (`:275-290`):
  `N קבצים בתיקייה (HEIC או גדולים מ-20MB) יופיעו בגלריה בלי תצוגה, כי דרופבוקס לא מכין להם תצוגה מקדימה: <names> ועוד M. שמרו אותם כ-JPG קטן יותר וטענו שוב.`

### 5.6 Re-loading a folder: merge rules (`mergePhotoData` `W/photos.ts:210-254`, `matchSaved` :168-191)
- Each saved photo keeps its key on the file it now is: match by same `ref`, then by `alt` (old Dropbox path vs new id ref), then by
  unique `(folder, name)` pair. Keeps `set` (if set id still exists, else folder preset), `hidden`, `ar`, `t`, `label`.
  If the file's version `v` changed: keeps set + hidden only (shape/time/label re-measured).
- Keeps studio's sets, cover (if still present), `timeOrder`, `coverPos`, `faceSearch`, `design`, `timesV`, `gen`.
- Items re-sorted by `sortByTime(items, timeOrder !== false)` (`:132-157`): by `t`, a photo without `t` goes right after the nearest
  earlier photo by name in the same folder, else nearest earlier overall, else at start. (First load ever: name order, no sort by time.)
- **New shared link** (`dropbox-link` with a different folderUrl): nothing inherited for `l:` refs, no old key reused, faceSearch
  dropped, face data deleted (`sharedLinkReplaced` :197-199; `W/index.ts:681-684`).
- **Confirm**: if more than 10% of "chosen" photos (hearts, Instagram, list keys, album slots) that were in the old list would vanish,
  nothing is saved and the answer is `{needsConfirm:true, lost, total}`; resend with `confirm:true` (`W/index.ts:643-691`, `chosenLost` :297-308).
- `gen` (`nextGen` :265-272): unchanged if same folderUrl, same count, and every key maps to the same `ref+v`; else
  `max(old+1, floor(now/1000))`.
- Response: `adminPhotos` (full data incl refs, favorites, favBy, insta, previewToken) + `warnings[]`.

---

## 6. Studio edits, capture times, labels

### 6.1 `PUT /api/admin/galleries/:id/photos` (`W/index.ts:768-794`, `applyPhotoEdits` `W/photos.ts:555-619`)
Input fields: `sets[] (≤40, {id,name≤40})`, `items{key: {set?, hidden?, ar?, t?|null, label?}}`, `cover`, `timeOrder`, `coverPos{x,y}`,
`faceSearch`, `design` (null = studio default), `timesV: 2`.
- Unknown keys/sets ignored; `ar` accepted 0.2..5 (rounded 3 decimals); `t` accepted 1990..2100 ms, `null` removes; label ≤30.
- Items re-sorted after item edits / timeOrder change.
- A key shared by two photos (pre-P64 lists) is not edited → answer adds `ambiguous[]` and
  `warning: 'חלק מהתמונות חולקות קוד אחד עם תמונה אחרת, ולכן השינוי לא נשמר עליהן. טענו את התיקייה מחדש כדי להפריד ביניהן.'`
- Saved via `editPhotos` (`:631-655`): up to 3 tries; first try may use the isolate-cached list for the gallery row's version; computes
  `diffPhotoData` (`:724-743`) → `films_photos_patch` (only changed items, order if changed, changed fields); if not expressible
  (count/keys changed, other fields changed, duplicate keys) → whole save `PATCH films_photos?version=eq.<expected>`. 3 conflicts →
  409 `מישהו אחר שמר את התמונות של הגלריה באותו רגע. רעננו את הדף ונסו שוב.` Test: hiding 1 photo of 5,000 sends <4KB (`T/photo-cache.test.ts:226`).
- Hiding photos with face search on → face data of hidden photos removed; faceSearch off → all face data deleted.
- Read-only studio: only `{faceSearch:false}`.

### 6.2 Capture time & Lightroom labels: `POST …/photos/dates {keys}` (`W/index.ts:706-766`)
- Per call at most `datesBatchSize(provider)` (`S/photosets.ts:26-36`): Dropbox 20, Drive 20 (10 without API key), pCloud 8 (free plan
  50-subrequest budget). Extra keys → `skipped`, `batch` = size used.
- For each photo: `fetchOriginalStart` = the original with `Range: bytes=0-65535` (`W/photos.ts:1072-1074`); Dropbox 8 parallel lanes,
  others all at once. Not a picture (`pictureKind` `S/exif.ts:15-23`: JPEG/PNG/TIFF/HEIF/WebP/GIF magic) or text/JSON → `failed`.
- `exifTakenAt` (`S/exif.ts:26-86`): EXIF DateTimeOriginal (0x9003) → DateTimeDigitized → IFD0 DateTime, + SubSecTimeOriginal; read as UTC ms;
  supports JPEG APP1, TIFF, HEIC (`Exif\0\0` scan). `xmpLabel` (`:92-97`) `xmp:Label="Red"` or `<xmp:Label>`; `normalizeLabel` maps EN/HE names to
  `red|yellow|green|blue|purple`.
- A Dropbox 401 stops the batch with the reconnect message.
- The HUB drives the loop (`HUB/lib/photoDates.js`, `HUB/components/films/PhotosEditor.jsx:180-232`): 3 parallel lanes of batches, retries
  failed up to 3 rounds, then PUTs `{items:{key:{t,label}}}` in chunks of 1,000, then `{timesV:2}` when every photo was read, then applies
  label→set mapping client-side if `labelSetsOn`. Aspect ratios (`ar`) are measured by the hub from loaded previews and PUT the same way.

---

## 7. Public couple API (photo-relevant)

| Method & path | Line | Behaviour |
|---|---|---|
| GET `/<slug>/<id>`, `/watch/<id>` (HTML) | `W/pages.ts:113-151` | SPA index.html with OG/manifest tags (§12) |
| GET `/api/watch/:id[?pt=]` | `W/index.ts:1097-1141` | gallery view (below). `Cache-Control: no-store`; sets studio cookie when `pt` valid |
| POST `/api/watch/:id/unlock` `{code}` / `/pin` | 1170-1185 | password / download code → Set-Cookie (§9.3) |
| GET/HEAD `/api/photos/:id/:key` and `/api/photos/:id/v<gen>/:key?s=m|md|l|full[&dl=1][&pt=]` | 1191-1247 | photo proxy (§8) |
| POST `/api/watch/:id/fav` `{key|keys[], on, who}` | 1869-1882 | hearts (§10) |
| POST `/api/watch/:id/insta` `{key|keys[], on}` | 1250-1263 | Instagram marks |
| POST/PUT/DELETE `/api/watch/:id/lists[/:list]` | 1289-1326 | personal lists |
| POST `/api/watch/:id/event` `{type:'view'|'download'}` | 1920-1931 | counters (§9.4) |
| POST `/api/watch/:id/terms` | 1934-1954 | terms acceptance record |
| GET `/api/manifest/:id` | 1956-1960, `W/pages.ts:157-180` | PWA manifest |
| GET `/api/cover/:id[?v=][&pt=]` | 1962-1970 | custom cover (KV) |
| GET/HEAD `/api/music/:tid/:id` | 1849-1866 | slideshow song from Storage, Range forwarded, `public, max-age=86400` (no gallery check: tenant must be active with photos module) |
| GET `/api/watch/:id/all` | 1903-1913 | films only — photo galleries → 404 `אין תיקייה להורדה` |

`GET /api/watch/:id` for a photo gallery (role couple, open, past password) returns:
```
{ id, kind:'photos', coupleName, date, venue, expiresAt, daysLeft, expired, coverUrl, studioName, logoUrl, accentColor,
  termsText, contactLine, instagram, films:[], folderDownloadUrl:'', folderProvider:'',
  downloadLocked?: true, slug, role, guestPath:'/<slug>/<guestId>', linked:{kind,path}|null,
  photos: { sets (only used ones), items:[{key,name,set,ar(default 1.5)}] (visible only, no refs), cover, coverPos,
            base:'/api/photos/<viewId>/v<gen>', recommended:150, faceSearch, music:'/api/music/<tenant>/<track>'|'' ,
            design (effective), cloudOff?: true },
  favorites:[keys in first-heart order], favBy:{key:[who…]}, insta:[keys], lists:[{id,name,keys}] }
```
(`W/galleries.ts:415-476`, `W/photos.ts:785-797`, `W/settings.ts:99-115`). Guests get the same under their own id, with empty
favorites/favBy/insta, no lists, no guestPath, `linked:null`, cover via guest id. Behind a password: only
`{id, kind, coupleName, date, venue, studioName, logoUrl, accentColor, expired, daysLeft, slug, locked:true, role}`. Expired: no photos.
`cloudOff` when the list reads through Dropbox and the studio is disconnected; photos then answer 503
`התמונות לא זמינות כרגע: החיבור של הסטודיו לאחסון התמונות נותק. פנו לסטודיו.`

DB calls per `/api/watch/:id` ≈ 8–10: gallery (+guest lookup), tenant info, films settings, secret, films_photos (unless isolate-cached for that
version), hearts (1 per 1,000 rows), insta, lists, linked gallery.

---

## 8. Serving photos to the couple (the proxy)

### 8.1 Addresses & sizes
- Built only by `S/photoUrl.ts`: `photoBase(id, gen) = /api/photos/<id>/v<gen>`; photo = `<base>/<key>?s=<size>[&pt=…]`;
  print shop `/api/print/<token>/photo/v<gen>/<key>`. `askedVersion` accepts `v\d{1,16}` else 404. Address without `v<gen>` still works
  (old links; browser cache 1 day).
- Sizes (`W/photos.ts:862-866`):

| size | use (couple SPA) | Dropbox `get_thumbnail_v2` | Drive `thumbnail?sz=` | pCloud `getpubthumb size=` |
|---|---|---|---|---|
| `m` | grid (`srcset` 640w), hub list | `w640h480` | `w800` | `640x480` |
| `md` | grid on sharp screens / big cells (1024w), OG image | `w1024h768` | `w1200` | `1024x768` |
| `l` | lightbox, neighbour preloads, slideshow, cover hero, ZIP "small" | `w2048h1536` | `w2048` | `2048x1024` (pCloud max height 1024) |
| `full` | original download, ZIP "full", dates probe | original file | original | original |

Dropbox thumbnails: `format: jpeg, mode: fitone_bestfit`, `resource {.tag:'path', path}` (own) or `{.tag:'link', url: folderUrl, path}` (shared link).

### 8.2 Request flow (`photoRoute` `W/index.ts:1220-1247`; order matters)
1. Parse `v<gen>` (bad → 404 `לא נמצא`).
2. `publicGallery` → gallery (couple or guest id), tenant active with photos module; not a photo gallery → 404 `הגלריה לא נמצאה`.
3. `size` = `l|md|full` else `m`; `dl=1` = download.
4. `requireView` (password cookie / preview token / thumbs token only for `m` non-download) → 401 `הגלריה מוגנת בסיסמה`.
5. Expired and not studio → **410** `הגלריה נסגרה`.
6. `full` without download right → 403 `להורדה באיכות מלאה צריך את קוד ההורדה מהסטודיו`. (Previews `m/md/l` need only the password.)
7. **Edge cache** (previews only, not `dl`): key `https://photo-cache.internal/<galleryId>/<key>/<size>/v<photos_visible_version>/g<photos_gen>`
   (`W/photos.ts:897-899`). Hit → answer (only visible photos are ever stored).
8. Miss → `films_photo_item` RPC (one photo; with `copies` for `full`) → missing or hidden (and not studio) → 404 `התמונה לא נמצאה`.
9. Cache write allowed only if the item was read at the same visible version as the gallery row.
10. `photoResponse` (`W/photos.ts:947-1003`):
    - `full` → `largestCopy` (`:1041-1064`): the same photo exported twice (e.g. `טופ2` small copies) → send the largest; copies = same
      capture ms (only if `timesV===2`) and same aspect (±0.03), or same file name in another folder confirmed by reading the first 64KB
      of both (Drive direct only); never a copy the viewer may not see.
    - Dropbox ref + studio disconnected → 503 `CLOUD_OFF_WORDS`.
    - `fetchImage` (`:1080-1142`):
      - **Dropbox**: `POST https://content.dropboxapi.com/2/files/get_thumbnail_v2` (previews) or `files/download {path}` (own, full) /
        `sharing/get_shared_link_file {url, path}` (link, full) with `Authorization: Bearer`, `Dropbox-API-Arg` (non-ASCII escaped, `apiArg`
        `W/providers/dropbox.ts:427-429`), `Dropbox-API-Path-Root` if team, `Range` forwarded for `full`. `retryBusy`: one retry after
        `Retry-After` (≤3s) on 429/503 (`W/providers/dropbox.ts:33-39`). 409 on a preview with
        `unsupported_extension|unsupported_image|conversion_error` → 415. 401 → refresh token, retry once.
      - **Drive**: previews `https://drive.google.com/thumbnail?id=<id>&sz=<w…>` (redirect follow, no key, unofficial endpoint); full
        with key `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=<GOOGLE_API_KEY>` + Referer; without key
        `https://drive.usercontent.google.com/download?id=<id>&export=download&confirm=t`. Range forwarded for full.
      - **pCloud**: previews `https://<host>/getpubthumb?code=&fileid=&size=` (tries hosts; JSON error with 200 → 502 with reason,
        `W/providers/pcloud.ts:67-82`); full: `getpublinkdownload?code&fileid` → `https://<hosts[0]><path>` (cached in isolate memory
        until `expires − 5min` or 1h, ≤2,000 entries), Range forwarded; 403/404/410 → fetch a fresh address once (`:85-108`).
    - Upstream not ok (≠200/206) or not a picture (previews: type must start `image/`; full: not text/json/html/js) → logged, body cancelled,
      answer `no-store` text: 415 `לתמונה הזו אין תצוגה מקדימה (HEIC או קובץ גדול מ-20MB). אפשר להוריד אותה באיכות מלאה.` or 502
      `התמונה לא זמינה כרגע. נסו שוב בעוד כמה דקות.`; with `dl=1` → a small RTL HTML page `ההורדה לא הצליחה` + "חזרה לגלריה" (`:848-853`).
    - Success: copies `Content-Type, Content-Length, Content-Range, Accept-Ranges`; status passes through (206 for ranges).
11. Cache write uses `body.tee()`; with `waitUntil` the response is sent first and the edge `put` finishes in the background.

### 8.3 Response headers (`W/photos.ts:873-882, 908, 987`)
- `Content-Type`: the upstream type if it matches `SAFE_IMAGE_TYPE`, else forced `image/jpeg` (an SVG/HTML never runs on the site).
- `Content-Security-Policy: default-src 'none'; sandbox`.
- `Content-Disposition: inline`, or for `dl=1`: `attachment; filename="<ascii>"; filename*=UTF-8''<encoded name>`.
- `Cache-Control`:
  - preview of a visible photo, address with the CURRENT gen: `public, max-age=31536000, immutable`
  - preview, address without/older gen: `public, max-age=86400`
  - `full`, `dl=1`, or hidden photo (studio): `private, max-age=3600`
  - errors: `no-store`
- Edge copy is always stored with the 1-year header (the key carries the versions).
- Plus site-wide `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (§12).

### 8.4 Where previews are cached
1. **Browser** (per URL, 1 year/1 day).
2. **Cloudflare edge Cache API** (`caches.default`) — per data centre (not global), key includes gallery id, photo key, size, gallery-wide
   `photos_visible_version` and `photos_gen`. Note: ANY hide/unhide or whole save bumps the gallery's visible version → every preview of that
   gallery misses the edge cache once per data centre afterwards.
3. **Never stored by us**: no thumbnails are generated or saved (unlike the original app's D1 thumbs for MyAirBridge, §15). The cloud
   regenerates/serves them on every edge miss.
4. Photo lists: isolate memory (`photoDoc`, ≤4 lists, keyed by `photos_version`, frozen) (`W/photos.ts:666-699`).

### 8.5 Bandwidth
All bytes (previews and originals) flow cloud → Worker → browser. Cloudflare Workers have no egress charge; Dropbox/Drive/pCloud see one
download per edge miss. pCloud public links have their own traffic limit (error 7005).

### 8.6 Requests per photo (from `T/supabase-calls.test.ts:127-148`, code)
- Edge hit: 2 DB calls couple link (gallery, tenant), 3 via guest link (+guest lookup); 0 cloud calls. Test asserts ≤3.
- Edge miss, Dropbox: gallery + tenant + `films_photo_item` + films settings + tenant_secrets = 5 DB, + 1 KV token read (unless isolate
  memory), + 1 Dropbox (2 if busy; +1 token refresh rarely).
- Edge miss, Drive/pCloud: 3 DB + 1 cloud (pCloud full: +1 address call). Drive/pCloud never read studio settings.

---

## 9. Access codes, guests, rate limits, counters

### 9.1 Password & download code
- Set in the gallery form (owner/admin). `cleanSecret`: trim, ≤40 chars; '' removes (`W/access.ts:252-256`). New pin < 6 chars → 400
  `קוד ההורדה צריך לפחות 6 תווים` (old short pins keep working) (`W/galleries.ts:171-176`).
- Without the pin: no `full` originals (403); previews/slideshow/ZIP-small (size `l`) still allowed; couple JSON has `downloadLocked: true`.
- Typed via `POST /api/watch/:id/unlock|pin {code}`: wrong → 400 `הסיסמה לא נכונה` / `הקוד לא נכון`.

### 9.2 Guests link
Photo galleries only. `/<slug>/<guestId>`: view + download (same password/pin rules; the couple's cookie also opens the guests' link; a
guest cookie never opens the couple's). No hearts/insta/lists/album/face-scan (403). Views counted as `guest_views`.

### 9.3 Rate limits (all `films_rate_hit` on `rate_limit_hits`, key prefix `films:`)
| Key | Limit | Where | On exceed |
|---|---|---|---|
| `unlock:<gid>:<ip>` / `pin:<gid>:<ip>` | 10 per 15 min (every attempt) | `W/index.ts:1173` | 429 `יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.` |
| `unlock-fail:<gid>` / `pin-fail:<gid>` (films_rate_count) | 40 wrong per hour, all IPs | `:1143-1182` | 429 `יותר מדי ניסיונות שגויים לגלריה הזו. נסו שוב בעוד שעה, או פנו לסטודיו.`; at exactly 40 a bell `films_gallery_locked` ("הסיסמה/קוד ההורדה של הגלריה X ננעלו לשעה"); counter unreadable → 503 `לא ניתן לבדוק את הסיסמה כרגע. נסו שוב בעוד רגע.` (fail closed) |
| `fav:<gid>:<ip>` | 1,500/h (hearts, insta, lists share it) | `:1256,1285,1875` | 429 `יותר מדי סימונים בזמן קצר. נסו שוב בעוד כמה דקות.` |
| `event:<gid>:<ip>` | 30/h | `:1928` | silently ignored (answers ok) |
| `terms:<gid>:<ip>` | 20/h | `:1941` | 429 default message |
| `admin-upload:<tenant>` | 200/h | `:1016-1018` (cover, film frame, music) | 429 `יותר מדי העלאות בשעה האחרונה. נסו שוב מאוחר יותר.` |
- `hit()` fails OPEN on DB error (`W/store-supabase.ts:805-818`); `failures()` fails closed.
- IP = `CF-Connecting-IP`; IPv6 grouped by /64 (`W/studio.ts:259+`).
- **No rate limit on `/api/photos/*`** (runbook suggests a Cloudflare WAF rule for POST `/api/*`).

### 9.4 Views / downloads counters
- Client calls `POST /api/watch/:id/event {type}` (`SRC/lib/events.ts`): `view` once per page load per link; `download` once per
  single-photo download and once per finished ZIP (if any photo succeeded) (`SRC/photos/ZipDialog.tsx:54`, `SRC/photos/PhotoGallery.tsx:1383,1395`).
- Server (`W/index.ts:1920-1931`): only if the visitor may view and is not the studio; closed gallery ignored; 30/h/IP/gallery;
  `films_count_event` increments `views`, `guest_views` (view via guest link) or `downloads` (guest downloads go into the same `downloads`).
  Always answers `{ok:true}`. The photo proxy itself counts nothing.

### 9.5 Terms acceptance
`POST /api/watch/:id/terms` (`W/index.ts:1934-1954`): open gallery, past password, not studio; stores terms hash, salted IP hash, UA ≤200,
role, link id. Hub shows `films_terms_summary`.

---

## 10. Favorites (hearts), Instagram marks, personal lists

- **Hearts are server-side, per name, not per device**: `films_hearts(gallery_id, photo_key, who)`. `who` = the name the visitor typed
  ("מאי", "אמא"), cleaned ≤30 chars, '' if none (`W/photos.ts:802-807`); the browser remembers its name in `localStorage['fav-who:<galleryId>']`
  (`SRC/photos/PhotoGallery.tsx:670,969`). Anyone with the couple's link (and password) can heart/unheart under any name.
- `POST /api/watch/:id/fav {key|keys(≤500), on, who}` (`W/index.ts:1869-1882`): couple link only, open, past password, keys must be
  8-hex and currently visible (`visibleKeys` `:1266-1273`; else 404 `התמונה לא נמצאה`, empty 400 `לא נבחרו תמונות`, >500 400
  `עד 500 תמונות בכל פעם`). `on` → one bulk insert (ignore duplicates); off → deletes in groups of 200 keys. Returns `{favorites, favBy}`.
- `favorites` = keys in first-heart order; a photo stays a favourite while anyone hearts it. Couple sees only visible photos' hearts; studio
  sees hidden ones too. Recommended count 150 with messages (`W/photos.ts:834-838`):
  `בחרתם N · מומלץ 150 לאלבום` / `…הגעתם להמלצה לאלבום` / `…מעבר ל-150 תמונות ייתכן חיוב בדפים נוספים`.
- **"Sent to the studio"**: there is no submit step for hearts — every tap is saved immediately and the studio reads them live in the hub
  (`GET /api/admin/galleries/:id/photos` → favorites/favBy/insta). No notification is sent for hearts. (The album "send" is a separate
  album feature.)
- Instagram marks: `films_insta`, same rules, no `who`.
- Personal lists (`W/index.ts:1276-1326`): name cleaned ≤40 (`צריך שם לרשימה`), ≤20 per gallery (`אפשר עד 20 רשימות בגלריה`), name unique
  (`כבר יש רשימה בשם הזה`), create-or-append by name, toggle keys atomically, rename, delete; list not found → 404 `הרשימה לא נמצאה`.

---

## 11. Downloads

- **Single photo** (`SRC/photos/PhotoGallery.tsx:1360-1400`): "full" needs the pin. On a computer: a `Range: bytes=0-0` probe, then
  `<a href="…?s=full&dl=1" download>` (browser download, 2 proxied requests). On phones / "small": `fetch ?s=full|l` → blob (small copy
  re-encoded in the browser) → share sheet / save.
- **ZIP — made in the browser, not the server** (`SRC/photos/zip.ts`, library `client-zip`): 4 photos fetched in parallel
  (`ZIP_PARALLEL` :31) from the same proxy (`?s=full` or `?s=l` for "small"), only `image/*` answers included (others counted failed);
  Chrome/Edge desktop stream to a file via `showSaveFilePicker`; otherwise in-memory parts of ≤500MB (`PART_BYTES` :21) saved as
  `<name>-part-N.zip`. Names unique case-insensitively (`zipNames` :38-57; small copies `-small.jpg`). Photo galleries have NO server
  "download all" (their folder holds hidden photos; `W/index.ts:1903-1906`).
- Original appears as `application/octet-stream`/`image/*`; forced to a safe image type header.

---

## 12. Expiry, extend, close, trash, CORS/CSP, OG pages

### 12.1 Expiry
- Closing moment = 23:59:59 Israel time (DST-aware) (`S/day.ts:21-39`); `closeAfterDays(createdAt, days)` counts calendar days;
  explicit `expiresAt` → end of that day; ≤ 10 years after creation (`MAX_GALLERY_DAYS 3650`) else 400 `תאריך הסגירה רחוק מדי: עד 10 שנים מיום יצירת הגלריה`.
- `isExpired = expires_at <= now`; `daysLeft` in Israel calendar days (`W/galleries.ts:385-392`).
- Closed: couple JSON without photos; photos 410; hearts/lists/insta 410; studio preview still sees everything.
- Extend (single/batch): `films_galleries_extend` (from later of now / current close, +days, ≤10y, guarded by `seen`). Close now (batch):
  `expires_at = now` (days ≥1). Face data deleted on close/trash/purge.
- Changing `days` in the form only re-computes the close date if `days` actually changed (`W/galleries.ts:181-189`).

### 12.2 Trash (30 days)
- Trash: `deleted_at = now()` (guard: was null) → every link (couple, guest, print, OG, manifest, cover, list thumbs) stops at once; face data
  deleted and face search off first; edge cover forgotten (`W/galleries.ts:360-369`).
- Restore: clear `deleted_at`.
- Album guard (`W/galleries.ts:328-346`): open album order → 409 `album_order`; sent album → 409 `album_submitted` unless `force=1`;
  purge of paid/in-print order → 409 `album_paid` (never).
- Purge (`?forever=1` on a trashed gallery, batch purge, or cron after 30 days): faces → partner unlinked (guarded) → `DELETE films_galleries`
  (cascades films_photos, films_hearts, films_insta, films_photo_lists, films_terms_accepts, films_albums (0078:8), films_face_searches;
  `album_orders.films_gallery_id` is set null (0080:13); a linked gallery's `linked_id` is set null) → KV `cover:` and `thumb:` deleted
  (`W/galleries.ts:348-382`).

### 12.3 CORS (`W/index.ts:2045-2056, 2104-2105`)
Only for `/api/admin/*` and `/api/album-portal/*`: `Access-Control-Allow-Origin` = request Origin only if it equals `HUB_URL` exactly;
methods `GET, POST, PUT, DELETE, OPTIONS`; headers `Authorization, Content-Type, X-File-Name`; `Max-Age: 600`; `Vary: Origin`. OPTIONS → 204
with headers, or 403. Public couple routes are same-origin (no CORS). The hub shows photos with plain `<img src="https://films…/api/photos/…&pt=…">`.

### 12.4 Site headers (`W/index.ts:2063-2086`)
Every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP (unless the response set its own):
`frame-ancestors 'self' <hub origin>; object-src 'none'; base-uri 'self'` (the hub's design editor frames the gallery). Errors: JSON
`{error}`; unexpected → 500 `שגיאה לא צפויה בשרת`; unknown route 404 `לא נמצא`; bad URL encoding 400 `כתובת לא תקינה`; bad JSON 400 `בקשה לא תקינה`.

### 12.5 OG / WhatsApp preview pages (`W/pages.ts`)
- Any GET not under `/api/` matching `^/(?:watch|[^/]+)/([a-f0-9]{16})/?$` (gallery) or `^/([a-z0-9][a-z0-9-]{1,40})/?$` (studio page, not reserved
  `watch, accessibility, print, api, assets, demo, models`) → fetch `index.html` from ASSETS and inject with `HTMLRewriter`:
  `<title>`, `description`, `og:type website`, `og:title`, `og:description`, `og:url`, `og:locale he_IL`, `og:image` (absolute),
  `twitter:card` (`summary_large_image` with image), `<link rel=manifest href=/api/manifest/<id>>`, `apple-touch-icon` (studio logo),
  `apple-mobile-web-app-title` (couple), `apple-mobile-web-app-capable`; gallery pages keep the `robots` noindex meta; `Cache-Control: no-store`.
- Gallery card: title `<couple> · <d.m.yy> · <venue>`, description `גלריית התמונות · <studio>`; image = custom cover
  (`/api/cover/<id>?v=…`) else the cover photo `…/v<gen>/<cover_key>?s=md` (1024px) — **no image if the gallery has a password**;
  closed → description `הגלריה נסגרה`. Uses the guest id when shared via the guest link (never reveals the couple's id). Reads no photo list
  (uses `cover_key`, `photos_gen` from the row).
- Manifest (`:157-180`): name `<couple> · <studio>`, short_name ≤24, start_url/scope = the gallery path, standalone, rtl, he, white theme for
  photo galleries, icon = studio logo or favicon; `private, max-age=300`.
- Errors in page rendering fall back to plain assets.

---

## 13. Cron jobs

### 13.1 Hourly clean-up `"0 * * * *"` → `nightly()` (`W/cleanup.ts:74-215`, `W/index.ts:2132-2154`)
Budget = `CLEANUP_MAX_SUBREQUESTS` (45; KV calls counted too), time limit 60s, items costed in advance.
0. `films_print_links_expire(30)`; `films_close_lapsed_studios(30)` — studios canceled >30 days: open galleries closed now, print tokens cleared.
1. Face data to delete (`films_faces_cleanup_candidates`: gallery gone/trashed/closed/face search off/scan >365 days/studio ended >30 days/orphan files) → delete files + record, face search off.
1b. Rewrite face files still holding hidden photos' faces (≤5 files per gallery per run).
2. Trash older than 30 days → `purgeGallery` (round-robin per studio; failures marked `purge_failed_at` and retried last; album-blocked ones skipped and reported). PURGE_COST 9 requests → ~4 galleries per run on the free plan.
3. `films_sweep_rate_hits()` always.
4. `films_cleanup_record`. Any error → the run throws at the end (Cloudflare Cron Events shows failure).

### 13.2 `"20 0-3,22-23 * * *"` → link check (`W/cleanup.ts:294-451`)
**Films only** (`films_link_check_candidates` selects film galleries with films). Photo galleries are NOT link-checked; a broken photo
folder surfaces only as 502s on previews (and `cloudOff` for a Dropbox disconnect).

### 13.3 pg_cron
`rate-limit-sweep-daily` 02:50 UTC (`M/0154_rate_hit.sql:97`). Nothing else for photo galleries.

---

## 14. Dependencies on other features (what is shared)
- **Faces**: `PhotoData.faceSearch`, `films_galleries.faces_off_at`; `store.deleteFaces` on trash/close/purge/batch/new shared link/face search off;
  `removeFacePhotos` on hide or photos gone (`W/faces.ts:103-117`); `films_faces*` RPCs; cron steps 1/1b. If faces are not rebuilt these become no-ops.
- **Album designer / couple album / print shop**: use the same `photoResponse` + `films_photo_item` (`W/index.ts:820-826, 1790-1802`);
  `chosenKeys` includes album slots for the reload confirm (`:643-648`); `films_album_guards` blocks trash/purge; `GALLERY_LIST_FIELDS.eventId`.
  Print shop gets hidden photos that are in the sent album (never via the edge cache).
- **Music**: `films_studio_settings.music/music_default`, gallery `music`, Storage `films-music`, `/api/music/...`.
- **Design**: `PhotoData.design` + `films_studio_settings.design_default` (`S/design.ts`, couple-page researcher).
- **Studio identity**: `tenants` (name/display name, logo, phone/whatsapp, instagram, facebook, slug, accent), `tenant_access_state`, `tenant_has_module(…,'photos')`, slug history.
- **Film galleries**: `linked_id` cross-link; same table/routes/crons.

---

## 15. Differences vs the original standalone app (`ORIG/`)
- ORIG used Cloudflare D1 (`films-db`) + KV for all data and **9 extra D1 databases (`THUMBS1..9`) holding small previews for MyAirBridge
  photo galleries** generated in the studio's browser (`ORIG/worker/thumbs.ts:1-30`, `ORIG/wrangler.jsonc`), with routes
  `/api/admin/galleries/:id/thumbs/start` and `/thumbs`. studio-os dropped MyAirBridge as a photo source (decision D2) and has no stored thumbnails.
- ORIG cron was nightly `0 1 * * *`; studio-os is hourly with a budget.
- Data moved to Supabase (P-series fixes: versions, patch RPC, gen, access version, sealed tokens).

---

## 16. What needs a long-lived streaming/proxy server vs what fits Supabase Edge Functions + Vercel

Assumed target limits (from the brief): Edge Functions ~2s CPU, 150s idle, 400s wall clock; Vercel serves the static SPA.

### 16.1 Genuinely wants an edge proxy (a Cloudflare Worker or equivalent)
| Piece | Why |
|---|---|
| `GET /api/photos/...` (m/md/l previews) | Highest volume (thousands per gallery visit); must check access (password cookie, trash, expiry, hidden, studio suspended) **before** serving a cache hit; edge Cache API keyed by visible-version/gen; hides cloud tokens & file locations; Dropbox thumbnails exist only behind an authenticated POST (no public/temporary thumbnail URL to redirect to). Supabase Edge Functions have no shared cache, are billed per invocation and egress; a plain CDN (Vercel) caches by URL and would keep serving trashed/closed/password-protected photos. |
| `?s=full` originals + `dl=1` + client ZIP of originals | Multi-MB streaming with Range, 2,000 × 5–25MB per full ZIP; Workers have no egress fee; must keep same-origin + cookie semantics. Possible alternative: 302 to a short-lived upstream link (Dropbox `files/get_temporary_link` for own-account refs; pCloud `getpublinkdownload` address; Drive usercontent URL) — but that exposes the file id/URL, cannot be revoked at gallery close, and the client ZIP then needs CORS from the cloud (needs verification). |
| Print shop / album designer photo files | Same function as above (lower volume); could live wherever the photo proxy lives. |

Auth coupling: password/pin/studio access is **cookie-based on the films origin** (HttpOnly, SameSite=Lax) and `<img>` tags send them only
same-origin. Whatever serves photos must be on the same origin as the couple page (e.g. Vercel rewrites `/api/*` to the backend), or the
design must switch to signed per-session URL tokens.

### 16.2 Fits Supabase Edge Functions (short JSON, I/O-bound) or plain Postgres RPC
- All `/api/admin/*` photo routes: CRUD, bulk (≤100), batch (≤50), extend/close/trash/restore/purge, settings, music upload (≤10MB body),
  cover upload (≤2MB, move to Storage), Dropbox OAuth connect/callback/finish/disconnect/impact, rotate guest, link.
- `photos/load`: up to ~40 folder calls + paging (2,000 per Dropbox page, 1,000 per Drive page) + sort/merge of ≤20,000 items — I/O bound;
  the 2s CPU should hold (P61 notes Collator reuse to keep sorting a few thousand under 100ms; 20,000 items/≈4MB JSON is the stress case — benchmark).
- `photos/dates`: 20 × 64KB range reads per call (no 50-subrequest cap in Edge Functions → batches could be larger).
- PUT photos (patch RPC), dashboard, galleries list.
- Couple JSON: `/api/watch/:id`, unlock/pin (Set-Cookie must be first-party → route via the page's origin), fav/insta/lists, event, terms, manifest.
- Music: replace the proxy with signed Storage URLs (Range handled by Storage).
- Covers: Supabase Storage (versioned path) instead of KV.
- Dropbox access-token cache: a service-role table (or per-isolate memory) instead of KV.
- Crons: pg_cron SQL for trash purge (cascades), print-link expiry, lapsed studios, rate-limit sweep; one Edge Function only where Storage
  objects must be deleted (faces). The films link check is not needed for photos.

### 16.3 Needs server-side HTML but tiny
- OG/WhatsApp tags + manifest for `/<slug>/<id>`: on Vercel this needs Middleware/Edge Function (or a rewrite to a Supabase function) that
  reads `films_galleries` (cover_key, photos_gen, password, names) and injects tags; static `index.html` alone cannot show per-gallery cards.

### 16.4 Request-volume estimate for one 2,000-photo gallery (ESTIMATES; sizes assume Dropbox JPEG thumbnails and 24–45MP camera JPEGs)
Studio setup (once):
- Folder load: 1 Worker call → ~5–10 Dropbox API calls (account, link metadata ×1–2, list_folder ×1–3, recursive pages ×1–2).
- Capture times/labels: 2,000/20 = **100** `/photos/dates` calls → **2,000** Dropbox 64KB range downloads (~128MB pulled); 2 PUT patches.
- Hub editor previews (`?s=m&pt=`): ~**2,000** photo requests (edge misses on first view: ~2,000 Dropbox thumbnail calls).

One couple/guest full visit (page + scroll whole grid):
- ~5 page/API requests (HTML, manifest, `/api/watch`, event, cover) + **~2,000** preview requests (`m`, or `md` on large cells/high-DPR).
- Each opened photo in the lightbox: 1 `l` + 2 preloads; full slideshow: **2,000** `l`.
- Worker invocations ≈ 2,000–2,100; Supabase calls ≈ 4,000–6,000 (2–3 per edge hit) or up to ~10,000 on a cold edge (5 per Dropbox miss);
  Dropbox thumbnail calls ≈ 0 (warm edge) to 2,000 (cold edge / after any hide-unhide, per data centre).
- Bytes: grid `m` ≈ 50–90KB each → ~100–180MB; `md` ≈ 120–200KB → ~250–400MB; `l` ≈ 0.4–0.8MB.
- ZIP "small" (`l`): 2,000 requests, ~0.8–1.6GB. ZIP "full": 2,000 requests (+ `largestCopy` probes when duplicate names exist),
  **~10–50GB** proxied (5–25MB per original).
Wedding-scale (e.g. couple + 50–100 guests partially browsing + 2–3 ZIPs): on the order of **20k–100k Worker requests and 50k–300k Supabase
REST calls** per gallery over its first weeks — which alone can reach the **free Workers plan's 100,000 requests/day** (account-wide, all
studios). The runbook already asks to move to Workers Paid (`docs/runbook.md:3613`).

---

## 17. Risks & open questions
1. **Workers free plan** (45-subrequest budget in config ⇒ free plan): 100k requests/day account-wide and 1,000 KV writes/day; one busy
   gallery can take every studio's galleries down. Runbook item to move to Workers Paid — status unknown.
2. **Gallery-wide cache invalidation**: hiding/showing ONE photo or any whole save bumps `photos_visible_version` → all previews of the
   gallery re-fetched from the cloud per data centre (Dropbox 429 storms on big galleries).
3. **Edge cache is per data centre** and `forgetCover` only purges locally; correctness relies on versioned keys.
4. **No rate limit on the photo proxy** (only Cloudflare WAF suggestion for POST); scraping a public gallery = unlimited cloud calls.
5. **Passwords and download codes are plain text** in `films_galleries` (service-role only since 0100); cookies embed an HMAC of them.
6. **Drive without API key** relies on unofficial endpoints (`embeddedfolderview` scraping, `drive.google.com/thumbnail`), may break or
   throttle; listing may be capped by Google (verify on a 2,000-file folder). The API key is platform-wide; runbook says the key must have
   "Application restrictions: None" while code sends a `Referer` (comments say referrer-restricted) — confirm the real key setup.
7. **Dropbox**: no preview for HEIC or files >20MB (415; studio warned at load); rate limits are not published — only one retry after
   `Retry-After` (≤3s). A Dropbox shared link from someone else still needs the studio's own Dropbox connection.
8. **One JSON document per gallery** (≤20,000 photos, ~4MB): `films_photo_item` expands the whole jsonb on every edge-miss preview.
9. **Cookie/same-origin coupling** (§16.1) — any rebuild that splits the page and the photo/API origin must redesign access.
10. **MyAirBridge photo galleries** existed in ORIG (with D1 thumbnails) but are refused in studio-os (D2) — confirm the target system matches.
11. **Photo folders are never health-checked** (link check is films-only); a deleted/unshared folder shows broken previews silently.
12. **Counters are client-reported** (`event` API; downloads include guests and are per click/ZIP, not per photo); views 30/h/IP cap.
13. **Hearts have no identity**: anyone with the couple link can heart/unheart under any name; no "send selection" step or notification.
14. `FILMS_STATE_SECRET` rotation logs out every couple/guest and kills every preview/thumbs token; `TENANT_SECRETS_KEY` must equal the Edge
    Functions' key and can never rotate (sealed tokens become unreadable).
15. Clean-up throughput on the free plan: ~4 trash purges per hourly run (PURGE_COST 9 within 45).
16. Open question: does the target keep the per-gallery `gen` URL scheme and the "visible version" cache key, or move to stored thumbnails
    (e.g. generate `m/md/l` into Storage/R2 at load time — 6,000 objects per 2,000-photo gallery — and serve via signed URLs)?
17. Open question: whether Dropbox `files/get_temporary_link` / Drive / pCloud direct links send CORS headers good enough for the client
    ZIP if originals are redirected instead of proxied (unverified).
