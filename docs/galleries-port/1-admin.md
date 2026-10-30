# Photo galleries ("גלריות תמונות"): studio admin side in the hub (functional spec)

Researched read-only from `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os` (product "Studio Plan").
Paths without a prefix are relative to `apps/hub/src/`. Worker paths are `apps/films-worker/...`.
Hebrew UI strings are quoted exactly as they appear in the code. `{x}` marks a value inserted at runtime.

The original standalone app (`/Users/danieldayan/Downloads/מערכת צפיה וידאו`) was used only for comparison (§17). Where the two differ, the studio-os version is the one described here.

---

## 0. Map of the feature (admin side)

| Piece | File | Role |
|---|---|---|
| List page `/photos` | `pages/films/FilmsGalleries.jsx` (802 lines) | List, filters, search, table/cards, row actions, bulk bar, extend dialog, list import dialog |
| Summary tiles | `components/films/GalleriesSummary.jsx` (148) | 4 tiles at the top of `/photos`; a compact version on the main dashboard |
| Create/edit page `/photos/new`, `/photos/:id` | `pages/films/FilmsGalleryForm.jsx` (689) | Couple details, access, guests' link, song, link to the couple's film gallery |
| Photo organizer (under the form) | `components/films/PhotosEditor.jsx` (1196) | Load folder, sets, cover, hidden, hearts and Instagram views, Lightroom colours, capture-time order, album card, face-search card |
| Design editor (under the organizer) | `components/films/DesignEditor.jsx` (284) + `DesignEditor.css` (30) | Cover style, font, colour and grid, with a live preview iframe of the couple page |
| Settings `/photos/settings` | `pages/films/FilmsSettings.jsx` (324) | Shared gallery settings plus slideshow songs |
| Worker client | `lib/filmsApi.js` (108) | Base URL, Bearer auth, errors, URL builders, clipboard |
| Paging and batches | `lib/filmsBatch.js` (98) + `lib/filmsBatch.test.js` (93) | Read every gallery in pages of 500; bulk actions with automatic retries; result messages |
| Routes helper | `lib/galleryRoutes.js` (8) | `/photos` vs `/films` by kind |
| Capture-time reader | `lib/photoDates.js` (56) | Batching of `…/photos/dates` |
| Not-configured screen | `components/films/FilmsNotConfigured.jsx` (15) | Shown when `VITE_FILMS_BASE_URL` is empty |
| Shared logic imported from the worker | `apps/films-worker/shared/{event,names,photosets,photoUrl,providers,design,exif}.ts` (alias `@films-shared`, `apps/hub/vite.config.js:114`) | List/line parsing, "&" suggestion, preset sets, photo URLs, design options |

The list and form components are shared with film galleries (`/films`). Everything below describes **photos mode** (`kind === "photos"`). Film-only branches are mentioned only where they leak into photos mode.

---

## 1. How the hub reaches the worker

### 1.1 Base URL and configuration
- `FILMS_BASE_URL = (import.meta.env.VITE_FILMS_BASE_URL || "").replace(/\/$/, "")`, a build-time value (`lib/filmsApi.js:7`; listed in `apps/hub/.env.example:6`).
- `filmsConfigured()` returns true when that value is set (`filmsApi.js:9-11`). When it is empty:
  - `/photos`, `/photos/new`, `/photos/:id` and `/photos/settings` render `FilmsNotConfigured`: a centered Clapperboard icon, h2 `"מודול הסרטים עדיין לא מחובר"`, text `"הגלריות לזוגות יופעלו אחרי שכתובת שרת הסרטים תוגדר במערכת."` (`FilmsNotConfigured.jsx:5-14`). The wording says "films" even on the photos pages.
  - The dashboard galleries row is not rendered (`pages/Dashboard.jsx:310`).
  - `filmsApi` throws `"מודול הסרטים עדיין לא הוגדר (VITE_FILMS_BASE_URL)"` (`filmsApi.js:48`).
- CSP (hub `worker.js:52-64`): the films origin is allowed in `img-src`, `connect-src`, `media-src` and `frame-src` (the design preview iframe). Env `FILMS_URL` on the hub worker.

### 1.2 `filmsApi(method, path, body?, raw?)` (`filmsApi.js:47-76`)
- Reads the Supabase session (`supabase.auth.getSession()`) and sends `Authorization: Bearer <access_token>` (an empty token if signed out).
- JSON body: `Content-Type: application/json`, `JSON.stringify(body)`. Note that keys whose value is `undefined` disappear (see §16, bug B1).
- Raw upload (`raw = { blob, type, fileName? }`): body is the blob, `Content-Type: raw.type`, optional `X-File-Name: encodeURIComponent(fileName)` (used for songs).
- Response: tries `res.json()`, ignoring a missing body. If `!res.ok`, it throws `Error(json.error || "שגיאה ({status})")` with `.status` and, when the worker sent one, `.code` (for example `album_submitted`).
- There is no retry, no timeout and no global 401 handling. Every screen shows `e.message` (a toast or red text). The worker's messages are Hebrew, so they are shown as they come.

### 1.3 URL builders (`filmsApi.js`)
| Function | Result | Used for |
|---|---|---|
| `coupleLink(slug, id)` | `${FILMS_BASE_URL}/${slug \|\| "watch"}/${id}` (`:14-16`) | "קישור לזוג", the link box, `copyLinks`, the guests' link (`coupleLink(slug, guestId)`) |
| `studioPreviewLink(slug, id, previewToken)` | `coupleLink(...)` + `?pt=<encoded token>` (`:23-26`) | "פתיחה כמו הזוג" (a 12-hour studio pass from `GET /api/admin/galleries/:id`) |
| `photoUrl(galleryId, key, size="m", token="", gen=0)` | `${FILMS_BASE_URL}/api/photos/<id>/v<gen>/<key>?s=<size>[&pt=<token>]` via shared `photoPath` (`:37-39`, `apps/films-worker/shared/photoUrl.ts:18-20`) | Photo thumbnails in the organizer and design editor. Sizes are `m`, `md`, `l` and `full` |
| `coverUrl(galleryId, version, token)` | `${FILMS_BASE_URL}/api/cover/<id>?v=..&pt=..` (`:42-45`) | Film galleries only (an uploaded cover) |
| `copyText(text)` | `navigator.clipboard.writeText`. If that fails: `window.prompt("העתיקו את הקישור:", text)` and returns false, so no success toast (`:100-108`) | Every "copy" button |

`tenant.slug` comes from `useAuth().tenant` (the studio's `tenants.slug`). The fallback `watch` applies only when the studio has no slug.

### 1.4 Worker-side auth, as the hub experiences it (`apps/films-worker/worker/supabaseAuth.ts:39-53`)
- 401 `"צריך להתחבר מחדש"`: no or invalid token.
- 403 `"רק מנהלי הסטודיו יכולים לנהל גלריות"`: role not in `owner, admin, studio_manager`.
- 403 `"החשבון של הסטודיו מושהה"`: studio blocked.
- 402 `"הגלריות אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב"."`: neither films nor photos.
- 402 `"גלריות התמונות אינן כלולות במנוי של הסטודיו. אפשר להוסיף אותן בדף "מנוי וחיוב"."`: a photo route without the photos module (`requireKind`).
- 402 `"המנוי של הסטודיו אינו פעיל. אפשר לצפות, אבל לא לשנות."`: a write while the studio is read-only.
- 402 `"המנוי של הסטודיו אינו פעיל. אפשר רק לסגור, למחוק, לבטל קישורים או להחליף סיסמה — לא לשנות או להאריך."`: a read-only studio asking for more than lowering exposure.

---

## 2. Access control

### 2.1 Routes (`App.jsx:143-157`)
```
['/photos',          <FilmsGalleries/>,   ['films','photos']]
['/photos/new',      <FilmsGalleryForm/>, ['films','photos']]
['/photos/settings', <FilmsSettings/>,    ['films','photos']]
['/photos/:id',      <FilmsGalleryForm/>, ['films','photos']]
(+ the same for /films …; /films/studio-page needs 'films')
```
- Each route is wrapped in `<RequireModule module={['films','photos']}>` (`components/ModuleLocked.jsx:46-50`). It renders the page if the studio has **either** module, otherwise `ModuleLocked` for the **first** key (`films`). The locked screen then reads `"גלריות סרטים לא כלול במנוי"` even on `/photos` (§16 Q3). The locked screen has a lock icon, `"{module name} לא כלול במנוי"` and the module summary. Admins also get `"אפשר להוסיף אותו למנוי ב-₪{price} לחודש + מע״מ."` and a button `"להוספה למנוי"` linking to `/Billing?add=films`. Others see `"כדי להשתמש בו, בעלי הסטודיו צריכים להוסיף אותו למנוי."`
- `hasModule(key)` = `studioHasModule(tenant, key)`. It is true during a live trial (`status==='trialing'` and `trial_ends_at` in the future); otherwise `tenant.modules` must include the key (`packages/shared/modules.js:72-77`). The photos module is named `"גלריות תמונות"`, ₪99, with summary `"גלריית תמונות פרטית לכל זוג מדרופבוקס, מגוגל דרייב או מ-pCloud, עם סטים, לבבות לבחירת תמונות והורדה."` (`modules.js:36-40`).
- The gallery routes are mounted both in the full CRM route block (`App.jsx:435`) and in the no-CRM block (`App.jsx:383-401`). A studio without CRM gets `/` redirected to `/films` if it has films, else `/photos` if it has photos (`App.jsx:389`).

### 2.2 Kind redirects (one module only)
- **List** (`FilmsGalleries.jsx:126-129, 305`): `kind = galleryKindOfPath(pathname)`, which is `"photos"` when the path is `/photos` or starts with `/photos/` (`galleryRoutes.js:4`). If the studio lacks `kind` but has the other kind, the page does `<Navigate replace>` to the other list.
- **Form** (`FilmsGalleryForm.jsx:140-149`): the initial kind is `?kind=photos` (legacy) or taken from the path. On a photos path: `canPhotos || !canFilms ? "photos" : "films"`. A new gallery whose kind differs from its path is redirected with `replace` to `{home}/new`. An edited gallery whose kind differs from its path is redirected to `galleryPath(gallery)` (`:235-239`). For example, an old `/films/<photo id>` link moves to `/photos/<id>`.
- **Settings**: there is no redirect; `/films/settings` and `/photos/settings` are the same screen with a different title (§10).

### 2.3 Roles
- Hub panel: only `ADMIN_ROLES = ['owner','admin','studio_manager']` reach the Layout at all (`App.jsx` "Hard block", `lib/permissions.js:41`). Other roles see `"גישה אסורה"` / `"אין לך הרשאות אדמין לגשת למערכת זו."`. The scoped roles (lead_coordinator, photographer, editor, album_manager) have their own route blocks with **no** gallery routes.
- The worker allows the same three roles (`supabaseAuth.ts:8`). There is one exception: the album sketch editor's read routes also allow album_manager (`DESIGNER_ROLES`). That is out of scope.
- **Secrets** (gallery password and download code): only `owner` and `admin` see and edit them.
  - Hub: `seesSecrets = user.role === "owner" || user.role === "admin"` (`FilmsGalleryForm.jsx:133`). The fields are sent only when it is true (`:321`).
  - Worker: `SECRET_ROLES = ['owner','admin']`. `adminGallery` deletes `password` and `downloadPin` for others but adds `hasPassword` and `hasDownloadPin`. `withoutSecrets` strips them from writes (`worker/index.ts:85-111`).
- **"נתק את כל הגישות"** (Settings): owner and admin only. In the hub, `canRevoke` (`FilmsSettings.jsx:54`). In the worker, 403 `"רק הבעלים או מנהל מערכת יכולים לנתק את כל הגישות"` (`worker/index.ts:206-210`).

### 2.4 Subscription state
- `tenantAccess === 'read_only'`: owner, admin and studio_manager get **only** `/Settings` plus `/Billing` for every other path (`App.jsx:258-269`). The gallery screens cannot be reached. An e2e test confirms the "unpaid studio sees the billing page" (`e2e/films.spec.js:490-495`). Other roles see `SubscriptionBlocked`.
- `blocked`: the owner gets only Settings and Billing; others are blocked.
- So the worker's `allowReadOnly` paths (close, trash, purge, a new password, revoking the print link, face search off) can **not** be reached from the hub UI in read-only today. They exist only at the API level (§18 Q1).

---

## 3. Navigation, dashboard, help, notifications, other entry points

### 3.1 Sidebar (`pages/Layout.jsx`)
- **Module switcher** (4 tabs, `role="tablist"`, `aria-label="מודולים"`), shown when the user has no scoped role (`:568-581`):
  - `"סטודיו"` (LayoutDashboard): opens the last studio path from localStorage `module:studio:last`.
  - `"גלריות"` (Images icon): `navigate('/photos')`, shows a lock if the studio lacks photos.
  - `"סרטים"` (Clapperboard): `/films`, lock if it lacks films.
  - `"דסקטופ"`.
  - The lock is a small icon (`aria-label="לא כלול במנוי"`). The tab still navigates; the page then redirects or shows ModuleLocked (`ModuleButton` at `:220-238`). The active tab is `photos` when the path starts with `/photos` (`:380`).
- **Menu while in photos** (`photosNavItems`, `:161-165`): one flat list with no section headers:
  1. `"גלריות תמונות"` → `/photos` (Images icon)
  2. `"גלריה חדשה"` → `/photos/new` (Plus)
  3. `"הגדרות גלריות"` → `/photos/settings` (SlidersHorizontal)
- A row is active only on an exact path match (`renderNavRow`, `:491`), so no row is highlighted on `/photos/:id`. `/photos*` is never locked in the menu (`navSections.js:31` returns no modules for `/films*` and `/photos*`). There are no work-count badges for these rows (`workCountFor` has no case for them).
- The "ניהול מתקדם" group and the year card are hidden while in the galleries module (`:598`, `:629`).
- The floating `"המשך הקמה"` pill rises above the galleries' fixed bottom bars through `useBottomBar()` (`lib/bottomBar.js`, `Layout.jsx:746-754`).
- Phone: the sidebar becomes a sheet opened by `SidebarTrigger` in a `md:hidden` header with the studio logo, name, bell and search (`Layout.jsx:692-705`).

### 3.2 "הסבר על הדף" (page help)
- `components/PageHelp.jsx` adds a pill button at the top-right of the page: `"הסבר על הדף"` plus `"· סרטון 0:50"`.
- Mapping (`lib/pageHelp.js:184-187, 201-202`): `/photos` and `/photos/new` map to key `galleries`, and so does any `/photos/<x>` except `/photos/settings`. **No help on `/photos/settings`.**
- Content (`pageHelp.js:141-153`): title `"גלריות לזוגות"`, subtitle `"סרטים ותמונות בקישור אחד"`, steps:
  1. `"כל הגלריות של הזוגות. למעלה רואים כמה פתוחות, מה נסגר השבוע ומה הכי נצפה."`
  2. `"אפשר לסנן לפי מצב, ולעבור בין טבלה לכרטיסים."`
  3. `"גלריה שעומדת להיסגר מאריכים בלחיצה, בכמה ימים שרוצים."`
  4. `"מסמנים כמה גלריות יחד, ומאריכים, מעתיקים קישורים או סוגרים בבת אחת."`
  5. `"אפשר להדביק רשימת אירועים, ולקבל גלריה לכל זוג."`
  6. `"בתוך גלריה: פרטי הזוג, הסרטים מהתיקייה בענן, וקישור להעתקה ולשליחה לזוג."` (this step talks about films even on photos)
- Video `p-galleries` (`lib/pageHelpVideos.js:18`): `/help/p-galleries.mp4?v=3`, poster `/help/p-galleries.jpg?v=3`, 50 s, title `"גלריות לזוגות"`.
- The panel is a left side sheet: the video, `"מה עושים בדף הזה"` with numbered steps, then `"סרטונים נוספים"` (managers): `"מדריך הקמה"` 5:42 and `"יום עבודה במערכת"` 3:50. If the video fails to load: `"הסרטון לא זמין כרגע. ההסבר הכתוב למטה."`

### 3.3 Main dashboard (`pages/Dashboard.jsx:310, 362-368`)
- Row 4 (`data-testid="dash-row-4"`) holds `<NeedsAttentionCard/>` and, when `(hasModule('films') || hasModule('photos')) && filmsConfigured()`, `<GalleriesSummary compact embed />`. With no `kind`, it shows **both** kinds (§5.6). The row hides when it has no children (`empty:hidden`).

### 3.4 Bell notifications related to galleries (`lib/notificationCategories.js`)
| type | Written by | Bell tab | Menu row lit / bell click goes to |
|---|---|---|---|
| `films_gallery_locked` | Worker `tellStudioLocked` (`worker/index.ts:1157-1167`) after 40 wrong password or code guesses in an hour (**photo galleries too**). Title `"הסיסמה|קוד ההורדה של הגלריה {coupleName} ננעלו לשעה"`, body `"{N} ניסיונות שגויים בשעה האחרונה. אם זה לא הזוג, כדאי להחליף סיסמה|קוד."` | ⚙️ מערכת, emoji 🔒 | `/films` (`:43`). It never goes to `/photos` (§16 Q5) |
| `films_link_broken` | Nightly film link check | ⚙️ מערכת, 🔗 | `/films`; films only |
| `album_designed_by_couple` | SQL trigger when the couple sends a designed album (migrations 0080, 0139) | 📒 אלבומים | `/AlbumOrders/{relatedAlbumOrderId}` |
- The gallery screens create **no** notifications themselves.

### 3.5 Other hub entry points that touch photo galleries
- `components/albums/DesignedAlbumCard.jsx:141`: `"לגלריה"` link to `/photos/{galleryId}` from an album order. It calls `GET /api/admin/galleries/:id` and `…/album`.
- Album sketch editor (`pages/AlbumDesignEditor.jsx`, `lib/albumDesigner/source.js:79-83`): `createEventGallery` creates a photo gallery (`POST /api/admin/galleries {kind:'photos', coupleName, date?, eventId?}`), then `POST …/photos/load {url}`. It lists photo galleries via `GET /api/admin/album-designer/galleries`. Out of scope, but these galleries appear in `/photos`.
- Event merge, dedupe and recycle bin: `films_galleries.event_id` is re-linked when events are merged (`supabase/functions/cleanup-duplicate-events/index.ts:46-49`; label `"גלריות"` in `components/settings/RecycleBinCard.jsx:37`).
- Setup wizard (`lib/onboarding.js:236-254`): there is a **films** step only (`modules:['films']`, Dropbox connect, `"להגדרות הגלריות"` linking to `/films/settings`). There is no photos-specific step.
- The global search does **not** search galleries.
- Automations and WhatsApp templates have **no** gallery-link variable. The couple link is never sent automatically (§6.6).

---

## 4. Screen A: the galleries list `/photos` (`FilmsGalleries.jsx`)

### 4.1 Load sequence
1. If `!filmsConfigured()`, show `FilmsNotConfigured` (`:201`).
2. If the studio lacks photos but has films, `<Navigate to="/films" replace/>` (`:305`).
3. On mount, `load()` calls `readAllGalleries(path => filmsApi("GET", path))` (`:171-177`). It reads `GET /api/admin/galleries?limit=500&offset={n}` repeatedly until `offset >= total` or a page is empty (max 1000 rounds), de-duplicating by id. Any failed page rejects the whole read (`filmsBatch.js:11-20`).
   - The response is `{ items: Gallery[], total }` (worker `index.ts:311-322`). Each item has the list fields only (`GALLERY_LIST_FIELDS`, `worker/store.ts:508-513`): `id, tenantId, kind, coupleName, studioName, date, venue, days, createdAt, expiresAt, hasCover, films, photoCount, linkedId, deletedAt, coverKey, hasThumb, views, guestViews, downloads, coverVersion, photosGen, eventId`. The worker adds:
     - `daysLeft`: calendar days in Israel until the closing day; 0 means it closes today (`worker/galleries.ts:385-388`).
     - `expired`: `Date.parse(expiresAt) <= now` (`:390-392`).
     - `thumb`: a relative URL on the films site. For a photo gallery with a `coverKey` it is `/api/photos/<id>/v<photosGen>/<coverKey>?s=m&pt=<thumbsToken>`, otherwise `''`. A gallery in the trash always gets `''` (`withThumbs`, `index.ts:338-356`).
     - No password, download code, print token or guests' id.
   - The list holds **both kinds**. The page filters by kind on the client.
   - Errors go to `setError(e.message)`, shown as `<p class="text-red-400 text-sm">` (`:348`).
4. `GalleriesSummary kind="photos"` fetches on its own (§5).
5. While `list === null` and there is no error, a centered `Loader2` spinner in brand colour (`:349-353`).

### 4.2 Page layout (top to bottom)
Container `min-h-screen bg-gray-950 p-4 md:p-8`, `dir="rtl"`, inner `max-w-7xl mx-auto space-y-5`.

1. **Header** (`:309-326`), `flex flex-wrap items-center justify-between gap-3`:
   - h1 `text-2xl font-bold text-white`: Images icon (brand-400) and `"גלריות תמונות"`.
   - Buttons:
     - `"ייבוא רשימה"`: outline, Upload icon; opens the BulkImport dialog (§4.11).
     - `"גלריה חדשה"`: brand fill (`bg-brand-400 text-brand-fg font-semibold`), Plus icon; a link to `/photos/new`.
2. **Face-off banner** (`:328-340`), only when `faceOff.length > 0` (§4.10). Amber box: `"זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש:"` then one underlined link per gallery (the couple name) and a `✕` close button (`aria-label="סגירה"`).
3. **Summary tiles**: `<GalleriesSummary kind="photos" refreshKey={list} onExtend={g => setExtending([g])}/>` (§5).
4. Error text and spinner.
5. **Toolbar**, only when `list.length > 0` (any kind) (`:355-389`):
   - Search input with a Search icon on the right; placeholder `"חיפוש לפי שמות, אולם או תאריך"`; `flex-1 min-w-[220px]`.
   - Filter chips (§4.4), each `"{label} {count}"` with the count at 70% opacity.
   - View toggle (`role="group"`, `aria-label="תצוגה"`): List icon (title `"טבלה"`) and LayoutGrid icon (title `"כרטיסים"`). The active one is `bg-brand-400/15 text-brand-300`.
6. **Empty states**:
   - `list.length === 0`: card `"עוד אין גלריות. צרו את הראשונה מהכפתור למעלה, או ייבאו רשימה שלמה."` (`:391-395`).
   - `list.length > 0 && shown.length === 0`: card `"אין גלריות שמתאימות לחיפוש."` (`:396-398`). This is also what a studio sees on `/photos` when it has only **film** galleries (§16 Q4).
7. **Cards view** (§4.6) or **table view** (§4.5).
8. **Bulk bar** (§4.9), fixed at the bottom, with an 80 px spacer.
9. Dialogs: ExtendDialog (§4.8) and BulkImport (§4.11).

### 4.3 Sorting, search and what is shown (`:189-197`)
`shown = [...list].sort(byEventDate).filter(kind).filter(matches(filter)).filter(search)`.
- **byEventDate** (`:59-66`): galleries whose `date` matches `^\d{4}-\d{2}-\d{2}$` come first, newest wedding date first; ties go to the newest `createdAt`. Galleries without a valid date come last, newest `createdAt` first.
- **Search**: `q = query.trim().toLowerCase()`. A gallery matches when `` `${coupleName} ${venue||""} ${formatDate(date)} ${date}`.toLowerCase().includes(q) ``. For example, `"2026-08-06"` is searchable as `"6.8.26"`, `"2026-08"` or `"08-06"`. Slashes (`6/8/26`) do **not** match.
- `formatDate(value)` (`:74-78`, exported): an ISO date becomes `"{d}.{m}.{yy}"` (no leading zeros, 2-digit year). Anything else is returned unchanged; empty becomes `""`.
- Changing the search does **not** clear the selection. Picked galleries hidden by the search simply drop out of `pickedList` (`:272`).

### 4.4 Filter chips (`FILTERS`, `:25-32`; rule `matches`, `:34-50`)
`isEmpty(g)`: for photos, `(g.photoCount || 0) === 0`. `photoCount` counts **visible** (non-hidden) photos, so a gallery whose photos are all hidden counts as empty.

| key | Label | Rule (on galleries of the current kind) |
|---|---|---|
| `all` | `"הכל"` | not in the trash |
| `nofilms` | `"ריקות"` | not in the trash and `isEmpty` |
| `open` | `"פתוחות"` | not in the trash, `!expired && daysLeft > 7` (empty galleries included) |
| `soon` | `"נסגרות בקרוב"` | not in the trash, `!expired && daysLeft <= 7` |
| `closed` | `"נסגרו"` | not in the trash, `expired` |
| `trash` | `"סל מחזור"` | `deletedAt` is set |

- The chip count is `list.filter(kind === current && matches(g, key)).length`. It ignores the search.
- The active chip is `border-brand-400 bg-brand-400/15 text-brand-300`; others `border-gray-700 text-gray-400`.
- `pickFilter` sets the filter, **clears the selection** and saves localStorage `films:filter` (shared with `/films`). The initial value comes from that key, or `all` if it is invalid (`:80-87, 179-187`).

### 4.5 Table view (default; `:444-546`)
Wrapper `rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto` (scrolls sideways on phones). `table w-full text-sm text-white`.

**Header row**:
1. A checkbox (`aria-label="בחירת כל הגלריות ברשימה"`, `data-testid="pick-all"`). It is checked when every shown gallery is picked. A click selects `shown.slice(0, 50)`, or clears everything when all are already picked (§16 Q6).
2. `"זוג"`, `"אולם"`, `"תאריך"`, `"מצב"`, `"תמונות"`, `"צפיות / הורדות"`, then an empty actions column.

**Month group rows** (`:470-482`): a row is inserted before each gallery whose `monthOf(date)` differs from the previous row's.
- `monthOf`: an ISO date becomes `"{Hebrew month} {yyyy}"` using `["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"]`. Anything else becomes `"ללא תאריך"`.
- The row shows `<bdi bold>{month}</bdi> · {inMonth === 1 ? "אירוע אחד" : "{n} אירועים"}`, where `inMonth` is the number of shown galleries in that month. Style: `bg-gray-950/60`, `text-xs text-gray-400`, `colSpan=8`.
- Month groups appear in the table only, not in cards.

**Gallery row** (`data-testid="gallery-row"`, hover `bg-gray-800/40`):
1. A checkbox (`aria-label="בחירת {coupleName}"`, `data-testid="pick"`).
2. **זוג** (`min-w-[220px]`): `Thumb` (96×68, rounded, `bg-gray-800` with a border, a link to the gallery with `tabIndex=-1`). It shows `FILMS_BASE_URL + g.thumb` lazily, or an Images icon placeholder (`:106-113`). Next to it, the couple name as a link to `/photos/{id}` (hover brand-400), and under it `studioName` in `text-xs text-gray-500`, only when the gallery has a studio-name override.
3. **אולם**: `venue` in gray.
4. **תאריך**: `formatDate(date)`.
5. **מצב**: `TrashState` if in the trash, else `State` (§13).
6. **תמונות**: `photoCount.toLocaleString("he-IL")`.
7. **צפיות / הורדות**: `{views}` plus, if `guestViews`, `" (+{guestViews} אורחים)"` in gray, then `" / {downloads}"`. A tooltip (when `guestViews`) reads `"הזוג: {views} · אורחים: {guestViews}"`.
8. **Actions** (`flex gap-1 justify-end whitespace-nowrap`):
   - In the trash: an outline button `"שחזור"` (RotateCcw, `data-testid="restore"`) runs `restore(g)` (§4.7). A red icon (title `"מחיקה לצמיתות"`, Trash2) runs `removeForever(g)`.
   - Not in the trash:
     - If empty: a brand button `"הוספת תמונות"`, a link to `/photos/{id}`.
     - Otherwise: a brand button with a Copy icon, `"קישור לזוג"`, which does `copyText(coupleLink(slug, id))` and toasts `"הקישור הועתק"`. Copy only; **no WhatsApp**.
     - Icon `"פתיחה כמו הזוג"` (ExternalLink): `openAsCouple(g)`.
     - Icon `"הארכה"` (Timer): `setExtending([g])`, which opens the ExtendDialog.
     - Icon link `"עריכה"` (Pencil) to `/photos/{id}`.
     - Red icon `"העברה לסל המחזור"` (Trash2): `remove(g)`.

### 4.6 Cards view (`:400-442`)
- Grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4` (`data-testid="gallery-cards"`).
- Card (`data-testid="gallery-card"`): the border is `border-brand-400` when picked, else `border-gray-800`.
  - Image area `aspect-[3/2]`: a link to the gallery (`aria-label="עריכת {coupleName}"`). It shows the thumb at `?s=md` (the `?s=m` in `g.thumb` is replaced) or the text `"ללא תמונות"`.
  - A checkbox at the top right (`aria-label="בחירת {coupleName}"`).
  - The name as a link (truncated).
  - A meta line: `"{photoCount he-IL} תמונות"` plus ` · {formatDate(date)}` and ` · {venue}` when present.
  - A footer with the state pill and either `"שחזור"` (in the trash) or two icons: `"העתקת הקישור לזוג"` (Copy; toast `"הקישור הועתק"`) and `"פתיחה כמו הזוג"`.
- Cards have **no** select-all, extend, edit or delete icons, and the trash card has **no** permanent delete. Those live only in the table or the bulk bar.
- The toggle is saved in localStorage `films:cards` (`"1"`/`"0"`), shared with `/films` (`:115-121, 142-149`).

### 4.7 Row actions (API)
| Action | Flow |
|---|---|
| **פתיחה כמו הזוג** `openAsCouple(g)` (`:289-303`) | 1. `window.open("", "_blank")` synchronously, so popups are not blocked. 2. `GET /api/admin/galleries/{id}` returns `{ ..., previewToken }`. 3. If there is no token, throw `"לא ניתן לפתוח את הגלריה כמו הזוג כרגע. נסו שוב."` 4. `tab.opener = null; tab.location.href = studioPreviewLink(slug, id, previewToken)`. If the tab is null, `window.open(href, "_blank", "noopener,noreferrer")`. On error, close the tab and toast `e.message`. The preview token lets the films site open the gallery as the studio (no password or code, no couple view counted, no terms acceptance). The list's own thumbs token does not open a gallery. Side effect: the GET also creates the guests' id for a photo gallery that has none (worker `index.ts:396`). |
| **קישור לזוג** | Clipboard only (above). |
| **remove (to the trash)** (`:203-218`) | `confirmDialog("להעביר את הגלריה של {coupleName} לסל המחזור? הקישור יפסיק לעבוד מיד. אפשר לשחזר עד 30 יום, ואחר כך היא נמחקת לגמרי. הקבצים בענן לא נמחקים.")`. If yes, `DELETE /api/admin/galleries/{id}`. If it fails with `e.code === "album_submitted"` (409; message `"הזוג כבר שלח את האלבום שעיצב בגלריה הזו. בסל המחזור הקישור יפסיק לעבוד ואחרי 30 יום העיצוב יימחק. לאשר?"`), a second `confirmDialog(e.message)`; if yes, `DELETE /api/admin/galleries/{id}?force=1`. On success, toast `"הגלריה הועברה לסל המחזור"` and `load()`. Other errors toast `e.message`, for example the 409 `album_order` `"לגלריה יש הזמנת אלבום פתוחה. אי אפשר להעביר אותה לסל המחזור או למחוק אותה עד שההזמנה נמסרה או הושלמה."` Answering "no" to the second question does nothing and shows no toast. |
| **restore** (`:220-229`) | `POST /api/admin/galleries/{id}/restore` returns the gallery plus `faceSearchOff?: true`. Toast `"הגלריה שוחזרה"`. If `faceSearchOff`, show the face-off banner for this gallery. Then `load()`. |
| **removeForever** (`:231-240`) | `confirmDialog("למחוק לצמיתות את הגלריה של {coupleName}? אי אפשר לבטל. הקבצים בענן לא נמחקים.")`, a red dialog with a `"מחק"` button (§4.12). Then `DELETE /api/admin/galleries/{id}?forever=1`. The worker purges only if the gallery is already in the trash; otherwise `forever` is ignored and it is trashed (`index.ts:435`). Toast `"הגלריה נמחקה לצמיתות"`. A 409 `album_paid` `"לגלריה יש הזמנת אלבום ששולמה או בהדפסה, ולכן העיצוב נשמר ואי אפשר למחוק אותה לצמיתות."` or `album_order` is shown as an error toast. |
| **extend** | Opens the ExtendDialog with `[g]` (§4.8). |

### 4.8 ExtendDialog (`:649-694`, handler `:606-626`)
- A modal (`max-w-md`, `data-testid="extend-dialog"`).
  - Title: one gallery `"הארכת הגלריה של {coupleName}"`; several `"הארכת {n} גלריות"`.
  - Text: `"הימים נוספים מהיום, או מסוף התקופה אם הגלריה עוד פתוחה. גלריה שנסגרה נפתחת שוב."`
  - Preset chips `7, 14, 30, 90` labelled `"{d} ימים"`; the active one in brand.
  - A number input (`min=1 max=3650`, `w-32`, `data-testid="extend-days"`). The default value is **"30"**, not the studio default.
- Validation: `n = Math.floor(Number(days))`; valid when finite and `1 <= n <= 3650`.
- Buttons: `"ביטול"` (ghost) and the brand button `"הארכה ב-{n} ימים"`. When invalid it reads `"הארכה ב-… ימים"` and is disabled; while busy it shows a spinner.
- **One gallery**: `POST /api/admin/galleries/{id}/extend` with `{ days: n, expiresAt: <the closing time this screen showed> }`.
  - The worker extends only while the saved `expiresAt` still equals the one sent; otherwise 409 `"תאריך הסגירה של הגלריה השתנה בינתיים. רעננו את הדף ונסו שוב."`, so a double click never extends twice.
  - In the trash: 400 `"הגלריה בסל המחזור. שחזרו אותה קודם."`
  - Response: the gallery plus `faceSearchOff?`. Toast `"הגלריה הוארכה"` and the face-off banner if needed; errors toast. Always `load()`, then close the dialog.
- **Several**: `batch("extend", galleries, { days: n, seen: { [id]: expiresAt } })` (§4.9).
- Server formula (worker `galleries.ts:289-293`, SQL `films_galleries_extend`): `from = max(now, expiresAt)`; `newExpires = endOfIsraelDay(min(from + days·24h, createdAt + 3650 days))`; `days = round((newExpires − createdAt)/24h)`. A closed gallery therefore reopens counting from today.
- It is also opened from the summary's `"הארכה"` link with a summary brief `{id, coupleName, expiresAt, …}`.

### 4.9 Selection and bulk bar (`:249-283, 549-604`; `lib/filmsBatch.js`)
- `picked` is a Set of ids. `pickedList = shown.filter(g => picked.has(g.id))`.
- The bar appears when `pickedList.length > 0`: `fixed bottom-0 inset-x-0 z-40 border-t bg-gray-950/95 backdrop-blur p-3` (`data-testid="bulk-bar"`), with an 80 px spacer above it. Contents:
  - `<b>"נבחרו {n}"</b>`
  - **In the trash filter**:
    - `"שחזור"` (brand): `batch("restore")`, with no confirm.
    - `"מחיקה לצמיתות"` (red outline): `confirmDialog("למחוק לצמיתות {n} גלריות? אי אפשר לבטל.")`, then `batch("purge")`.
  - **Otherwise**:
    - `"הארכה"` (brand): opens the ExtendDialog with `pickedList`.
    - `"העתקת הקישורים"`: copies the lines `"{coupleName}: {coupleLink}"` joined by `\n`, then toasts `"{n} קישורים הועתקו, עם השמות"`.
    - `"סגירה עכשיו"`: `confirmDialog("לסגור עכשיו {n} גלריות? הזוגות לא יוכלו לצפות עד שתאריכו.")`, then `batch("close")`.
    - `"העברה לסל"` (red outline): `confirmDialog("להעביר {n} גלריות לסל המחזור? הקישורים יפסיקו לעבוד מיד. אפשר לשחזר עד 30 יום.")`, then `batch("trash")`.
  - `"ביטול הבחירה"` (ghost, pushed to the far left): clears the selection.
- **`batch(action, galleries, extra)`** (`:246-271`):
  1. `runBatch(send, action, ids, extra)` where `send = body => POST /api/admin/galleries/batch body`.
     - Body: `{ action: "extend"|"close"|"trash"|"restore"|"purge", ids: string[], ...extra }`, where extra may be `days`, `seen` or `force`.
     - The worker answers `{ ok, done: number, doneIds: string[], skipped: {id, reason}[], remaining: string[], faceSearchOff?: string[] }`.
     - `runBatch` (`filmsBatch.js:30-53`) re-sends `remaining` until it is empty (photo galleries whose face data is deleted at most 6 per request). It stops at 12 rounds, or when a round moved nothing (`remaining.length >= todo.length && done == 0`); everything left is then skipped with reason `changed`. It sums `done`, `doneIds`, `skipped` and `faceSearchOff`.
  2. **Trash only**: ids skipped with reason `album_submitted` are pulled out. The names are listed (the first 3 joined by `", "`, then `" ועוד {k}"`) in `confirmDialog("{ask.length === 1 ? "בגלריה אחת" : "ב-{k} גלריות"} ({names}) הזוג כבר שלח אלבום שעיצב. בסל המחזור הקישור יפסיק לעבוד ואחרי 30 יום העיצוב יימחק. להעביר גם אותן?")`. Yes runs `runBatch` again for those ids with `force: true` and merges the results. No puts them back in `skipped` with reason `album_submitted`.
  3. `batchMessages(result, action, namesById)` (`filmsBatch.js:85-98`):
     - success: `done === 1` gives `"גלריה אחת {DONE_ONE}"`; `done > 1` gives `"{n} גלריות {DONE_WORDS}"`; otherwise nothing.
       - DONE_ONE: extend `הוארכה`, close `נסגרה`, trash `הועברה לסל המחזור`, restore `שוחזרה`, purge `נמחקה לצמיתות`.
       - DONE_WORDS: `הוארכו`, `נסגרו`, `הועברו לסל המחזור`, `שוחזרו`, `נמחקו לצמיתות`.
     - warning: one line per reason, `"{1 ? "גלריה אחת דולגה" : "{n} גלריות דולגו"} ({first 3 names}[ ועוד k]): {REASON}"`, joined by `\n`. Ids without a known name are shown as the raw id.
     - REASONS (`filmsBatch.js:58-69`):
       - `not_found`: `"לא נמצאו (אולי נמחקו בינתיים)"`
       - `module`: `"שייכות למודול שאינו כלול במנוי"`
       - `in_trash`: `"נמצאות בסל המחזור"`
       - `not_in_trash`: `"כבר לא בסל המחזור"`
       - `changed`: `"השתנו בינתיים (למשל תאריך הסגירה). רעננו את הדף ונסו שוב"`
       - `faces_failed`: `"נתוני זיהוי הפנים שלהן לא נמחקו, ולכן הן לא טופלו. נסו שוב בעוד רגע"`
       - `album_submitted`: `"הזוג כבר שלח אלבום שעיצב בהן. צריך לאשר במפורש"`
       - `album_order`: `"יש להן הזמנת אלבום פתוחה. אפשר רק אחרי שההזמנה נמסרה או הושלמה"`
       - `album_paid`: `"יש להן הזמנת אלבום ששולמה או בהדפסה, ולכן לא נמחקות לצמיתות"`
       - unknown: `"לא טופלו"`
  4. `toast.success(success)` and `toast.warning(warning, { duration: 10000 })`. Galleries in `faceSearchOff` go to the face-off banner. Clear the selection and `load()`. On an exception, `toast.error(e.message)` and `load()`.
- Server limits:
  - At most 50 ids per request (400 `"עד 50 גלריות בכל פעם"`). The hub sends all picked ids in one request, so picking more than 50 one by one fails (§16 Q6).
  - Unknown action: 400 `"פעולה לא מוכרת"`. Empty: `"לא נבחרו גלריות"`.
  - `close` sets `expiresAt = now` and keeps `days >= 1` (`galleries.ts:301-309`).
  - `trash` sets `deletedAt = now` and deletes the face data first.
  - `purge` removes the row and unlinks its partner. Only allowed from the trash.

### 4.10 Face-off notice
`faceOff: {id, coupleName}[]` is filled when restore or extend (single or batch) reports `faceSearchOff`. The links use `galleryPath({id, coupleName})`; without `kind` this yields `/films/{id}`, and the form then redirects to `/photos/{id}` (confirmed in `e2e/films.spec.js:446`). The notice stays until `✕` is pressed or the page reloads.

### 4.11 BulkImport dialog ("ייבוא רשימה"; `:720-802`)
- Modal `max-w-2xl`. Title `"ייבוא רשימת אירועים (גלריות תמונות)"`.
- Text: `"שורה לכל אירוע: "` + **`"שמות הזוג, תאריך, אולם"`** + `". התאריך יכול להיות עם / או עם נקודות. האולם לא חובה. לכל שורה תיווצר גלריה, ואחר כך מוסיפים לכל אחת את "` + `"התמונות"` + `"."`
- A textarea (`min-h-[140px]`, autofocus) whose placeholder is three lines:
  ```
  הדר ואלירז 6/8/26 הופה
  מאיה וקובי 30/6/26 חוות אלבני
  נועה ואיתי 28/6/26 גן הפקאן
  ```
- **Parsing** (`parseEventList` / `parseEventLine`, `apps/films-worker/shared/event.ts`):
  - Lines are split on `\r?\n`, trimmed and empties dropped. Exact repeats (whitespace collapsed) are dropped.
  - Each line looks for a date: first `yyyy[./-]m[./-]d` (`ISO_RE`), then `d[./-]m[./-](yyyy|yy)` (`DMY_RE`). The date must not be part of a longer number. A 2-digit year means 20yy. The date must be a real day with a year between 2000 and 2100, otherwise `date = ''`. The text around it is still split.
  - No date: the whole line (tidied) is the couple name; date and venue are empty.
  - Text before the date: that is the couple, and the text after the date is the venue.
  - Date first: the text after it is split on ` - `, ` – `, ` — `, ` | ` or `|`. The first part is the couple and the rest (joined by `" - "`) is the venue.
  - `tidy` trims ` -–—|,.:` and spaces from both ends and collapses whitespace.
- **"&" suggestion**: `withAmpersand` (`shared/names.ts`) turns `"X וY"` into `"X & Y"`.
  - It splits before the last word that starts with `ו` (not the first word, longer than 1 character, and not a family name in `VAV_SURNAMES` such as `וייס`, `וקנין`, …). A separate `" ו "` is handled too. A name that already has `&` is left alone.
  - The checkbox shows only if some name would change. Label: `"להציג את שמות הזוג עם & (למשל "נועה & איתי" במקום "נועה ואיתי")"`. Default **checked** (`data-testid="bulk-amp"`).
- **Preview table** (when there are rows; `max-h-64` scroll): `"זוג"` / `"תאריך"` / `"אולם"`.
  - A missing name is shown in red as `"חסרים שמות"`.
  - A missing date is gray `"בלי תאריך"`; a date is shown as `formatDate`.
  - A missing venue is gray `"—"`.
- Errors: red `{error}`. Warning: amber `"יש {bad} שורות בלי שמות זוג. תקנו או מחקו אותן כדי להמשיך."`
- Buttons: `"ביטול"` and the brand `"יצירת {rows.length} גלריות"`, disabled while busy, with no rows, or with `bad > 0`.
- **API**: `POST /api/admin/galleries/bulk` with `{ items: [{coupleName, date, venue}], kind: "photos" }`. It returns an array of created galleries.
  - Server: `"הרשימה ריקה"`; more than 100 gives `"עד 100 אירועים בכל ייבוא"`; a line without a name gives `"בשורה {i} חסרים שמות הזוג"`; other per-line errors are prefixed `"בשורה {i}: "`.
  - All lines are built first, then saved in **one** write: all or nothing.
  - Each gallery gets the studio's `defaultDays` and closes at the end of the Israel day that many days after creation.
- Success: toast `"נוצרו {n} גלריות"`, close the dialog, switch the filter to **`ריקות`** (`nofilms`), and `load()`.

### 4.12 Confirm dialog conventions (`lib/confirmDialog.js`)
- Every question uses the in-app `confirmDialog` (never `window.confirm` unless no host is mounted).
- A plain string is split into a title (up to the first newline, or the first `?` followed by text) and a message.
- The dialog is red with a `"מחק"` button when the title or message contains `למחוק`, `מחיקה` or `לצמיתות` and the title asks to delete. Otherwise the buttons are `"אישור"` and `"ביטול"`.
- Enter confirms; Escape or a click outside cancels. A second question answers the first with "no".

---

## 5. GalleriesSummary (`components/films/GalleriesSummary.jsx`)

### 5.1 Data
- `GET /api/admin/dashboard?kind=photos` on `/photos`; no parameter on the dashboard, which means every kind the studio has. Response headers carry `Cache-Control: no-store`.
- It re-fetches whenever `refreshKey` (the list) or `kind` changes (`:42-47`). On error it renders **nothing** (`setD(null)`, then `return null`).
- Response `GalleriesSummary` (`worker/store.ts:495-502`, SQL `films_dashboard` in migration `0133_films_batch_extend_dashboard.sql`):
  ```
  { open: number, closed: number, trash: number,
    closing: GalleryBrief[], mostViewed: GalleryBrief[],
    albumsSent: { galleryId, coupleName, submittedAt }[] }
  GalleryBrief = { id, coupleName, kind, date, daysLeft, views, downloads, expiresAt }
  ```
- With the CRM module, `supabase.from("album_orders").select("total_amount, payment_status, workflow_status, paid_at")` runs separately (RLS scopes it to the studio; no pagination, so PostgREST's row cap applies) (`:49-55`).

### 5.2 Formulas (server; `worker/dashboard.ts:33-69` mirrors the SQL)
`mine` = the studio's galleries of the allowed kinds that are **not** in the trash.
- `open` = count of `mine` with `expires_at > now`, including empty galleries.
- `closed` = `|mine| − open`.
- `trash` = count of the allowed kinds with `deleted_at` set.
- `closing` = open galleries with `daysLeft <= 7`, ordered by `expires_at` ascending (ties: newest `created_at`, then id), **at most 12**. `daysLeft` = Israel calendar date of `expires_at` minus Israel today, at least 0.
- `mostViewed` = open galleries with `views > 0`, ordered by `views` descending (ties: newest), **at most 5**. `views` counts the couple's views only.
- `albumsSent` = only when photos is allowed: `films_albums` with `status='submitted'` joined to `mine` (any open or closed gallery not in the trash), ordered by `submitted_at desc nulls last, gallery_id`, **at most 10**.
- Album money (client, `orderMoney`, `:21-27`):
  - `waiting` = orders where `payment_status !== 'paid'` and (`workflow_status === 'awaiting_payment'` or `payment_status === 'transfer_pending_review'`). Shows a count and the sum of `Number(total_amount) || 0`.
  - `paid this month` = orders with `payment_status === 'paid'`, `paid_at` set, and `israelMonth(paid_at) === israelMonth(now)`. Shows the sum.
  - `israelMonth` = `"YYYY-MM"` in `Asia/Jerusalem` (`:16-18`).
  - Money is formatted with `formatILS` as whole shekels `"₪1,234"` (`lib/money.js:47-51`).
  - These order numbers are studio-wide (all album orders), not limited to the kind or to gallery-born orders.

### 5.3 Tiles on `/photos` (not compact)
Grid `grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (`data-testid="galleries-summary"`). Each tile is `dash-card p-4 space-y-2 min-w-0`; the theme turns `.dash-card` into a glowing navy card.

1. **`"גלריות פתוחות"`**: a big number `{open}` (`text-3xl font-bold`, `data-testid="sum-open"`). Under it `"{closed} נסגרו"`, plus `" · {trash} בסל המחזור"` when trash > 0.
   - With CRM (`data-testid="sum-orders"`, a top border):
     - A link to `/AlbumOrders`: `"ממתינות לתשלום: "` + **amber** `{waiting.count}` + gray `" ({₪waiting.total})"` when the total > 0.
     - `"התקבל החודש מאלבומים: "` + **green** `{₪paid.total}`, always shown (₪0 too).
2. **`"נסגרות השבוע"`** (`data-testid="sum-closing"`):
   - Empty: `"אין גלריות שנסגרות בשבוע הקרוב."`
   - Otherwise the first **6** (**4** compact) briefs: the couple name (a link to `/photos/{id}`, truncated), then amber `"היום"` when `daysLeft === 0` or `"עוד {daysLeft} ימים"` (also "עוד 1 ימים"; never "מחר"), then a sky-blue `"הארכה"` link button (`data-testid="sum-extend"`) when `onExtend` is passed, which opens the ExtendDialog.
3. **`"אלבומים שהזוגות שלחו"`** (`data-testid="sum-albums"`): shown when `kind !== "films"` and (`hasModule("photos")` or there are sent albums).
   - Empty: `"עוד לא נשלחו אלבומים."`
   - Otherwise the first 6 (4 compact): the couple name (a link to `/photos/{galleryId}`) and the gray date `formatDateShort(submittedAt)` (`"d/m/yyyy"` in Israel time).
4. **`"הכי נצפות"`** (`data-testid="sum-viewed"`), not on the compact dashboard:
   - Empty: `"עוד אין צפיות."`
   - Otherwise up to 5: the name (a link) and `"{views he-IL} צפיות"`.

### 5.4 The dashboard variant (`compact embed`)
- `embed`: the tiles are placed directly into the dashboard row grid (`display: contents`). Each tile gets `e-scroll overflow-y-auto sm:h-[245px]`.
- No `"הכי נצפות"`. Lists are trimmed to 4. There is no `"הארכה"` link (no `onExtend`).
- Both kinds are combined, so on the dashboard "נסגרות השבוע" and "גלריות פתוחות" include films.

---

## 6. Screen B: create and edit a gallery `/photos/new`, `/photos/:id` (`FilmsGalleryForm.jsx`)

### 6.1 Load sequence (`:191-232`)
1. `GET /api/admin/settings`. If new, `days = s.defaultDays`. Always `songs = { list: s.music || [], defaultId: s.musicDefault || "" }`. Errors are ignored.
2. If editing, `GET /api/admin/galleries/{id}`. The response (worker `index.ts:392-404`) is `adminGallery(g)`: every gallery field, plus `daysLeft`, `expired`, `hasPassword`, `hasDownloadPin` (password and downloadPin only for owner and admin), `films` (empty for photos), `terms: {count, first, last, guests, unknown}` and `previewToken` (12-hour studio pass). Photo galleries also get a `guestId`, created on first open while the studio's access is `ok`. It fills `coupleName`, `studioName`, `venue`, `date` (or today), `days`, `folderUrl`, `kind`, `music`, `eventId`, `password` and `downloadPin`. With an `eventId`, the event label is read from Supabase: `events.select("id, couple_names, date").eq("id", eventId)`, giving `"{couple_names} · {d/m/yyyy}"`.
3. If editing, `GET /api/admin/galleries/options` (an array of `{id, kind, coupleName, date, deletedAt?}` for every gallery) feeds the LinkPicker.
4. Until loaded: a full-screen spinner, or the red error text when `GET` failed (for example 404 `"הגלריה לא נמצאה"`) (`:362-368`).

### 6.2 Layout
`min-h-screen bg-gray-950 p-4 md:p-8`, a `<form>` `max-w-4xl mx-auto space-y-5`. Sections are `rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4` with an h2 `text-lg font-semibold`. Fields have a label (`text-gray-300`), the input, and an optional hint (`text-xs text-gray-500`). Inputs are `bg-gray-800 border-gray-700 text-white`.

1. **Header** (`:378-394`):
   - h1: new gives `"גלריית תמונות חדשה"`; edit gives `{coupleName}` (live) or `"עריכת גלריה"`.
   - Edit only:
     - `"העתקת קישור לזוג"` (brand, Copy icon): `copyText(coupleLink)`, toast `"הקישור הועתק"`.
     - `"פתיחה כמו הזוג"` (outline, ExternalLink): a plain `<a target=_blank>` to `studioPreviewLink(slug, id, previewToken)` (the token read at page load; `data-testid="open-as-couple"`).
2. **Link box** (edit only): `rounded-lg border bg-gray-900 px-4 py-2 text-sm`, `dir="ltr"`, holding the couple link as text (`:396-400`).
3. **Terms line** (edit only, `data-testid="terms-accepted"`, `:401-410`):
   - `count > 0`: `"הזוג אישר את התנאים ב-{formatDateTime(first)}"`, plus when `count > 1` `" ({count} אישורים, האחרון ב-{formatDateTime(last)})"`. Otherwise `"הזוג עוד לא אישר את התנאים."`
   - Then `" אורחים אישרו {guests} פעמים."` if guests > 0, and `" {unknown} אישורים ישנים בלי פירוט מי אישר."` if unknown > 0.
   - `formatDateTime` gives `"d/m/yyyy HH:MM"` in Israel time.
4. **Section `"פרטי הזוג"`**, grid 1 column, 2 columns from `md` (§6.3).
5. **Section `"התמונות"`** (new only, §6.3).
6. **Section `"גישה"`** (§6.5).
7. **Section `"שיר למצגת"`** (only when the studio has songs, §6.7).
8. **Section `"הסרטים של הזוג"`** (edit only, LinkPicker, §6.8).
9. Red `{error}`.
10. The submit row: the brand button `"יצירת הגלריה"` (new) or `"שמירת שינויים"`, with a spinner while saving. If `gallery.expired`, amber text `"הגלריה סגורה. כדי לפתוח מחדש, הגדילו את ימי הגישה או השתמשו ב"הארכה" ברשימה."`
11. **After the `<form>`** (edit + photos): `<PhotosEditor/>` (`max-w-4xl`, §7), then `<DesignEditor/>` (`max-w-6xl`, §8).

### 6.3 Fields
| Field | Label (exact) | Type and limits | Default | Validation | Sent as |
|---|---|---|---|---|---|
| Couple names | `"שמות הזוג (כפי שיופיע על השער)"` | text, `required`, placeholder `"נועה & תומר"` | `""` / saved | HTML required. Server: whitespace collapsed and trimmed; empty gives `"צריך למלא את שם הזוג"`. Stored as typed | `coupleName` |
| "&" suggestion | `"להציג כ־{ampSuggestion}? כן · להשאיר כך"` (`data-testid` `amp-suggestion`, `amp-accept`, `amp-decline`) | inline text | n/a | Shown when `withAmpersand(name) !== name` (normalized) and the name is not the one declined. `"כן"` replaces the name; `"להשאיר כך"` remembers the declined text (it is offered again if the name changes) | not sent |
| Venue | `"אולם / מקום (מוצג מתחת לתאריך)"` | text, placeholder `"חוות אלבני"` | `""` | Trimmed; empty becomes none | `venue` |
| Wedding date | `"תאריך החתונה"` | `type="date"` | **new: Israel today** (`israelToday()`); edit: saved date or today | Server: `""` or a real `yyyy-mm-dd`, otherwise `"תאריך החתונה לא תקין"`. An old free-text date sent back unchanged stays | `date` |
| Access days | `"ימי גישה"` | number, min 1, max 3650 (`data-testid="gallery-days"`) | settings `defaultDays` (30 until settings load) | Hint: new `"נספר מרגע היצירה"`; edit `"נסגרת ב־{formatDateShort(expiresAt)}"`. Server: integer 1–3650, otherwise `"מספר הימים לא תקין: לפחות יום אחד"`. Sent **only** for a new gallery or once the field was edited (`daysTouched`) | `days` |
| Studio name override | `"שם סטודיו אחר לזוג הזה (לא חובה)"` | text, placeholder `{defaultStudio}` | `""` | Hint `"ריק = שם הסטודיו מפרטי הסטודיו ({defaultStudio})."`, where `defaultStudio = tenant.display_name_to_clients \|\| tenant.name`. The server stores it only if it is non-empty and differs from the studio name | `studioName` |
| Event | `"האירוע של הזוג (לא חובה)"` | EventPicker (§6.4), **CRM studios only** | saved `eventId` | Hint `"כשהזוג שולח אלבום שעיצב, הוא מצטרף להזמנת האלבום הפתוחה של האירוע, בלי הזמנה שנייה."`. The server checks the event belongs to the studio, otherwise 400 `"האירוע לא נמצא"` | `eventId` (only when changed, `eventTouched`; `""` unlinks) |
| Photo folder (new only) | `"קישור לתיקייה עם התמונות: דרופבוקס, גוגל דרייב או pCloud (אפשר גם אחרי היצירה)"` | text, `dir=ltr`, placeholder `"https://www.dropbox.com/scl/fo/…"` (`data-testid="new-photo-folder"`) | `""` | Hint `'תיקיות בשם של סט ("02 התארגנות") ממלאות את הסט הזה. MyAirBridge נתמך רק לסרטים.'`. No client validation | used after creation (§6.6) |
| Password | `"סיסמה לגלריה (לא חובה)"` | text, `maxLength=40`, `autoComplete=off` (`data-testid="gallery-password-field"`) | saved | Hint `"מי שנכנס צריך להקליד אותה. סיסמה חדשה מנתקת את כל מי שכבר נכנס."`. Server: trimmed and cut to 40; empty removes it | `password` (owner/admin only) |
| Download code | `"קוד הורדה (לא חובה, לפחות 6 תווים)"` | text, `maxLength=40` (`data-testid="download-pin-field"`) | saved | Hint `"צפייה פתוחה, והקוד נדרש להורדה באיכות מלאה. בסרטים הקוד מסתיר את כפתור ההורדה בלבד (סרט בכמה גדלים מתנגן בלי הקוד רק בגודל הקטן). למשל: עד שהזוג משלם."`. Server: a **new** code needs at least 6 characters, otherwise `"קוד ההורדה צריך לפחות 6 תווים"`; an older short code is kept | `downloadPin` (owner/admin only) |
| Song | §6.7 | select | `""` | The server checks the track exists, otherwise `"השיר לא נמצא"` | `music` (photos, always) |

For studio_manager, instead of the two secret fields (`data-testid="gallery-secrets-hidden"`), one line: `{hasPassword ? "לגלריה יש סיסמה." : "לגלריה אין סיסמה."} {hasDownloadPin ? "יש קוד הורדה." : "אין קוד הורדה."} רק הבעלים או מנהל מערכת רואים ומשנים סיסמה וקוד הורדה.`

### 6.4 EventPicker (CRM studios; `:63-124`)
- **Linked**: the label (`"{couple_names} · {d/m/yyyy}"`, or `"אירוע מקושר"` before it loads) and a button `"ביטול הקישור"`, which sets the id and label to `""`.
- **Not linked**: an input with placeholder `"חיפוש לפי שם הזוג"`.
  - The search is debounced 250 ms and cleaned: `%`, `*` and `\` become `_`; whitespace collapsed; trimmed; at most 60 characters.
  - Then `supabase.from("events").select("id, couple_names, date").ilike("couple_names", "%{q}%").order("date", {ascending:false}).limit(10)`.
  - Results are a scrollable list (`max-h-40`) of buttons `"{couple_names} · {d/m/yyyy}"`. Clicking one links it and clears the search.
- There is **no** prefill from an event: picking one does not fill names, date, venue or phone. It only links `eventId`. The hub has no "create gallery from lead/event" button (the album sketch editor does this behind the scenes, §3.5).

### 6.5 Section "גישה" and the guests' link (`:559-605`)
- The password and code fields (or the manager text) in a 2-column grid.
- **Guests' link block** (`data-testid="guest-link"`), when the gallery has `guestId` (photo galleries always get one on the first admin GET):
  - Label `"הקישור לאורחים (צפייה והורדה בלבד, בלי הלבבות והבחירות של הזוג)"`.
  - A box (`dir=ltr`) with `coupleLink(slug, guestId)`.
  - `"העתקה"` (Copy icon): clipboard, toast `"הקישור לאורחים הועתק"`.
  - `"שליחה בוואטסאפ"`: `<a href="https://wa.me/?text={encodeURIComponent("התמונות מהחתונה של {coupleName}: {guestLink}")}" target=_blank>`. No phone number; the user picks the chat in WhatsApp. This is the **only** WhatsApp template on the gallery page (besides the face-search link, §9.2).
  - Note `"הזוג רואה גם כפתור "שתפו עם האורחים" בגלריה שלו. הסיסמה, אם יש, חלה גם על הקישור הזה."`
  - A red outline button `"קישור חדש לאורחים"` (`data-testid="rotate-guest"`):
    - `confirmDialog("להחליף את הקישור לאורחים?\n\nהקישור הנוכחי יפסיק לעבוד מיד, גם אצל מי שכבר קיבל אותו. הקישור של הזוג לא משתנה. את הקישור החדש צריך לשלוח שוב למי שצריך.")`.
    - Then `POST /api/admin/galleries/{id}/rotate-guest`, which returns `{ guestId, gallery }`, and the state is updated. Toast `"נוצר קישור חדש לאורחים"`.
    - 409 `"הגלריה השתנתה בינתיים. טענו את הדף מחדש ונסו שוב."` shows as red text.
  - Next to it: `"אם הקישור לאורחים הגיע למי שלא צריך: הקישור הישן יפסיק לעבוד מיד. אפשר להוסיף גם סיסמה לגלריה."`

### 6.6 Save (`:310-360`)
1. Build the body:
   ```
   details = { coupleName, studioName, date, venue,
               ...(isNew || daysTouched ? { days } : {}),
               ...(seesSecrets ? { password, downloadPin } : {}),
               ...(canEvents && eventTouched ? { eventId } : {}) }
   body (photos) = { ...details, music }      // no folderUrl, no films, no cover
   ```
2. New: `POST /api/admin/galleries` with `{ ...body, kind: "photos" }`. Edit: `PUT /api/admin/galleries/{id}` with `body`. Both return `adminGallery`. The PUT has no `terms` or `previewToken`; the form keeps the previous ones.
   - On PUT the worker writes only the fields that changed (`galleryChanges`).
   - **Days move the closing time only when the number changed**: `expiresAt = endOfIsraelDay(israelDay(createdAt) + days)`, counted from **creation**, not from today. A form saved after a list "close" or "extend" therefore does not reopen or shorten the gallery unless the days field was edited.
   - A gallery keeps its kind; `kind` is ignored on PUT.
3. New, photos, with the folder field filled: `POST /api/admin/galleries/{id}/photos/load` with `{ url: photoFolder }` (§7.3). Success toasts `"נטענו {n he-IL} תמונות"`; a failure toasts `e.message`, but the gallery is still created.
4. (A cover upload exists only in films mode.)
5. Toast `"הגלריה נוצרה"` and `navigate("/photos/{id}", {replace:true})`. Edit: toast `"נשמר"`.
6. Errors go to the red text. `created.current` keeps a new gallery's id so a second press updates it instead of creating another (relevant to the films cover failure).

### 6.7 Section "שיר למצגת" (`:607-619`)
Shown only when `kind === "photos" && songs.list.length > 0`. A select (`w-full md:w-96`, `data-testid="gallery-music"`):
- `""` gives `"ברירת המחדל של הסטודיו ({default song name | "ללא"})"`
- each track gives `{track.name}`, with value `track.id`
- `"none"` gives `"מצגת בלי שיר"`

The value is saved with the form (no auto-save).

### 6.8 LinkPicker: "הסרטים של הזוג" (`:650-689`)
- Text `"אם יש לזוג גם גלריית סרטים, קשרו אותה: בגלריית התמונות יופיע כפתור לסרטים."`
- A select (`data-testid="link-picker"`): `"בלי קישור"` plus every **film** gallery from `/options` that is not in the trash (or is the one linked now), labelled `"{coupleName} · {date}"`. The date is the raw ISO string, not formatted.
- Changing it **saves at once**: `PUT /api/admin/galleries/{id}/link` with `{ linkedId }` (`""` unlinks). It returns `{ ok, linkedId }`. Toast `"הגלריות קושרו"` or `"הקישור בוטל"`.
- Server: links both directions and unlinks old partners. Same kind gives 400 `"אפשר לקשר רק גלריית סרטים עם גלריית תמונות"`.

---

## 7. PhotosEditor (`components/films/PhotosEditor.jsx`), under the form when editing

Props: `galleryId`, `initialFolder = gallery.folderUrl`, `coupleName` (live from the form), `coupleUrl = coupleLink`, `guestUrl`.

### 7.1 Data and saving
- On mount, `GET /api/admin/galleries/{id}/photos` (`:94-98`). It returns `null` (never loaded) or `PhotoData + { favorites: string[], favBy: {key: string[]}, insta: string[], previewToken }`.
  - `PhotoData` (`worker/types.ts:279-306`): `{ folderUrl, provider: 'dropbox'|'dropbox-link'|'gdrive'|'pcloud'|'mock', pathRoot?, timeOrder?, timesV?, coverPos?, gen?, sets: {id,name}[], items: PhotoItem[], cover?, faceSearch?, design? }`.
  - `PhotoItem`: `{ key, name, ref, set?, ar?, hidden?, folder?, t?, size?, label?, v? }`.
  - Hearts and Instagram marks include hidden photos for the studio.
- Also `GET /api/admin/settings`, which gives `labelsOn = labelSetsOn` and `labelMap`.
- **Save queue** (`:110-125`): every edit calls `save(patch)`, which `PUT /api/admin/galleries/{id}/photos` with a patch, **one at a time, in order**. The response (the full photo data again) replaces the state. `response.warning` is shown as the amber warning; errors go to the red text and resolve as `null`.
- PUT patch shapes the hub sends:
  - `{ items: { [key]: { set?, hidden?, ar?, t?, label? } } }`
  - `{ sets: [{id, name}] }`
  - `{ cover: key }`
  - `{ coverPos: {x, y} }`
  - `{ timeOrder: bool }`
  - `{ timesV: 2 }`
  - `{ faceSearch: bool }`
  - `{ design: {...} | null }`
- Server rules (`worker/photos.ts:555-619`):
  - Sets: at most 40, each id and name cut to 40 characters, empty names dropped. Photos in a removed set lose it.
  - `set` must exist, otherwise it is cleared.
  - `hidden` is a boolean.
  - `ar` is kept only if `0.2 < ar < 5` (rounded to 3 decimals).
  - `t` is ms between 1990 and 2100; `null` deletes it.
  - `label` is at most 30 characters.
  - After item edits the list is re-sorted (`sortByTime`).
  - `cover` must be an existing key.
  - Keys shared by two photos are refused (`ambiguous` plus warning `"חלק מהתמונות חולקות קוד אחד עם תמונה אחרת, ולכן השינוי לא נשמר עליהן. טענו את התיקייה מחדש כדי להפריד ביניהן."`).
  - Before any folder load: 400 `"קודם טען את התמונות מהתיקייה"`.

### 7.2 Empty state (no data yet; `:312-321`)
A card with h2 `"התמונות"`, the text `"קישור לתיקייה עם התמונות: דרופבוקס, גוגל דרייב או pCloud. תיקיות בשם של סט ("02 התארגנות") ממלאות את הסט הזה."`, and the folder row: an input (`dir=ltr`, placeholder `"https://www.dropbox.com/scl/fo/…"`, `data-testid="photo-folder"`) and the brand button `"טעינת תמונות"` (disabled when empty or loading). A red error text below.

### 7.3 Load or reload the folder (`load(confirm)`, `:236-259`)
- `POST /api/admin/galleries/{id}/photos/load` with `{ url: folder, confirm?: true }`.
- When more than 10% of the keys the couple chose (hearts, Instagram, lists, album slots) would lose their photo, the worker saves nothing and answers `{ needsConfirm: true, lost, total }`. The hub then asks `confirmDialog("{lost} מתוך {total} התמונות שהזוג בחר (לבבות, אינסטגרם, רשימות או האלבום) לא נמצאות בתיקייה הזו. לטעון בכל זאת? הבחירות האלה יישארו בלי תמונה.")`; yes sends again with `confirm: true`.
- Success: the data is replaced, toast `"נטענו {n} תמונות"`. `warnings[]` (for example Dropbox HEIC or >20 MB files without a preview) is joined into the amber warning. Then a new capture-time read is allowed.
- Server merge (summary; details in the worker spec): existing keys, sets, cover and hidden flags are kept. Folders named after a preset set fill that set. A new shared link starts fresh and deletes the face data.

### 7.4 Main card (`:482-523`)
- h2 `"התמונות ({visible count he-IL})"`.
- On the right (`data-testid="fav-summary"`): `"♥ הזוג סימן {favorites.length}"`, green when > 0, else gray. When at least one heart has a named person, add `" ({name or "ללא שם"} {n} · …)"`, sorted by count descending.
- The folder row with the button `"טעינה מחדש"`.
- Hint `"טעינה מחדש מוסיפה תמונות חדשות ושומרת את הסטים, תמונת השער והתמונות המוסתרות."`
- Red error (`data-testid="photos-error"`).
- Amber warning (`data-testid="photos-warning"`) with an outline button `"טען מחדש"`, which reloads the folder.
- **No capture time** row (`data-testid="no-time"`): shown when not reading and (`noTime > 0` or (`timesV !== 2` and every photo already has a label)).
  - `noTime` = photos whose `t` is not a number.
  - Text `"{noTime} תמונות בלי שעת צילום (מוצגות אחרי התמונה שלפניהן לפי שם)"` (only when > 0), plus the outline button `"קריאת זמנים מחדש"`, which runs `readTimes(data, {again:true})`.
- Progress bars (a rounded pill with the fill growing from the right, `"{text} {done}/{total}"`):
  - reading times: `"מסדר את התמונות לפי שעת הצילום"` (`data-testid="dating"`)
  - measuring: `"סורק תמונות"` (`data-testid="scan"`)

### 7.5 Automatic background jobs (`:262-269`)
These run whenever `data.items.length` changes.
1. **measure** (`:145-178`): for photos without `ar`, load the `m` preview in an `Image()` (6 parallel lanes) and record `ar = naturalWidth / naturalHeight`. Results are saved in batches of 40 via `{items: {key: {ar}}}`. Failures are skipped.
2. **readTimes** (`:189-230`), once per load, if any photo has `label === undefined`:
   - `keys` = photos with `label === undefined`. With `again`: every photo when `timesV !== 2`, else the photos without a numeric `t`.
   - `readPhotoDates` (`lib/photoDates.js`) sends `POST /api/admin/galleries/{id}/photos/dates` with `{ keys: [...] }`.
     - Batch size per cloud from `datesBatchSize(provider)`: dropbox and dropbox-link 20, gdrive 20 (10 without the studio's Google key; the worker answers `batch` and the hub shrinks), pcloud 8, otherwise 20.
     - 3 parallel lanes, up to 3 retries for `failed`; `skipped` keys are put back in the queue.
     - Response `{ dates: {key: ms|null}, labels: {key: string}, failed: string[], skipped: string[], batch: number }`.
     - A Dropbox 401 stops everything with its message.
   - Patches: `{t: number|null, label: string}` for each key read. A failed key gets **no** label (it is tried again next time), and its old `t` is cleared only when the whole list was being redone (`whole && old`). Saved in chunks of 1000 keys. If all were saved and the whole list was old, `PUT {timesV: 2}`.
   - Then, if labels are on, `applyLabels`.

### 7.6 Top folders ask ("טיזר"; `:421-456, 525-544`)
- Top folders = item folders matching `isTopFolder`: `/(^|[\s_-])\d*\s*(טופ|top)\s*\d*$/i`, for example "טופ1", "top 2", "מאי ואופק טופ2". They are sorted by name.
- Copies = photos in later top folders whose lower-cased file name already appeared in an earlier top folder.
- Shown while localStorage `top-asked:{galleryId}` is not `"1"` and top folders exist (`data-testid="top-ask"`, brand border):
  - `<b>"מצאתי {1 ? "תיקיית טופ" : "תיקיות טופ"}: {f} ({n}), … . לשייך אותן לסט "טיזר"?"</b>`
  - If there are copies, a checkbox (default on): `"להסתיר מהזוג {k} עותקים כפולים (אותה תמונה ביותר מתיקיית טופ אחת)"`.
  - `"כן, לשייך לטיזר"`: creates the set `"טיזר"` at the **start** of the set list if it is missing (a separate save), then assigns every top-folder photo to it (copies also `hidden: true`). Toast `"{n − hidden} תמונות שויכו לטיזר"` plus `", {hidden} עותקים הוסתרו"`. Marks the question done.
  - `"לא"`: marks it done.

### 7.7 Options card (`data-testid="photo-options"`, `:546-610`)
- Checkbox **`"סידור לפי שעת צילום"`** · `"התמונות של כל הצלמים על ציר זמן אחד. כבוי: לפי תיקייה ושם קובץ."` It is checked when `timeOrder !== false`. A change updates the screen at once and sends `PUT {timeOrder}`.
- Checkbox **`"שיוך לסטים לפי צבע מלייטרום"`** · `"תמונה שסומנה בצבע בלייטרום נכנסת לסט של הצבע (רק תמונות שעוד אין להן סט)."` This is a **studio-wide** setting.
  - A change sends `PUT /api/admin/settings` with `{labelSetsOn}`.
  - Turning it on runs `readTimes` if some labels are unread, otherwise `applyLabels`.
- When on (`data-testid="label-map"`):
  - Five chips for yellow `צהוב`, red `אדום`, blue `כחול`, purple `סגול`, green `ירוק` (colour dot, `"{colour}: {mapped set name | "בלי סט"}"`, count).
  - `"שינוי הצבעים"` / `"סגירה"` toggles the editor.
  - The brand button `"החלה עכשיו"` runs `applyLabels`.
  - If no labels were found and all were read: `"לא נמצאו צבעים בקבצים. בייצוא מלייטרום, תחת Metadata, בחרו "All Metadata" (או "All Except Camera Raw Info") כדי שהצבע יישמר בקובץ."`
  - The editor has one select per colour: `"בלי סט"` plus the set **names**. A change sends `PUT /api/admin/settings` with `{labelMap}`; the map is stored by set **name** (at most 40 characters), studio-wide.
  - Server default map: yellow `התארגנות`, red `צילומי חוץ`, blue `משפחות`, purple `מסיבה`, green `''` (`shared/exif.ts:107`).
- `applyLabels` (`:128-142`): every photo **without a set** whose label maps to a set name that exists in this gallery gets `{set: id}`. Toast `"{n} תמונות שויכו לסטים לפי הצבע מלייטרום"`.

### 7.8 Cover position ("תמונת השער"; `CoverPreview`, `:1136-1196`)
- Shown when there is a cover item: `data.cover`, or else the first non-hidden photo.
- h2 `"תמונת השער"` and the outline button `"איפוס למרכז"`, which sends `{coverPos: {x:50, y:50}}`.
- Text `"לחצו או גררו על התמונה כדי לבחור איזה חלק שלה יישאר במרכז. בצד: איך זה ייראה במחשב ובטלפון. את התמונה עצמה בוחרים עם ★ בתמונות למטה."`
- On the left, the photo (size `l`, `max-h-[360px]`, contain) with a white ring marker. Pointer down or drag picks `x,y` = integer percent 0–100; pointer up saves `PUT {coverPos}`.
- On the right, two previews with `background-position: x% y%`, a dark gradient and the couple name: `"מחשב"` (300 px wide, 16:10) and `"טלפון"` (110 px wide, 9:19.5).
- Layout `md:grid-cols-[1fr_1.4fr]`.

### 7.9 Sets card ("סטים"; `:614-640`)
- One chip per set (brand outline): the **name**, the count (non-hidden photos in the set, mono font), and small buttons:
  - `›` (title `"הזזה ימינה"`) moves it to index −1.
  - `‹` (title `"הזזה שמאלה"`) moves it to index +1.
  - `✎` (title `"שינוי שם"`) uses `window.prompt("שם חדש לסט:", name)`.
  - `×` (title `"מחיקה"`) asks `confirmDialog("למחוק את הסט "{name}"? התמונות שלו לא נמחקות, הן רק יוצאות מהסט.")`, saves the set list, and returns the view to "all" if needed.
- Preset chips `"+ {name}"` for presets not yet present. `PRESET_SETS = ['טיזר','התארגנות','צילומי חוץ','משפחות','אולם','טקס חופה','מסיבה','בחירת אלבום']` (`shared/photosets.ts:3`).
- An input with placeholder `"שם לסט חדש"`, `maxLength=40`; Enter adds. A brand button `"+ הוספת סט"` (disabled when empty).
  - A duplicate name toasts `"כבר יש סט בשם "{n}""`.
  - Otherwise `save({sets: [...sets, {id: "s"+Date.now(), name}]})` and toast `"נוסף הסט "{n}""`.
- Tip `"טיפ: אפשר גם לבחור תמונות וללחוץ "+ סט חדש" בפס שלמטה, והן ייכנסו לסט החדש מיד."`

### 7.10 Views, selection and grid (`:642-736`)
**View chips** (`data-testid="photo-views"`): `"הכל"`, `"ללא סט"`, each set name, `"♥ מועדפי הזוג"`, `"📷 לאינסטגרם"`, `"מוסתרות"`, each with a count. **Folder chips** (only when there are more than 1 distinct folders): `"תיקיות מהקישור:"` and `"📁 {folder} {count}"`. Changing the view clears the selection.

| View | Shown photos | Count |
|---|---|---|
| all | `!hidden` | non-hidden |
| unsorted (`ללא סט`) | `!hidden && !set` | same |
| set id | `!hidden && set === id` | same |
| fav | key in favorites (hidden included) | `favorites.length` |
| insta | key in insta (hidden included) | `insta.length` |
| hidden | `hidden` | hidden count |
| `folder:{f}` | `folder === f` (hidden included) | all in the folder |

- With **"hide sorted"** on and the view being all or a folder, photos that have a set are also excluded.
- In fav (when not empty): brand button `"העתקת שמות הקבצים (לסינון בלייטרום)"`. In insta: `"העתקת שמות הקבצים (לאינסטגרם)"`. Both copy the file names without extension joined by `", "` and toast `"הועתקו {n} שמות קבצים"`.
- **Select bar** (`data-testid="select-bar"`):
  - A toggle pill: checkbox `"הסתרת תמונות שכבר שויכו לסט"`, plus `" · נשארו {shown}"` when on. It is disabled and faded outside all and folder views (title `'עובד בתצוגת "הכל" ובתיקיות מהקישור'`). Saved in localStorage `photos:hide-sorted` (global, not per gallery). Toggling clears the selection.
  - Nothing selected: `"לחיצה בוחרת תמונה. Shift+לחיצה בוחרת טווח, למשל כל ההתארגנות מהתמונה הראשונה עד האחרונה."` plus an outline button `"בחירת כל {shown}"`.
  - Some selected: `<b>"נבחרו {n}"</b>` and `"השיוך בפס שבתחתית המסך. אפשר להמשיך לגלול ולבחור."`
- **Grid** (`data-testid="admin-photos"`): `grid-template-columns: repeat(auto-fill, minmax(118px, 1fr))`, gap 6 px.
  - Each tile is a square button (`data-testid="admin-photo"`, `data-key`, title = file name) holding the `m` preview with `object-cover`, lazy-loaded.
  - Marks:
    - hidden: 30% opacity
    - selected: brand border plus a `✓` badge at the top right
    - cover: `★` at the top left
    - heart: pink `♥` at the bottom left
    - Instagram: `📷` (title `"הזוג סימן לאינסטגרם"`)
    - in the "all" view, a set-name pill at the bottom right
- **Click**: toggles the photo. **Shift+click** adds the range between the last clicked photo and this one (in the current view order).
- **Keyboard** (`:405-419`; inactive while typing in an input, with Cmd, Ctrl or Alt, or while a confirm is open):
  - `Esc` clears the selection.
  - `1`–`9` assign the selection to set n in list order.
  - `0` sends `{set: undefined}` (bug B1).

### 7.11 Selection dock (`data-testid="sel-dock"`; `:757-832`)
Fixed at the bottom (`max-w-5xl` inside), with a 150 px spacer.
- `<b>"נבחרו {n} תמונות · שיוך לסט:"</b>`
- In the hidden view: `"הצגה לזוג"` sends `{hidden:false}`. Otherwise `"הסתרה מהזוג"` sends `{hidden:true}`.
- With exactly 1 selected: the brand button `"★ תמונת שער"` sends `{cover: key}`.
- `"ניקוי הבחירה"` (title `Esc`).
- Set chips: `<kbd>{1..9}</kbd> {name} {count}`, which send `{set: id}` for all selected (`data-testid="assign-chip"`, `data-set`).
- `<kbd>0</kbd>"בלי סט"` sends `{set: undefined}` (bug B1).
- `"+ סט חדש"` (dashed) opens an inline input `"שם הסט"` (`maxLength=40`, autofocus; prefilled with the folder name in a folder view).
  - Enter or `"יצירה ושיוך"` creates the set (or joins an existing one with the same name, after trimming and cutting to 40) and assigns the selection in **one** PUT `{sets, items}`.
  - Toast `"נוצר הסט "{n}" עם {k} תמונות"` or `"{k} תמונות נוספו לסט "{n}""`.
  - `Esc` or `"ביטול"` closes the input.
- Every assignment clears the selection afterwards.

---

## 8. DesignEditor: "עיצוב הגלריה" (`components/films/DesignEditor.jsx`), photo galleries only

- **Load**: `Promise.all([GET …/photos, GET /api/admin/settings])`.
  - `studioDefault = cleanDesign(settings.designDefault)`.
  - `own = Boolean(photos.design)`.
  - `design = cleanDesign(photos.design, studioDefault)`.
  - Cover photo = `photos.cover` or the first non-hidden; `token = previewToken`; `gen`.
  - On error the design falls back to `DEFAULT_DESIGN`.
  - It injects Google Fonts `<link id="font-{f}">` for all six fonts.
- **Header**: h2 `"עיצוב הגלריה"`. Status (`data-testid="design-saved"`): `"שומר…"` while saving, `"✓ נשמר"` after, otherwise `"עיצוב משלה"` when `own`, else `"לפי ברירת המחדל של הסטודיו"`.
- **Tabs** (pills): `"שער"`, `"טיפוגרפיה"`, `"צבע"`, `"גריד"`.
  - **שער**: 10 tiles in 2 columns with a mini cover drawn in CSS (`DesignEditor.css`, 16:10) using the gallery's cover photo and the couple name (or `"השמות"`). Labels: center `מרכז`, side `צד`, novel `רומן`, vintage `וינטג׳`, frame `מסגרת`, stripe `פסים`, divider `חצוי`, journal `יומן`, stamp `בול`, outline `קו מתאר`.
  - **טיפוגרפיה**: 6 tiles, each showing the couple name (or `"נועה & תומר"`) in that font, then `"{label} · {hint}"`:
    - sans `נקי · פונט ניטרלי` (Assistant)
    - serif `קלאסי · פונט עם סריפים` (Frank Ruhl Libre)
    - modern `מודרני · פונט מתוחכם` (Cormorant Garamond)
    - timeless `נצחי · קליל ואוורירי` (Bellefair)
    - bold `בולט · פונט חזק` (Secular One)
    - subtle `עדין · מינימליסטי` (Heebo 200)
  - **צבע**: 9 tiles with three swatches (bg, surface, accent): `בהיר, זהב, ורוד, טרקוטה, חול, זית, אגבה, ים, כהה`. Hex values are in `shared/design.ts:51-61`.
  - **גריד**: four two-way choices with SVG icons:
    - `"סגנון"`: `עמודות` (columns) / `שורות` (rows)
    - `"גודל התמונות"`: `רגיל` / `גדול`
    - `"ריווח"`: `רגיל` / `מרווח`
    - `"כפתורים בסרגל העליון"`: `אייקונים בלבד` (icons) / `אייקון וטקסט` (text)
- Built-in default `DEFAULT_DESIGN = {cover:'center', font:'modern', color:'light', grid:'rows', thumb:'regular', spacing:'regular', nav:'text'}`.
- **Change**: the state updates, `own = true`, it is pushed to the preview, and a **400 ms debounced** `PUT …/photos {design: next}` saves it. Errors toast and clear the status.
- `"שמירה כברירת מחדל לכל הגלריות"`: `PUT /api/admin/settings {designDefault: design}`, toast `"העיצוב נשמר כברירת המחדל של הסטודיו"`.
- `"חזרה לברירת המחדל"` (only when `own`): `PUT …/photos {design: null}`, revert to the studio default, toast `"הגלריה חזרה לעיצוב ברירת המחדל של הסטודיו"`.
- Note: `"ברירת המחדל חלה על כל גלריה שלא עוצבה בנפרד."`
- **Live preview**: an iframe of the real couple page, `src = "{coupleUrl}?preview=1&pt={previewToken}"`, `title="תצוגה מקדימה של הגלריה"`.
  - Rendered at the device size (`desktop` 1280×800, `phone` 390×844) and scaled by `min(1, boxWidth/w, 620/h)`, with `transform-origin: top right`.
  - Protocol: when the iframe posts `{type:"pg-ready"}` (origin must equal the films origin and the source must be the frame), or on `onLoad`, the hub posts `{type:"pg-design", design}` to the films origin. Every change is posted at once, before the save.
  - Device toggle `"מחשב"` (Monitor) / `"טלפון"` (Smartphone).
  - Without a couple URL: `"התצוגה המקדימה תופיע אחרי שמירת הגלריה."`
  - Layout `lg:grid-cols-[minmax(18rem,25rem)_minmax(0,1fr)]`; the preview is sticky on `lg`.

---

## 9. Adjacent cards embedded on the gallery page (they belong to other features)

These are rendered inside PhotosEditor after the grid. They are summarized here because they sit on the photo gallery page and the trash and extend flows depend on them.

### 9.1 "האלבום של הזוג" (`AlbumCard`, `:844-1028`). This is the couple's album designer.
- `GET …/album` returns `{ album, summary: {status, spreads, photos, empty, extraSpreads, extraCost, updatedAt, submittedAt} | null, order: {id, workflowStatus, paymentStatus, spreads, coupleLink} | null, print, orderMissing? }`.
- `GET …/print-link` returns `{ url, createdAt, expiresAt, expired, paused: 'not_sent'|'album_open'|'pages_changed'|null, hiddenInAlbum }`.
- States:
  - loading `"טוען…"`
  - no album `"הזוג עוד לא התחיל לעצב. הכפתור "עיצוב האלבום" מופיע להם בגלריה."`
  - otherwise a green pill `"נשלח ב-{date}"` or an amber `"בעבודה אצל הזוג"`, then `"{spreads} דפים"`, `"{photos} תמונות"`, amber `"{extraSpreads} דפים נוספים · +{extraCost} ₪"` (or `" · לא הוגדר מחיר לדף נוסף"`), and gray `"{empty} משבצות ריקות"`.
- Order line `"כשהזוג שלח את האלבום נפתחה הזמנת אלבום, והם ממשיכים בה לבחירת מוצר, כריכה ותשלום."` with the link `"להזמנה"` to `/AlbumOrders/{id}`. Missing order: `"הזוג שלח את האלבום אבל הזמנת האלבום עוד לא נפתחה. היא תיפתח כשהזוג ילחץ "להמשך ההזמנה" בעמוד האלבום."`
- Buttons:
  - `"צפייה באלבום"` opens `{coupleUrl}/album?pt=`.
  - `"הורדה לדפוס (300DPI)"` opens `{coupleUrl}/print?pt=`.
  - `"פתיחה לעריכה מחדש"` (submitted only): confirm `"לפתוח את האלבום לעריכה מחדש? הזוג יוכל לשנות אותו ולשלוח שוב. קישור בית הדפוס יושהה עד שישלחו שוב."`, then `POST …/album/unlock`, toast `"האלבום נפתח לעריכה"` (plus the worker's warning).
- Print-shop block `"קישור לבית הדפוס"`:
  - Explanation text; dates `"נוצר {d} · בתוקף עד {d}"` or red `"פג ב-{d}"`.
  - Paused texts: `album_open`, `pages_changed`.
  - Hidden-photo warning.
  - Link box with `"העתקה"`, `"חידוש ל-30 יום"` (`POST …/print-link {renew:true}`), and `"ביטול הקישור"` (confirm, then `DELETE …/print-link`).
  - Without a link and submitted: `"יצירת קישור לבית הדפוס"` (`POST …/print-link`, copies it, toast `"הקישור הועתק. אפשר לשלוח אותו לבית הדפוס."`). Otherwise `"אפשר ליצור קישור לבית הדפוס אחרי שהזוג שולח את האלבום."`
- **Dependency for photo galleries**: trash and purge are guarded by the album and its order (§4.7 and §4.9 reasons `album_submitted`, `album_order`, `album_paid`).

### 9.2 "זיהוי פנים לאורחים" (`FaceCard`, `:1036-1122`). This is face search.
- `GET …/faces` returns `{ chunks, photos, faces, visible, scanned, left, offBecauseDeleted }`. It reloads on window focus.
- A checkbox and a long description. Turning it **off** asks `"לכבות את החיפוש לפי פנים? נתוני הפנים של הגלריה יימחקו, והדף לאורחים יפסיק לעבוד."`; either direction sends `PUT …/photos {faceSearch}`.
- Off because data was deleted: `"זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש."`
- On:
  - `"נסרקו {scanned} מתוך {visible} תמונות."` (plus `" עד הסריקה, אורחים יראו שהחיפוש עוד לא מוכן."` when 0), with the button `"סריקת פנים"` / `"המשך סריקה"` that opens `{coupleUrl}/faces?pt=`. Note `"נפתחת לשונית חדשה; השאירו אותה פתוחה עד הסוף. אם נעצר, זה ממשיך מאותו מקום."`
  - When done, green `"✓ כל התמונות נסרקו · נמצאו {faces} פנים"`.
  - Guests' face link `{guestUrl}/me` with `"העתקה"` and `"שליחה בוואטסאפ"`: `wa.me/?text=` + `"מצאו את התמונות שלכם מהחתונה של {coupleName}: {link}"`.
- **Dependency for photo galleries**: close, trash and purge delete the face data first. Restore and extend may report `faceSearchOff` (§4.10).

---

## 10. Screen C: settings `/photos/settings` (`pages/films/FilmsSettings.jsx`)

These are shared with `/films/settings`: one record per studio (`films_studio_settings`) plus `tenants.slug`.

- **Load**: `GET /api/admin/settings` returns the admin view (`worker/settings.ts:69-96`): `{ studioName, logoUrl, defaultDays, termsText, termsIsDefault, contactLine, instagram, phone, facebook, vimeo, youtube, headline, about, dropbox: {appConfigured, connected, accountName}, google: {hasKey}, labelSetsOn, labelMap, music: [{id, name, type, size}], musicDefault, designDefault, slug, redirectUri }`. A spinner while loading, or the red error.
- **Layout**: a `<form>` `max-w-3xl`.
  - h1 `"הגדרות גלריות"`.
  - Note (`data-testid="settings-shared-note"`) `"ההגדרות כאן משותפות לגלריות ולסרטים: שינוי במסך הזה משנה גם בהגדרות הסרטים."`
  - Note `"השם, הלוגו, הצבע והאינסטגרם שהזוגות רואים נלקחים מ"` plus a link `"הגדרות ← פרטי הסטודיו"` to `/Settings` plus `"."`.
- **Section `"גלריות"`**:
  - `"ימי גישה כברירת מחדל לגלריה חדשה"`: number 1–3650 (`Number(value)`). Server: integer 1–3650, otherwise `"מספר ימי ברירת המחדל לא תקין"`. Default 30.
  - `"הכתובת שלכם בקישור לזוג (באנגלית, בלי רווחים)"`: text, `dir=ltr`. Each keystroke lower-cases it and replaces any character outside `[a-z0-9-]` with `-`. A live example under it: `{FILMS_BASE_URL}/<b>{slug || "…"}</b>/a1b2c3d4…`.
  - Hint (`data-testid="slug-hint"`): `"שינוי הכתובת משנה את הקישורים שתעתיקו מעכשיו. קישורים לגלריות שכבר נשלחו ממשיכים לעבוד ועוברים לכתובת החדשה. עמוד הסטודיו בכתובת הישנה מפנה לחדשה, והכתובת הישנה שמורה לכם שנה; אחרי שנה סטודיו אחר יכול לקחת אותה. אפשר לשנות את הכתובת עד 3 פעמים ב-30 יום."` (Slug rules and errors are worker and DB side.)
  - `"התקנון שהזוג מאשר בכניסה לגלריה"`: textarea `min-h-[160px]`, hint `"ריקון השדה ושמירה מחזירים את נוסח ברירת המחדל."`. Empty is saved as `null`, which means the built-in `DEFAULT_TERMS` text (worker `settings.ts:7-13`; it talks about films).
  - `"שורת קשר (מוצגת כשהגלריה נסגרה)"`: input, placeholder `"לשחזור הגישה אפשר לפנות אלינו בוואטסאפ 050-0000000"`. Server: trimmed, at most 200 characters.
- **Section `"חיבור לדרופבוקס"`**:
  - Connected: green `"מחובר ({accountName})"` and a red `"ניתוק"` button (`data-testid="dropbox-disconnect"`).
  - Not connected: the text `"החיבור מאפשר להדביק קישור לתיקייה שלמה ולקבל את כל הסרטים אוטומטית, גם מתיקיות משותפות של אחרים. בלי חיבור אפשר להוסיף סרטים לפי קישור לכל קובץ."` (it talks about films). Then the brand button `"חיבור דרופבוקס"` if the platform app is configured, otherwise amber `"חיבור דרופבוקס עדיין לא זמין במערכת."`
  - Without the platform Google key: `"צפייה בסרטים מגוגל דרייב עדיין לא זמינה במערכת; הם יוצגו להורדה בלבד."`
  - Connect: `GET /api/admin/dropbox/connect` returns `{url}`, then `window.location.assign(url)`. Dropbox returns to the worker's `/api/admin/dropbox/callback`, which always redirects to **`{HUB_URL}/films/settings`** with `?dropbox_code&dropbox_state` (or `?dropbox=error`). That page then calls `POST /api/admin/dropbox/finish {code, state}`, toasts `"דרופבוקס חובר בהצלחה"`, and removes the query. `?dropbox=error` shows `"חיבור הדרופבוקס לא הצליח. נסו שוב."`
  - Disconnect: `GET /api/admin/dropbox/impact` returns `{photoGalleries, films, filmGalleries, studioFilms}`. The confirm text is built by `disconnectQuestion` (`:32-46`):
    - `"לנתק את חשבון הדרופבוקס?"`, a blank line, then either `"יפסיקו לעבוד עד שתתחברו שוב: {parts}."`, or `"אין כרגע גלריות פתוחות או סרטים שתלויים בחיבור."`, or (impact failed) `"לא הצלחנו לספור מה תלוי בחיבור. גלריות מתיקיות בדרופבוקס שלכם יפסיקו לעבוד עד שתתחברו שוב."`
    - Parts: `"גלריית תמונות פתוחה אחת"` or `"{n} גלריות תמונות פתוחות"`, and so on.
    - Then a blank line and `"הגישה של המערכת תבוטל גם אצל דרופבוקס. קישורים ציבוריים שכבר שיתפתם מדרופבוקס לא משתנים."`
    - Then `POST /api/admin/dropbox/disconnect` returns the settings; toast `"חשבון הדרופבוקס נותק"`.
- **Section `"שירים למצגת (גלריות תמונות)"`**: only on `/photos/settings` and only with the photos module (`Songs`, `:266-324`).
  - Text `"עד 3 שירים (MP3 או M4A, עד 10MB). השיר המסומן מתנגן במצגת של כל גלריית תמונות, ובכל גלריה אפשר לבחור שיר אחר או מצגת שקטה."`
  - A list (`data-testid="songs"`). Each row has a radio (the default) with the name, `"{size MB, 1 decimal}MB"`, the tag `"ברירת המחדל"`, and a red `"מחיקה"`.
  - The default radio saves immediately: `PUT /api/admin/settings {musicDefault: id}`.
  - Delete: `confirmDialog("למחוק את השיר "{name}"?")`, then `DELETE /api/admin/music/{id}`, which returns the settings. If it was the default, the first remaining song becomes the default.
  - A hidden file input `accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a"`. The button `"הוספת שיר"` reads `"יש כבר 3 שירים"` and is disabled at 3.
  - Upload: `POST /api/admin/music` with a raw body, `Content-Type: file.type || "audio/mpeg"`, `X-File-Name`. It returns the settings; toast `"השיר נוסף"`.
  - Server errors: `"אפשר לשמור עד 3 שירים. מחקו אחד כדי להוסיף."`, `"צריך קובץ שמע (MP3 או M4A)"`, `"הקובץ ריק"`, `"השיר גדול מדי (עד 10MB). אפשר לייצא אותו ב-MP3 באיכות 192."`. Name = the file name without extension, at most 80 characters, or `"שיר"`. The first song becomes the default automatically.
- **Section `"ניתוק כל הגישות"`** (owner and admin only):
  - Explanation text (`:245-249`) and a red `"נתק את כל הגישות"` button (`data-testid="revoke-all"`).
  - Confirm `"לנתק את כל הגישות לגלריות?\n\nכל מי שהקליד סיסמה או קוד הורדה בגלריה כלשהי של הסטודיו יצטרך להקליד אותם שוב, וכל קישור 'פתיחה כמו הזוג' שנפתח עד עכשיו יפסיק לעבוד. הקישורים לזוגות ולאורחים עצמם לא משתנים. מסכי גלריות פתוחים אצל הצוות צריכים רענון."`
  - Then `POST /api/admin/access/revoke`, which returns `{accessVersion}`; toast `"כל הגישות נותקו"`.
- **Save** `"שמירת הגדרות"`: `PUT /api/admin/settings {defaultDays, termsText, contactLine, slug}` returns the settings; toast `"ההגדרות נשמרו"`; errors in red text. Songs, Dropbox and revoke act immediately, not through Save.
- Settings written from other screens: `labelSetsOn` and `labelMap` (PhotosEditor), `designDefault` (DesignEditor).

---

## 11. API reference (hub → films worker; all with `Authorization: Bearer <Supabase JWT>`)

The "Worker guard" column is the `requireStudioAdmin` options: W = write, M = `module:'photos'`, RO = allowed while read-only.

| # | Method and path | Body | Response | Called from | Worker guard |
|---|---|---|---|---|---|
| 1 | GET `/api/admin/galleries?limit=500&offset=N` | n/a | `{items: ListGallery[], total}` | List load | admin |
| 2 | GET `/api/admin/galleries/:id` | n/a | adminGallery + `terms` + `previewToken` (+ creates `guestId`) | Form load, open as couple, album order card | admin + requireKind |
| 3 | POST `/api/admin/galleries` | `{kind:'photos', coupleName, studioName, date, venue, days, password?, downloadPin?, eventId?, music}` | adminGallery | Form create; album designer | W + requireKind |
| 4 | PUT `/api/admin/galleries/:id` | same without kind; `days` only if edited | adminGallery | Form save | W, RO (only lowering exposure) |
| 5 | DELETE `/api/admin/galleries/:id[?force=1][?forever=1]` | n/a | `{ok:true}`; 409 with `code` `album_submitted`/`album_order`/`album_paid` | Row trash / purge | W, RO |
| 6 | POST `/api/admin/galleries/:id/restore` | n/a | adminGallery + `faceSearchOff?` | Trash row | W |
| 7 | POST `/api/admin/galleries/:id/extend` | `{days, expiresAt}` | adminGallery + `faceSearchOff?`; 409 if the closing time changed | Extend dialog (1) | W |
| 8 | POST `/api/admin/galleries/batch` | `{action, ids≤50, days?, seen?, force?}` | `{ok, done, doneIds, skipped[{id,reason}], remaining, faceSearchOff?}` | Bulk bar, extend (n) | W, RO for close/trash/purge |
| 9 | POST `/api/admin/galleries/bulk` | `{items:[{coupleName,date,venue}]≤100, kind}` | `Gallery[]` | List import | W |
| 10 | GET `/api/admin/galleries/options` | n/a | `[{id, kind, coupleName, date, deletedAt?}]` | LinkPicker | admin |
| 11 | PUT `/api/admin/galleries/:id/link` | `{linkedId}` | `{ok, linkedId}` | LinkPicker | W |
| 12 | POST `/api/admin/galleries/:id/rotate-guest` | n/a | `{guestId, gallery}` | Guests' link | W, M |
| 13 | GET `/api/admin/dashboard[?kind=photos]` | n/a | GalleriesSummary | Summary tiles, dashboard | admin |
| 14 | GET `/api/admin/galleries/:id/photos` | n/a | PhotoData + favorites/favBy/insta/previewToken, or `null` | PhotosEditor, DesignEditor | M |
| 15 | PUT `/api/admin/galleries/:id/photos` | patch (§7.1) | same as #14 (+ `ambiguous`, `warning`) | PhotosEditor, DesignEditor, FaceCard | W, M, RO only `{faceSearch:false}` |
| 16 | POST `/api/admin/galleries/:id/photos/load` | `{url, confirm?}` | #14 shape + `warnings?`, or `{needsConfirm, lost, total}` | Form create, PhotosEditor | W, M |
| 17 | POST `/api/admin/galleries/:id/photos/dates` | `{keys}` | `{dates, labels, failed, skipped, batch}` | PhotosEditor readTimes | M |
| 18 | GET/PUT `/api/admin/settings` | PUT: any of `defaultDays, termsText, contactLine, slug, musicDefault, designDefault, labelSetsOn, labelMap` (+ films-only `vimeo, youtube, headline, about`) | settings admin view | Settings, form, PhotosEditor, DesignEditor | PUT: W |
| 19 | POST `/api/admin/music` | raw audio, `X-File-Name` | settings view | Songs | W, M |
| 20 | DELETE `/api/admin/music/:id` | n/a | settings view | Songs | W, M |
| 21 | POST `/api/admin/access/revoke` | n/a | `{accessVersion}` | Settings | owner/admin |
| 22 | GET `/api/admin/dropbox/connect`, POST `/finish`, GET `/impact`, POST `/disconnect` | see §10 | | Settings | W (impact: admin) |
| 23 | GET `…/album`, POST `…/album/unlock`, GET/POST/DELETE `…/print-link` | §9.1 | | AlbumCard | M (+W) |
| 24 | GET `…/faces` | n/a | §9.2 | FaceCard | M |

Assets fetched directly by `<img>` or `<iframe>` (no Bearer header; access by `pt` token):
- `/api/photos/:id/v:gen/:key?s=m|md|l&pt=…` (thumbnails, cover)
- `{FILMS_BASE_URL}/{slug}/{id}?preview=1&pt=…` (design preview)

---

## 12. Computed values and formulas (summary)

| Value | Formula | Where |
|---|---|---|
| `daysLeft` | expired gives 0; otherwise `max(0, israelDay(expiresAt) − israelDay(now))` in calendar days | worker `galleries.ts:385-388`, `shared/day.ts:42-44` |
| `expired` | `Date.parse(expiresAt) <= now` | `galleries.ts:390-392` |
| New gallery `expiresAt` | `endOfIsraelDay(israelDay(createdAt) + days)`, 23:59:59 Israel time | `galleries.ts:188`, `day.ts:36-39` |
| Extend | `endOfIsraelDay(min(max(now, expiresAt) + days, createdAt + 3650d))`; `days = round((expiresAt − createdAt)/1d)` | `galleries.ts:289-293` |
| Close now | `expiresAt = now`; `days = max(days, 1)` | `galleries.ts:301-309` |
| Trash countdown | `max(0, 30 − floor((now − deletedAt)/86 400 000))` | `FilmsGalleries.jsx:644` |
| Empty gallery | `photoCount === 0` (visible photos) | `:53-54` |
| Filters | §4.4 | |
| Filter counts | per kind, ignoring search | `:376` |
| Month group count | number of shown rows with the same `monthOf(date)` | `:472` |
| Views column | `views` (couple) `(+guestViews אורחים)` `/ downloads` | `:504-510` |
| Summary numbers | §5.2 | |
| Editor counts | §7.10 | |
| `noTime` | photos whose `t` is not a number | `PhotosEditor.jsx:476` |
| Cover item | `items.find(key === cover) ?? items.find(!hidden)` | `:477` |
| Song size | `(size/1024/1024).toFixed(1) + "MB"` | `FilmsSettings.jsx:309` |

---

## 13. Statuses, labels and colours

Pill base: `inline-block rounded-full px-2 py-0.5 text-xs border` (`FilmsGalleries.jsx:89-97, 643-646`).

| Condition (checked in this order) | Label | Classes |
|---|---|---|
| `deletedAt` | `"בסל · נמחקת בעוד {left} ימים"` | `border-red-500/30 bg-red-500/10 text-red-300` |
| `expired` | `"נסגרה"` | `border-gray-600 text-gray-400` |
| empty | `"ללא תמונות"` | `border-gray-600 text-gray-300` |
| `daysLeft <= 7` | `"נסגרת {היום \| מחר \| בעוד N ימים}"` (`<=0` today, `1` tomorrow) | `border-amber-500/40 bg-amber-500/10 text-amber-300` |
| otherwise | `"פתוחה · {daysLeft} ימים"` | `border-green-500/30 bg-green-500/10 text-green-300` |

Theme:
- Brand colour = CSS variables `--brand-50 … --brand-950` and `--brand-fg`. The default is yellow (`--brand-400: 250 204 21`), overwritten at runtime from `tenants.accent_color` (`index.css:5-21`, `lib/brandTheme.js`).
- The signed-in `.sp-theme` maps Tailwind grays to a navy family. For example `bg-gray-950` becomes `var(--d-bg)`, `bg-gray-900` becomes `#0E1A30`, and `bg-gray-800` becomes `#15233D`.
- It also turns any `rounded-xl border bg-gray-900 border-gray-800` panel, and `.dash-card`, into a "glow card" (navy gradient with a blue-violet top border) (`index.css:125-150, 236-290`).
- Font: Heebo.

---

## 14. Persistence (localStorage)

| Key | Value | Scope |
|---|---|---|
| `films:filter` | `all/nofilms/open/soon/closed/trash` | shared by `/photos` and `/films` |
| `films:cards` | `"1"` cards / `"0"` table | shared |
| `photos:hide-sorted` | `"1"`/`"0"` | all photo galleries |
| `top-asked:{galleryId}` | `"1"` once the top-folder question was answered | per gallery |
| `module:studio:last` | last studio path (sidebar) | n/a |

All reads and writes are wrapped in try/catch (private mode).

---

## 15. Mobile and responsive differences

- Page padding `p-4` on phones, `md:p-8` from 768 px. The sidebar becomes an off-canvas sheet with a top header (`md:hidden`) holding the logo, studio name, bell and search.
- List header and toolbar wrap (`flex-wrap`). The search keeps `min-w-[220px]` and fills its row. The filter chips wrap.
- Summary tiles: 1 column, 2 from `sm` (640 px), 4 from `lg` (1024 px).
- **Table**: no responsive variant. It scrolls sideways inside its card (`overflow-x-auto`); the name column has `min-w-[220px]` and the actions `whitespace-nowrap`.
- **Cards**: 1 / `sm` 2 / `lg` 3 / `xl` 4 columns.
- Bulk bar and selection dock: full-width fixed bars with wrapping buttons. The page adds 80 px or 150 px spacers. The setup pill floats above them.
- Form: field grid 1 column on phones, 2 from `md`. Link and guest boxes keep `min-w-[240px]` and wrap.
- PhotosEditor grid: `auto-fill minmax(118px,1fr)`, so about 2–3 columns on a phone. CoverPreview stacks the picker above the device previews until `md`.
- DesignEditor: controls above the preview until `lg`; from `lg` two columns with a sticky preview. The preview scales to the box width (minimum 200 px).
- Dialogs: shadcn `Dialog` (centered, max widths `md` / `2xl`). Page help is a full-width sheet on phones and `sm:max-w-lg` from `sm`.

---

## 16. Quirks and probable bugs (decide whether to keep them in the rebuild)

- **B1 "בלי סט" and key `0` do nothing.** `patchSelected({ set: undefined })` serializes to `{"items":{"<key>":{}}}`, because `JSON.stringify` drops `undefined`. The worker only clears a set when `'set' in patch` (`photos.ts:600`), so the photos keep their set. The original standalone app has the same code (`src/admin/PhotosEditor.tsx:446, 975`). No test covers it. A rebuild should send `set: null` (or `""`), which the worker already treats as "no set".
- **Q3** With neither gallery module, `/photos` shows the films lock text (`"גלריות סרטים לא כלול במנוי"`), because RequireModule uses the first key.
- **Q4** A studio that has only film galleries sees `"אין גלריות שמתאימות לחיפוש."` on `/photos` instead of the "no galleries yet" empty state. The search and filters (all counts 0) are shown too, because `list` holds both kinds.
- **Q5** `films_gallery_locked` (photo galleries included) lights `/films` in the menu and the bell click navigates to `/films`. In a studio with both modules that list does not contain the photo gallery.
- **Q6** Select-all picks only the first 50 shown. With more than 50 shown, the header checkbox never shows as checked and clicking it again re-selects the same 50 (use "ביטול הבחירה"). Picking more than 50 one by one gives a 400 `"עד 50 גלריות בכל פעם"` (one request, no chunking).
- **Q7** The face-off notice links to `/films/{id}` (no kind), and the form then redirects to `/photos/{id}`.
- **Q8** The Dropbox OAuth always returns to `/films/settings`, even when it started from `/photos/settings`. A photos-only studio lands on the "הגדרות סרטים" title without the songs section.
- **Q9** The new gallery's wedding date defaults to **today**. Clearing it is allowed (`""` means no date).
- **Q10** Days on an edited gallery are counted from **creation**, not from today. "Extend" counts from today or from the current end.
- **Q11** The ExtendDialog defaults to 30 days, not the studio's `defaultDays`. The worker would use `defaultDays` if `days` were missing, but the hub always sends it.
- **Q12** The summary's "נסגרות השבוע" says `"עוד 1 ימים"` where the table pill says `"נסגרת מחר"`.
- **Q13** The `"פתיחה כמו הזוג"` link on the form uses the preview token read at page load (12-hour pass). The list re-fetches it each time.
- **Q14** Several texts mention films on the photos screens: the not-configured screen, the Dropbox section, the Google key note, the help step 6, and the default terms.
- **Q15** The album money tile counts every album order of the studio (one PostgREST read, row-capped), not only orders from photo galleries.
- **Q16** Renaming a set uses `window.prompt` (not the in-app dialog).
- **Q17** The LinkPicker shows the date as raw ISO (`2026-08-11`), unlike every other date on these screens.
- **Q18** Cards view: the trash has restore only (no permanent delete), and there is no select-all.

---

## 17. Differences from the original standalone app (reference only)

`/Users/danieldayan/Downloads/מערכת צפיה וידאו/src/admin/*.tsx`. These are not to be copied; listed only so nobody ports the wrong version:
- The empty filter is `"ממתינות לקבצים"` there, `"ריקות"` in the hub.
- The content column is `"קבצים"` there, `"תמונות"` in the hub.
- The state pill there is `"נסגרת בעוד {n} ימים"` with no today or tomorrow wording.
- The original dashboard has other tiles (`"פניות חדשות"`, `"הזמנות שמחכות לתשלום"`, `"נסגרות ב-7 הימים הקרובים"` with `"עוד יום"`) and its own login, users, orders and catalog screens. The hub replaced these with Supabase auth, `/AlbumOrders` and the CRM.
- The original admin uses a different extend dialog (`"או מספר אחר של ימים"`).

---

## 18. Open questions (need the worker, couple-page or product owner's answer)

1. **Read-only studios**: the worker allows lowering exposure (close, trash, purge, new password, revoke print link, face search off) while read-only, but the hub sends read-only users to Billing, so those actions are unreachable from the UI. Should the rebuild expose a reduced gallery screen while read-only?
2. **Photo identity and merging on "טעינה מחדש"**: key derivation, the `needsConfirm` 10% rule inputs (lists, album slots), `gen` bumps, preset-folder → set mapping, the HEIC/>20 MB warnings, and sort order without times. These are worker-only (`mergePhotoData`, `sortByTime`, `listPhotos`). See the worker researcher.
3. **`previewToken` and `thumbsToken`**: format, lifetime (12 h studio pass), revocation by `accessVersion`, and what the couple page does with `?pt=` and `?preview=1` (the `pg-ready`/`pg-design` postMessage protocol on the couple side).
4. **`guestId` creation** on the first admin GET (only when access is `ok`) and what the guest route serves. The couple page shows "שתפו עם האורחים".
5. **`photoCount` and `coverKey`** are kept by the worker and DB triggers on every save. Is "empty" (`photoCount = 0`) meant to include "all hidden"?
6. **Views and downloads counting rules** (couple vs guest, whether the studio preview is excluded, per-visit or per-photo downloads) are on the worker and couple-page side. The hub only displays them.
7. **Slug validation messages** (taken, reserved, 3 changes per 30 days, 365-day hold) come from `store.setSlug` and the DB trigger `tenants_slug_guard`; the hub shows the worker's message as is.
8. **`DEFAULT_TERMS`** is film-worded. Is a photo-specific default wanted?
9. **The nightly clean-up**: trash purge after 30 days, face-data deletion on close, and blocked trash candidates when an album order exists. All worker cron; the hub only shows the countdown pill.
10. **Should the couple link get a WhatsApp send** (like the guests' link) or an automation variable? Today it is copy-only.
11. **Lightroom colour reading** (`xmpLabel` → `normalizeLabel`) and EXIF capture time (`exifTakenAt`) from the first 64 KB are worker-side. Which label strings map to the five colours?
12. **The album money tile**: confirm with the owner whether it should stay studio-wide.
13. **Bug B1**: fix it or keep it as is (§16).
