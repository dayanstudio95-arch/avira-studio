# 3 — The couple-facing PHOTO gallery (Studio Plan `apps/films-worker`)

Scope: the public, no-login photo gallery at films.studioplan.co.il, as built in
`/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os/apps/films-worker`. All paths below are relative to that folder
unless they start with `ORIG/` = `/Users/danieldayan/Downloads/מערכת צפיה וידאו` (the original Avira app it was copied from).
Backend internals (store, providers, cache keys) are only described where the page depends on them; other researchers own the
Worker and the studio admin.

Read-only research. Nothing was built, run or changed.

---

## 0. One-paragraph summary

A single React route (`/:studio/:id` or `/watch/:id`) loads ONE JSON (`GET /api/watch/:id`) that holds the gallery, the studio's
branding and the full photo list (no pagination, up to 20,000 photos). It shows: password screen (if any) → terms screen (once per
device) → full-screen cover (names, date, venue, studio logo) → "צפייה בגלריה" reveals a sticky top bar (sets as tabs, favourites,
Instagram, lists, album, share, select, slideshow, download) and a justified-rows (or columns) grid of 640/1024px previews, lazy-loaded
and windowed above 200 photos. A full-screen viewer shows the 2048px preview with pinch/double-tap zoom, swipe, RTL arrow keys and
number-key shortcuts. Hearts are stored on the server **per person name** (asked once per device), shared by everyone holding the
couple's link; there is no "send selection" step – the studio sees hearts live and the album designer (separate page) consumes them.
Downloads: one photo (original, or a 2048px "small" copy re-encoded in the browser; on phones via the share sheet), or a ZIP built
entirely in the browser (client-zip, 4 parallel fetches, streamed to disk on Chrome/Edge desktop, else 500MB in-memory parts).
Optional gallery password (cookie 180 days) and download code for originals only (cookie 30 days). A separate guests' link is
view+download only. No service worker; per-gallery web-app manifest and WhatsApp/OG card rendered by the Worker.

---

## 1. URL shape and routing

| URL | What | Ref |
|---|---|---|
| `/<studio-slug>/<id>` | The couple's link (canonical). `id` = 16 hex chars. | `src/App.tsx:31` |
| `/watch/<id>` | Same page, no studio part (studios without a slug). | `src/App.tsx:22` |
| `/<slug>/<guestId>` | The guests' link: same page, `role: 'guest'` from the server. | `worker/index.ts:1080-1088`, `src/watch/types.ts:69-72` |
| `?set=<setId>` / `?set=favorites` / `?set=instagram` / `?set=list:<listId>` | Open tab, kept in the address (shareable). | `src/photos/PhotoGallery.tsx:483-505` |
| `?photo=<key>` | Open photo (8 hex chars). A link straight to a photo opens it. | `PhotoGallery.tsx:495-505, 847-852` |
| `?pt=<token>` | Studio "open as the couple" one-time preview token; turned into a cookie (≤12h) and removed from the address with `history.replaceState`. | `src/watch/WatchPage.tsx:37-45`, `worker/index.ts:1103-1105` |
| `?preview=1` (only inside an iframe) | Studio's design screen: skips terms, no view counting, live design via `postMessage`. | `WatchPage.tsx:74-75`, `PhotoGallery.tsx:638-650` |
| `/<slug>/<id>/album` | Album designer (out of scope; linked from the top bar, couple only). | `App.tsx:32`, `PhotoGallery.tsx:1106-1111` |
| `/<slug>/<id>/me` | Guest selfie face search (out of scope; linked when enabled). | `App.tsx:34`, `PhotoGallery.tsx:1093-1099` |
| `/accessibility?g=<id>` | Accessibility statement (footer link). | `App.tsx:24`, `PhotoGallery.tsx:1199-1201` |
| anything else | `NotFound`: "הדף לא נמצא" / "בדקו את הקישור שקיבלתם מהסטודיו." | `App.tsx:45-53` |

- Wrong/old studio part of the URL: after load, if `studio !== data.slug` → `navigate('/<slug>/<id>', {replace:true})` (`WatchPage.tsx:47-48`).
- The photo gallery and the film gallery share `WatchPage`; `data.kind === 'photos'` picks `PhotoGallery` (`WatchPage.tsx:98-111`).
- Routes other than `WatchPage` are code-split with `React.lazy` (`App.tsx:8-15`); the couple's bundle does not load the studio page, album, faces, print.
- Deep-link state rules: opening a photo **pushes** one history entry (so phone Back closes the photo, not the gallery); moving
  between photos and switching tabs use `replaceState` (no history spam). `popstate` re-reads `set`/`photo` from the address
  (`PhotoGallery.tsx:798-845`).

---

## 2. Load sequence and screens (in order)

`WatchPage.tsx:25-118`

1. **Loading** – `<Loading/>` skeleton (shimmering blocks, sr-only "טוען", no text). Always the DARK variant here (kind not known yet)
   → a dark→light flash before a light photo gallery (`src/lib/Loading.tsx:2-15`, `WatchPage.tsx:93`).
2. **Fetch** `GET /api/watch/:id` (+`?pt=`), `credentials: same-origin`, `Cache-Control: no-store` from server.
   - 4xx → "הקישור לא נמצא" + the server's message (`WatchPage.tsx:83-91`).
   - network/5xx → **Offline** screen: "אין חיבור כרגע" / "לא הצלחנו לטעון את הדף. בדקו את החיבור לאינטרנט ונסו שוב." / button "נסו שוב" (re-fetch) (`Loading.tsx:18-28`).
   - success → `applyAccent(accentColor)` sets `--gold/--gold-2/--gold-dim` on `:root` (`src/lib/accent.ts:15-27`; note: the light photo
     gallery mostly uses its own `--pg-*` design colours, so the studio accent affects only the dark screens: terms, locked button, expired, offline);
     `document.title = "<couple> · <studio>"` (`WatchPage.tsx:51`).
3. **Expired** (checked before password) → `Expired` screen (`src/watch/Expired.tsx:5-27`), dark:
   - logo mark + studio name (gold, spaced caps), h1 **"הגלריה נסגרה"**,
   - "תקופת הזמינות של הגלריה של {couple} הסתיימה ב־{d בMMMM yyyy}. התמונות אינן זמינות יותר לצפייה או להורדה מהקישור הזה."
   - `contactLine` paragraph, `@instagram` link (if set).
   - Server side: every photo returns **410 "הגלריה נסגרה"**; hearts 410 (e2e `gallery.spec.ts:574-580`).
4. **Locked** (gallery password; server returned only names) → `Locked` light card (`src/watch/Locked.tsx:8-49`, CSS `styles.css:555-567`):
   - studio logo (or mark) + name, h1 couple names,
   - "הגלריה פרטית. הקלידו את הסיסמה שקיבלתם מהזוג או מהסטודיו."
   - password input (placeholder "סיסמה", autofocus), button **"כניסה"** (disabled while empty/busy), error `role=alert`.
   - `POST /api/watch/:id/unlock {code}` → HttpOnly cookie, **180 days**, case-insensitive, trimmed (`worker/access.ts:227-238`); then re-fetch.
   - Server errors (quote): "הסיסמה לא נכונה"; "יותר מדי ניסיונות. נסו שוב בעוד רבע שעה." (10 per IP per 15 min); "יותר מדי ניסיונות שגויים לגלריה הזו. נסו שוב בעוד שעה, או פנו לסטודיו." (40 wrong/hour per gallery, all IPs; studio gets a hub notification); "לא ניתן לבדוק את הסיסמה כרגע. נסו שוב בעוד רגע." (`worker/index.ts:1143-1185`).
5. **Terms** (once per device: `localStorage['terms:<id>']`; skipped in `?preview=1`) – `src/watch/Terms.tsx:7-45`, dark card:
   - pill "✦ חדר הקרנה פרטי ✦" (film wording, also on photos), h1 "ברוכים הבאים לגלריה הפרטית שלכם",
   - "הגלריה מיועדת לצפייה ולשימוש אישי, בהתאם לתקנון השירות."
   - notice h2: "⏳ הגישה לגלריה ל־{days} ימים בלבד" or, on the last day, "⏳ הגישה לגלריה עד {היום ב-23:59|מחר ב-23:59} בלבד"
   - notice text: "כחלק ממדיניות האחסון של **{studio}**, הגלריה זמינה למשך **{days} ימים בלבד ממועד קבלת הקישור**. אנו ממליצים בחום להוריד ולגבות את כל התמונות בהקדם (במחשב האישי ובשירות ענן פרטי). בתום תקופת הזמינות הגישה לגלריה תסתיים ולא ניתן יהיה להוריד ממנה את התמונות."
   - checkbox: "קראתי ואני מאשר/ת את [תקנון השירות] והבנתי שעליי לגבות את התמונות באופן עצמאי." — the link opens a modal with the studio's `termsText` (title "תקנון השירות", button "סגור", Esc closes).
   - button "כניסה לגלריה" (enabled after checking). On enter: localStorage flag + `POST /api/watch/:id/terms` (server records time, terms hash, hashed IP, UA, role) (`WatchPage.tsx:60-68`, `worker/index.ts:1934-1954`).
6. **Empty** (photo gallery with 0 visible photos): centered card "התמונות יעלו לכאן בקרוב." (`WatchPage.tsx:99-104`).
7. **PhotoGallery** wrapped in `PinProvider` (download code) (`WatchPage.tsx:106-110`).

Views: one `POST /api/watch/:id/event {type:'view'}` per page load per id, fired as soon as photos would show (after terms, at the
cover – not on "צפייה בגלריה"), never in preview (`WatchPage.tsx:76-81`, `src/lib/events.ts:13-19`). Server ignores the studio's
own visits and people without the password, rate-limits 30/hour/IP, counts guests' views separately as `guest_view`
(`worker/index.ts:1920-1932`; e2e `gallery.spec.ts:1510-1562`).

---

## 3. Data the page receives (`GET /api/watch/:id`)

Types: `src/watch/types.ts:27-100`. Built in `worker/index.ts:1097-1137` + `worker/photos.ts:785-797`.

```
WatchData {
  id, kind:'photos', role:'couple'|'guest', slug,
  coupleName, date ('YYYY-MM-DD' or free text), venue, expiresAt (ISO), daysLeft, expired,
  studioName, logoUrl, accentColor ('' = default gold), termsText, contactLine, instagram,
  locked?, downloadLocked?,          // password not typed / download code needed
  linked: {kind:'films', path} | null // the couple's film gallery (couple only)
  guestPath: '/<slug>/<guestId>'     // couple only
  favorites: string[]                // keys hearted by anyone (order first hearted)
  favBy: { [key]: string[] }         // who hearted ('' = no name)
  insta: string[]                    // Instagram marks
  lists: {id, name, keys[]}[]        // personal lists (max 20)
  photos: {
    sets: {id, name}[]               // only sets that have ≥1 visible photo, studio order
    items: {key, name, set, ar}[]    // ALL visible photos, final order; ar default 1.5; no file paths
    cover: key                       // chosen cover or first photo
    coverPos: {x, y}                 // focal point % (default 50/50)
    base: '/api/photos/<id>/v<gen>'  // <gen> changes when files change → 1-year browser cache safe
    recommended: 150                 // constant RECOMMENDED (worker/photos.ts:24)
    music: '/api/music/<tenant>/<song>' | ''   // slideshow song
    faceSearch: boolean, cloudOff?: true,
    design: {cover, font, color, grid, thumb, spacing, nav}
  }
}
```
- Guests: `favorites/favBy/insta` empty, no `lists`, no `guestPath`, `linked: null`, id = guest id (`worker/index.ts:1132`).
- Locked (password): only `{id, kind, coupleName, date, venue, studioName, logoUrl, accentColor, expired, daysLeft, slug, locked, role}` (`worker/index.ts:1112-1117`).
- `folderDownloadUrl` is ALWAYS '' for photo galleries (the cloud folder holds hidden photos) – so the ZIP dialog's "cloud" button never appears for photos (`worker/galleries.ts:466-474`).

---

## 4. The cover (hero)

`PhotoGallery.tsx:1029-1058`; CSS `styles.css:409-420, 725-779`.

- Full-viewport section (`height: 100dvh`; 62vh in preview). Background = `url(<base>/<cover>?s=l)` (2048px preview) as CSS
  background, `background-position` = studio's focal point `coverPos` (`--cv-pos`). Not lazy, no srcset.
- Gradient shade over the photo (dark top 25% → clear → 55% dark bottom).
- Content (bottom-centred by default, `padding-bottom: 12dvh`):
  - brand: `<img src=logoUrl height 28>` or the default `LogoMark` svg, + studio name (caps, letter-spacing .3em, 0.72rem),
  - h1 couple name (design title font, `clamp(2.6rem, 8vw, 5rem)`, `text-wrap: balance`),
  - date line: `formatDate(date)` → "18.9.26" (`src/lib/format.ts:4-8`) + " · " + venue (letter-spacing .25em),
  - button **"צפייה בגלריה"** (outlined, square corners, uppercase tracking),
  - if linked films: ghost button **"לסרטים שלכם"** → films gallery path.
- Clicking "צפייה בגלריה" un-hides the gallery body (`display:none` until then) and smooth-scrolls to it (`PhotoGallery.tsx:1014-1017`).
  If the URL already has `set=`/`photo=` (or preview), the body is shown and scrolled to on mount (`PhotoGallery.tsx:744, 1019-1022`).
- 10 cover styles (`shared/design.ts:4,27-38`; CSS `styles.css:725-770`): center (default), side, novel (text half / photo half),
  vintage (photo top, names under), frame (inner 1px frame), stripe (names between two lines), divider (vertical line), journal
  (photo in a box), stamp (small photo centered), outline (names in a thin box). novel/vintage/journal/stamp are "light covers"
  (page colours, no shade). Phone overrides at ≤700px (`styles.css:762-770`).

### Gallery design (per gallery, studio default, built-in default)
`shared/design.ts` – `Design = {cover, font, color, grid:'rows'|'columns', thumb:'regular'|'large', spacing:'regular'|'large', nav:'text'|'icons'}`,
default `{center, modern, light, rows, regular, regular, text}` (line 25). Colours (line 51-61, bg/surface/ink/muted/line/accent):
light #ffffff… accent #2f2d2a; gold, rose, terracotta, sand, olive, agave, sea, dark (#141414). Fonts (line 41-48, all with Hebrew):
sans=Assistant 600, serif=Frank Ruhl Libre 400, modern=Cormorant Garamond 300 (default), timeless=Bellefair, bold=Secular One,
subtle=Heebo 200 (tracking .18em). Applied as CSS vars on `.pg` (`designVars`, line 85-99); the chosen Google Font is injected
only when used (`PhotoGallery.tsx:652-661`). Heart colour fixed `--pg-heart: #e0506b` (`styles.css:409`).

---

## 5. Top bar, tabs and banners (after "צפייה בגלריה")

`PhotoGallery.tsx:1060-1197`; CSS `styles.css:421-433, 471-482`.

Sticky bar (blurred, 94% page colour, bottom border). Desktop = 3 columns: **title** (couple name in title font + studio name caps) |
**tabs** centred, horizontally scrollable | **actions**.

Tabs (`pg-tabs`): "הכל" · one per set (studio's preset order: טיזר, התארגנות, צילומי חוץ, משפחות, אולם, טקס חופה, מסיבה, בחירת אלבום – `shared/photosets.ts:3`) ·
couple only: one per personal list "☆ {name} {count}" (accent colour). Active tab = underline. Switching tab clears any selection.

Actions (each is a pill; text hidden when `design.nav === 'icons'`, `styles.css:772-773`):

| Button | Who | Text / behaviour |
|---|---|---|
| ♥ {n} | couple | toggles the favourites tab; heart filled if n>0 |
| Instagram icon {n} | couple | toggles the Instagram tab; title "התמונות שסימנתם לאינסטגרם" |
| face icon "מצאו את התמונות שלי" | if `photos.faceSearch` and (guest or guestPath) | → `<guestPath>/me` (always via the GUESTS' link, so a shared page never leaks the couple link) |
| film icon "הסרטים" | couple with linked films | → films gallery |
| book icon "עיצוב האלבום" | couple | → `<current path>/album` |
| share icon "שתפו עם האורחים" | couple with guestPath | see §11 |
| check icon "בחירה" / "סיום בחירה" | everyone | multi-select mode (§8) |
| play icon "מצגת" | everyone; disabled when the tab is empty | slideshow of the CURRENT tab (§7) |
| download icon "הורדה" | everyone | ZIP dialog (§10) |

Phones (≤760px, `styles.css:471-482`): row 1 names (ellipsis) + studio, row 2 the action pills in ONE row that scrolls sideways
(scrollbar hidden), row 3 the tabs (scroll), lightbox arrow buttons hidden.

Banners under the bar:
- Expiry (`PhotoGallery.tsx:1131-1135`, `src/lib/expiry.ts`):
  - `daysLeft > 7`: muted line "הגלריה פתוחה לעוד {N} ימים" (from `availabilityText(...).replace('זמין','פתוחה')`).
  - `daysLeft ≤ 7`: orange warning, `role=alert`: "⚠ הגלריה נסגרת {closingLabel}. הורידו עכשיו את התמונות שתרצו לשמור." where
    closingLabel = "היום ב-23:59" / "מחר ב-23:59" / "בעוד N ימים" (Israel calendar days; galleries close 23:59 Asia/Jerusalem; older ones at creation hour – `expiry.ts:8-16`, `shared/day.ts`).
- Cloud disconnected (`photos.cloudOff`, Dropbox token gone): warning `role=alert` "התמונות לא זמינות כרגע: החיבור של הסטודיו לאחסון התמונות נותק. פנו לסטודיו." (`PhotoGallery.tsx:1136-1140`).
- Install hint (phones only, §13).
- Couple with guest link: "הקישור הזה אישי לכם (לבחירת תמונות ולאלבום). לאורחים שלחו את "שתפו עם האורחים"." (`PhotoGallery.tsx:1142`).
- Open personal list header: "☆ {name}" · "{n} תמונות · רשימה אישית, לא נכנסת לאלבום" · links "שינוי שם" (window.prompt "שם חדש לרשימה:") · "מחיקת הרשימה" (window.confirm "למחוק את הרשימה "{name}"? התמונות עצמן נשארות בגלריה.") (`PhotoGallery.tsx:1144-1155, 946-964`).
- Select mode hint: "לחצו על התמונות שתרצו לבחור. במחשב: Shift+לחיצה בוחרת טווח."
- Favourites tab with named hearts: people filter chips "כולם" · names (Hebrew-sorted) · "ללא שם" (`PhotoGallery.tsx:1157-1168`).

Empty states (`PhotoGallery.tsx:1169-1176`):
- favourites filtered by person, none: "אין כאן לבבות."
- favourites empty: "עוד לא סימנתם תמונות. לחצו על הלב שעל התמונה כדי להוסיף אותה לבחירה שלכם."
- list empty: "הרשימה ריקה. בחרו תמונות ("בחירה" למעלה) והוסיפו אותן, או לחצו 3 בזמן צפייה בתמונה."
- Instagram empty: "כאן יופיעו התמונות שתרצו שנעלה לאינסטגרם. לחצו על סמל המצלמה שעל תמונה כדי לסמן אותה."
- Instagram non-empty note above grid: "סימנתם {n} תמונות לאינסטגרם. הסטודיו רואה את הבחירה שלכם."

Footer: link "הצהרת נגישות" → `/accessibility?g=<id>` (`PhotoGallery.tsx:1199-1201`).

Toast (`pg-toast`, dark pill above the bottom bar, `role=status`, auto-hides after 4s – `PhotoGallery.tsx:750-754, 1253-1257`):
used for every success/error message (server error texts are shown verbatim).

---

## 6. The grid

### 6.1 Layout algorithm — justified rows (default, `design.grid === 'rows'`)
`src/photos/justify.ts:8-27` (identical in ORIG):
```
for each photo (ar = width/height, default 1.5 if missing/0):
  add to row; sum += ar
  if sum*target + gap*(n-1) >= containerWidth:
     h = (containerWidth - gap*(n-1)) / sum      // row height, fills the width exactly
     each photo: width = ar*h, height = h
     start new row
last (incomplete) row: height = target, width = ar*target  (NOT stretched; starts at the inline-start = right in RTL)
```
Rows render as flex rows with `gap` and `margin-bottom: gap` (`PhotoGallery.tsx:472-480`). Cells crop with `object-fit: cover` (exact
ar so no visible crop). Because rows close as soon as they reach the width, row heights are ≤ target (between ~target/2 and target).

### 6.2 Columns ("Vertical", `design.grid === 'columns'`)
`shared/design.ts:113-125`: fixed column count, equal column width `(W - gap*(c-1))/c`, each photo goes to the currently shortest
column (ties → the first), columns placed **right to left**, cells absolutely positioned (`.pg-grid.cols`).

### 6.3 Sizes / breakpoints (`gridMetrics`, `shared/design.ts:102-110`)
Breakpoints use the **grid container width** (ResizeObserver, `PhotoGallery.tsx:362-371`), not the viewport:

| container width | target row height (regular / large) | columns (regular / large) | gap regular / large spacing |
|---|---|---|---|
| < 600 ("phone") | 170 / 260 px | 2 / 1 | 4 / 10 px |
| 600–1099 ("tablet") | 240 / 340 px | 3 / 2 | 8 / 22 px |
| ≥ 1100 | 300 / 420 px | 4 / 3 | 8 / 22 px |

Page side padding `clamp(0.5rem, 3vw, 2.5rem)` (`.pg-body`, `styles.css:420`).

### 6.4 Cell
`PhotoGallery.tsx:420-462`; CSS `styles.css:435-452, 521-524, 694-700`.
- A `<button class=pg-open>` wrapping `<img src="<base>/<key>?s=m" srcset="…?s=m 640w, …?s=md 1024w" sizes="<cellWidth>px" loading="lazy" decoding="async" alt="">`.
  Accessible name on the button: "תמונה {i} מתוך {N} · {set name}".
- Placeholder: shimmering gradient (1.6s) until `onload` adds `.in` (fade-in 0.35s); `onerror` adds `.broken` → no shimmer, a faint
  "broken picture" glyph (P66). Hover: image scale 1.02. `prefers-reduced-motion` disables shimmer.
- Overlays (couple only, hidden in select mode): heart button top-inline-end (`aria-label "אהבתי"`), Instagram button next to it
  (`title/aria "לאינסטגרם"`). Desktop: visible on hover/focus or when on; touch devices (`hover: none`): always 0.85 opacity.
- In the favourites tab with names: a pill bottom-inline-start "♥ מאי, אמא".
- Select mode: round check top-inline-start; picked = accent outline + image scale .92.
- **No download / share button on grid cells**; download is only in the viewer, the select bar, or the ZIP dialog.

### 6.5 Loading strategy / pagination
- **No pagination, no infinite scroll.** The full list arrives in the first JSON (server cap `MAX_PHOTOS = 20_000`, `worker/photos.ts:29`).
- Native `loading="lazy"` on each image.
- **Windowing** above 200 photos (`WINDOW_FROM = 200`, `BUFFER = 1600`, `PhotoGallery.tsx:318-321, 391-418, 463-470`): the grid gets
  its full computed height, rows/cells are absolutely positioned and only those within [scrollTop − 1600px, bottom + 1600px] are
  rendered; the window is quantized to 400px steps and updated in a `requestAnimationFrame`-throttled passive scroll listener.

### 6.6 Image sizes (server)
`/api/photos/<id>/v<gen>/<key>?s=<size>` (`shared/photoUrl.ts:8-20`, `worker/photos.ts:861-866`):

| size | used for | Dropbox / Drive / pCloud thumbnail param |
|---|---|---|
| `m` | grid (default) | `w640h480` / `w800` / `640x480` |
| `md` | grid on sharp screens/big cells (srcset 1024w); WhatsApp card | `w1024h768` / `w1200` / `1024x768` |
| `l` | cover background, viewer, slideshow, "small" downloads | `w2048h1536` / `w2048` / `2048x1024` |
| `full` | originals ("איכות מלאה", "תמונה מקורית") — needs the download code if one is set; returns the largest copy of the same photo | original file |

`&dl=1` → `Content-Disposition: attachment` with the original file name (`worker/photos.ts:871-881`). Previews: `Cache-Control: public,
max-age=31536000, immutable` when the address has the current `v<gen>` (else 1 day), plus Cloudflare edge cache; `full`/downloads:
`private, max-age=3600` and never edge-cached (`worker/photos.ts:902-908, 987`). HEIC / >20MB on Dropbox → 415
"לתמונה הזו אין תצוגה מקדימה (HEIC או קובץ גדול מ-20MB). אפשר להוריד אותה באיכות מלאה." (grid shows the broken glyph).

**When does full-size load?** Never automatically. Grid = m/md, viewer = l (2048px, with m as instant placeholder), zoom enlarges
the l image (no full-res tiles). Full only on explicit download or the "תמונה מקורית" link.

---

## 7. Viewer (lightbox) and slideshow

### 7.1 Lightbox — `PhotoGallery.tsx:158-316` (+ `ZoomImage` 60-156); CSS `styles.css:459-470, 483-494, 713-723`
- Full-screen fixed dark (#0c0b0a) `role=dialog aria-modal`, aria-label "תמונה {i} מתוך {N} · {set}"; body scroll locked while open.
- Focus trap / Esc / focus return via `useDialog` (`src/lib/dialog.ts:13-51`); initial focus on the close button.
- Top bar: counter "**{i} / {N}**" (aria-hidden) on one side; on the other: heart (couple), Instagram (couple), download menu (§10.1),
  text link **"תמונה מקורית"** → `?s=full` in a new tab (hidden while the download code is needed; NOT counted as a download), close ✕ ("סגירה").
- Image: `src=?s=l`, CSS `background-image: ?s=m` (the already-cached grid preview shows instantly underneath),
  `width: min(94vw, calc(84dvh * ar))`, `aspect-ratio: ar`, `max-height: 84dvh`. No caption, no file name, no EXIF shown.
- Neighbours (i±1) preloaded at `?s=l` via `new Image()` (`PhotoGallery.tsx:229-232`).
- Navigation:
  - Keys (RTL): **ArrowLeft = next, ArrowRight = previous**; ignored in inputs or with Cmd/Ctrl/Alt (`PhotoGallery.tsx:200-228`).
  - Buttons: round chevrons, "previous" on the RIGHT edge, "next" on the LEFT ("התמונה הקודמת" / "התמונה הבאה"); hidden at the ends, while zoomed, and on phones ≤760px.
  - Swipe (single touch, not zoomed): |dx| > 50px; finger moving right (dx>0) = next (`PhotoGallery.tsx:244-250`). No wrap-around.
- Zoom (`ZoomImage`): double-click (desktop) or double-tap (<300ms, <30px) toggles 2.5× centred on the tap point; two-finger pinch
  1×–4×; one-finger pan while zoomed, clamped so no empty edges; snaps back to 1× below 1.05; transition 0.2s; cursor zoom-in/grab.
- Couple keyboard shortcuts: **1** = heart, **2** = Instagram, **3–9** = toggle in personal list #1–#7 (pressing the next unused number creates a list), **0** = new list with this photo. Hint row at the bottom (desktop only, hidden on coarse pointers): "1 מועדפים · 2 אינסטגרם · 3 רשימה אישית (or 3–N רשימות) · 0 רשימה חדשה".
- Couple: a row of list chips under the top bar: "{kbd} ★/☆ {list name}" per list + dashed "0 + רשימה חדשה".
- If the open photo leaves the current list (e.g. un-hearting inside the favourites tab), the neighbour takes its place; if the list
  becomes empty the viewer closes and the page scroll is restored (`PhotoGallery.tsx:768-772, 822-829`; e2e `gallery.spec.ts:1532-1540`).
- Closing: ✕, Esc, or Back (pops the pushed history entry).

### 7.2 Slideshow — `src/photos/Slideshow.tsx:13-143`; CSS `styles.css:536-552`
- Plays the photos of the **current tab** (`shown`), starting at the first, looping forever (modulo).
- Auto-advance every **5 s** by default; speed select "3 שניות / 5 שניות / 8 שניות". The timer is purely time-based (does not wait for the image to load).
- Cross-fade between two stacked `<img>` layers, opacity transition **1.2 s** (none with reduced motion); `object-fit: contain` on black; `?s=l` with `?s=m` as background placeholder; next 2 photos preloaded at `l`.
- **Music**: `<audio src=photos.music loop preload=auto>` — the studio's song (per gallery choice → studio default → silent `''`). Plays/pauses with the slideshow; ♪ toggle ("השתקת המוזיקה"/"הפעלת המוזיקה"); if autoplay is blocked, sound switches off. Songs are uploaded by the studio, streamed with Range from `/api/music/<tenant>/<id>` (e2e `gallery.spec.ts:609-628`).
- Requests browser fullscreen and a Screen Wake Lock; both released on close.
- Controls: top gradient bar (title = couple names in Cormorant, counter "i / N", close "סגירת המצגת"); bottom: "›" previous, play/pause "❚❚"/"▶" ("השהיה"/"הפעלה"), "‹" next, speed select, ♪. Controls + cursor fade after **2.5 s** idle while playing; mouse move/touch wakes them.
- Keys: Space = play/pause, ArrowLeft = next, ArrowRight = previous, Esc = close. No swipe.

---

## 8. Selection, favourites, Instagram, personal lists

### 8.1 Favourites ("hearts")
- **Stored on the server**, per gallery, per photo, per **person name**: `POST /api/watch/:id/fav` with `{key, on, who}` or `{keys:[…≤500], on, who}`;
  answer `{favorites, favBy}` (`worker/index.ts:1869-1882`). Couple link only (guests 403 "הקישור לאורחים מיועד לצפייה ולהורדה בלבד"); closed → 410; hidden/unknown key → 404; rate limit 1500 marks/hour/IP shared with Instagram & lists ("יותר מדי סימונים בזמן קצר. נסו שוב בעוד כמה דקות.").
- **Shared** between bride, groom, mom… — everyone with the couple's link sees and edits the same set, on any device (it's server state; no realtime push: other devices' hearts appear on reload, or when a resync happens, §8.5).
- **Who is hearting** – asked once per device on the first heart: dialog **"מי מסמן?"** — "כך תראו מי בחר כל תמונה (למשל הכלה, החתן או אמא). כל הלבבות נכנסים לאלבום." — chips of names already used, input "השם שלכם" (max 30), buttons "שמירה" / "בלי שם" (= '' anonymous). Stored in `localStorage['fav-who:<id>']` (`PhotoGallery.tsx:570-614, 668-674, 965-979`). Can be changed later from the bottom bar link.
- Tapping a heart toggles **only this person's** heart; a photo is a favourite while anyone hearts it (`PhotoGallery.tsx:980-1000`).
- **Bottom bar** (fixed pill, hidden for guests and in select mode) – `favMessage` (`PhotoGallery.tsx:41-45, 1245-1252`):
  - n < 150: "♥ בחרתם {n} · מומלץ 150 לאלבום"
  - n = 150 (gold): "♥ בחרתם 150 · הגעתם להמלצה לאלבום"
  - n > 150 (amber): "♥ בחרתם {n} · מעבר ל-150 תמונות ייתכן חיוב בדפים נוספים"
  - plus link "מסמנים בשם {who} · החלפה" (or "מי מסמן?" if they chose no name).
  - 150 is a server constant (`RECOMMENDED`), not per studio/package. **No hard limit** on the number of favourites.
- **Favourites tab** (`?set=favorites`): only hearted photos; people filter chips; names shown on each photo.
- **No "send my selection to the studio" step** in this page. The studio sees hearts (with names) live in its admin; the formal
  "submit" happens in the album designer (`/album`, out of scope), which drafts from the hearts. Personal lists never go to the album.

### 8.2 Instagram marks
Separate server list "photos the couple would like the studio to post": `POST /api/watch/:id/insta {key,on}|{keys,on}` →
`{insta}` (`worker/index.ts:1250-1265`). Camera icon on cells/viewer, key 2, its own tab `?set=instagram` with a count. Studio sees it.

### 8.3 Personal lists ("התמונות של אופק", "לשלוח לסבתא")
Server-side, couple only, max **20** per gallery (`worker/store.ts:636`), name ≤40 chars. `POST /api/watch/:id/lists {name, keys}`,
`PUT …/lists/:list {name}|{keys, on}`, `DELETE …/lists/:list` (`worker/index.ts:1289-1326`). Not part of the album; downloadable as a ZIP.
Dialog (`PhotoGallery.tsx:523-567`): title "לאיזו רשימה?" / "{n} תמונות לאיזו רשימה?" / "רשימה אישית חדשה"; text "רשימה אישית, למשל "התמונות של אופק" או "לשלוח לסבתא". היא לא נכנסת לאלבום, ואפשר להוריד אותה בבת אחת."; existing-list chips "☆ {name} ({count})"; input "שם לרשימה חדשה"; "יצירת רשימה" / "ביטול".
Toasts: "{n} תמונות נוספו לרשימה "{name}"", "נוצרה הרשימה "{name}" עם {n} תמונות". Errors: "צריך שם לרשימה", "אפשר עד 20 רשימות בגלריה", "הרשימה לא נמצאה".

### 8.4 Select mode ("בחירה")
Everyone (guests too). Tap = pick, Shift+click = range (`PhotoGallery.tsx:780-797`). Bottom toolbar (`role=toolbar`,
"פעולות על התמונות שנבחרו", `PhotoGallery.tsx:1202-1244`): "נבחרו {n}" / "בחרו תמונות" · "בחירת כל {N}" / "ביטול הכל" · couple:
"♥ למועדפים" (or "הסרה מהמועדפים" in the favourites tab) · "📷 לאינסטגרם" (or "הסרה מאינסטגרם") · "☆ לרשימה…" (or "הסרה מהרשימה" inside a list) ·
everyone: "⬇ הורדה" (ZIP of the picked photos, group label "התמונות שבחרתם") · "סיום". Toasts: "{n} תמונות נוספו למועדפים" / "…הוסרו מהמועדפים" / "…סומנו לאינסטגרם" / "…הוסרו מאינסטגרם".

### 8.5 Optimistic updates and consistency (`src/photos/favState.ts`, tests `test/fav-state.test.ts`)
Hearts and Instagram marks change instantly on tap; each request gets a sequence number. `FavState` keeps "server state + pending
changes": an older answer never overwrites a newer one; a failed request rolls back only its own photos; if answers came back out of
order, or a request failed, the page re-reads `GET /api/watch/:id` once (coalesced) to show what the server really has
(`PhotoGallery.tsx:710-737`; e2e `gallery.spec.ts:1564-1590`). Lists use simple optimistic update + rollback (`PhotoGallery.tsx:912-922`).

---

## 9. Access: password, download code, guests, studio preview

- **Gallery password** – §2 step 4. Also hides the WhatsApp card image. Same password works on the guests' link.
- **Download code (PIN)** – if set, `downloadLocked: true`: previews (m/md/l) are free; only **originals (`?s=full`)** need the code
  (server 403 "להורדה באיכות מלאה צריך את קוד ההורדה מהסטודיו"). `usePin()` (`src/watch/Locked.tsx:51-83`) opens the PIN dialog
  the first time a full-quality download is requested (single photo "איכות מלאה" or ZIP "איכות מלאה"); "small" downloads never ask.
  Dialog (`Locked.tsx:85-124`): title **"קוד הורדה"**, "להורדה באיכות מלאה צריך את הקוד שקיבלתם מהסטודיו. מקלידים פעם אחת, והמכשיר זוכר.",
  input "הקוד", "אישור" / "ביטול"; error "הקוד לא נכון". `POST /api/watch/:id/pin` → cookie **30 days**; page re-fetches (the "תמונה מקורית" link then appears).
- **Guests' link** (`role: 'guest'`): view, slideshow, select, single + ZIP download (subject to the code), face-search entry. No hearts,
  Instagram, lists, album, share, favourites bar, films link; never sees the couple's id (e2e `gallery.spec.ts:752-764`).
- **Studio "open as the couple"** (`?pt=`): no password, no code, not counted as a view; terms still shown once.

---

## 10. Downloads

### 10.1 Single photo — viewer only (`DownloadMenu`, `PhotoGallery.tsx:1346-1459`; CSS `styles.css:484-494`)
Menu (dropdown under the icon; on ≤640px a bottom sheet):
- **"איכות מלאה"** — "הקובץ המקורי, להדפסה ולשמירה"
- **"איכות רגילה"** — "קובץ קטן ומהיר, לוואטסאפ ולרשתות"

Behaviour:
- Computer + full: ensure PIN → probe `GET ?s=full` with `Range: bytes=0-0` (so a failure doesn't navigate away from the gallery) →
  on 403 shows the server's reason, else "ההורדה לא הצליחה. נסו שוב." → on success a temporary `<a href="?s=full&dl=1" download>` click (native browser download, no memory use).
- Small (any device): fetch `?s=l`, re-encode in a canvas to JPEG q=0.9, long side ≤ **2048px** (`smallCopy`, line 1303-1323), name `<stem>-small.jpg`.
- Phone (`pointer: coarse` + `navigator.canShare({files})`): fetch the blob ("מכינים את התמונה…"), then a big button
  **"שמירה בגלריה של הטלפון"** + hint "בחלון שנפתח בחרו "שמירת תמונה" (Save Image)." → `navigator.share({files})` (must be a direct tap for iOS); fallback = blob download.
- Server-side failure when a `dl=1` link is opened as a page: an HTML page "ההורדה לא הצליחה" + reason + "חזרה לגלריה" (`worker/photos.ts:848-853`).
- Each successful single download sends one `download` event (§12).

### 10.2 ZIP dialog — `src/photos/ZipDialog.tsx`, `src/photos/zip.ts`
Opened from the bar's "הורדה" (and select bar). Title **"הורדת תמונות"**.
- "מה להוריד" radio groups, only non-empty ones (`zipGroups`, `PhotoGallery.tsx:507-520`), in this order:
  open list → `הרשימה "{name}"`; open set → `הסט "{name}"`; `המועדפים` (if any); `כל הגלריה`. In the favourites tab, favourites first.
  Each with a count "({n})". From the select bar: a single group "התמונות שבחרתם".
- "איכות": "איכות מלאה · הקבצים המקוריים, להדפסה ולשמירה" (`?s=full`, needs PIN) / "איכות רגילה · קבצים קטנים ומהירים, לטלפון ולרשתות" (the **`?s=l` 2048px preview as delivered — no re-encode**, entries renamed `-small.jpg`).
- Button "⬇ הורדה כקובץ ZIP". (A "הכל מ-{cloud}" button exists in code but is never shown for photo galleries.)
- Engine (`zip.ts:70-172`), all **client-side** with `client-zip` (`downloadZip`), nothing heavy on the server:
  - 4 photos fetched in parallel (`ZIP_PARALLEL = 4`), added in original order; a non-image response or error counts as failed (not added).
  - Chrome/Edge desktop (`window.showSaveFilePicker` exists): "Save as" picker, ZIP **streamed to disk** (any size). Cancel = stop silently.
  - Otherwise (Safari, phones, Firefox): built in memory in **parts of up to 500 MB**, each saved as it completes: `"{name}-part-{k}.zip"` (or `"{name}.zip"` when one part). Hint shown before start when >150 photos, full quality and no streaming: "ההורדה תגיע בכמה קבצים (עד 500MB כל אחד). כדאי להוריד מהמחשב, בכרום."
  - ZIP file name: **`"{coupleName} - {group label}.zip"`** (e.g. "מאי & אופק - המועדפים.zip").
  - Entry names (`zipNames`, `zip.ts:38-57`, tests `test/zip-names.test.ts`): the photo's own file name with `\/:*?"<>|` → `_`; duplicates (case-insensitive) become "name (2).jpg", never colliding with another photo's real name; small = stem + `-small.jpg`. No folders inside the ZIP (sets are not sub-folders).
- Progress (`role=status`): `<progress>` + "{done} מתוך {total} תמונות · {MB|GB}" (+ " · חלק {k}" in parts mode), "אפשר להמשיך לגלול בגלריה. אל תסגרו את הדף עד שההורדה מסתיימת.", button "עצירה" (AbortController). Backdrop click is ignored while running.
- Done: "✓ ירדו {n} תמונות" (+ " ({f} לא הצליחו, אפשר לנסות שוב)"). Error: "ההורדה לא הצליחה. בדקו את החיבור ונסו שוב."
- One `download` event per ZIP when at least one photo succeeded.

Per-set download: yes (open the set tab → the dialog offers that set). All-gallery: yes. Favourites/list/selection: yes.

---

## 11. Sharing

Only one share action: **"שתפו עם האורחים"** (couple, when a guests' link exists) — `PhotoGallery.tsx:691-704`:
- Phones (`pointer: coarse` + Web Share): `navigator.share({title: "התמונות מהחתונה של {couple}", url: <origin><guestPath>})`.
- Else: copies the URL; toast "הקישור לאורחים הועתק. אפשר להדביק אותו בקבוצת הוואטסאפ."; on failure toast "הקישור לאורחים: {url}".
No per-photo share, no social buttons, no "copy link to this photo" button (the address bar holds `?photo=`).

### 11.1 Link preview card (WhatsApp/Facebook/iMessage) — `worker/pages.ts`
Worker intercepts exactly `/(watch|<anything>)/<16hex>` (no sub-paths) and rewrites `index.html` with HTMLRewriter (`pages.ts:27, 113-151`):
- `<title>` and `og:title`: "{couple} · {d.m.yy} · {venue}" (parts omitted if empty).
- `description`/`og:description`: "גלריית התמונות · {studio}" (gallery's own studio name override wins).
- `og:image`: the saved cover photo at `?s=md` (1024px) with `v<gen>` (absolute URL); **none** when password-protected; `twitter:card` summary_large_image / summary.
- Closed gallery: description "הגלריה נסגרה", no image. Trashed gallery / blocked studio / studio without the photos module: plain page, no card.
- `og:type website`, `og:url`, `og:locale he_IL`; robots `noindex, nofollow` kept (galleries never indexed); `Cache-Control: no-store`.
- Guests' link gets the same card (never shows the couple's id).
- Also adds `<link rel=manifest href=/api/manifest/<id>>`, `apple-touch-icon` = studio logo (or `/favicon.svg`), `apple-mobile-web-app-title` = couple, `apple-mobile-web-app-capable`.

---

## 12. Analytics events

`src/lib/events.ts`; server `worker/index.ts:1920-1932`. Best-effort `POST /api/watch/:id/event {type}`:
- `view`: once per page load per link id when photos would show (§2). Guests → `guest_view`.
- `download`: once per single-photo download (full or small) and once per ZIP (≥1 success). Id is parsed from the photo base URL (so a guest's download counts on the guests' id → same gallery).
- Not counted: "תמונה מקורית" link opens, slideshow plays, lightbox opens, hearts (hearts are their own data).
- Server: only people who may open the gallery, never the studio, max 30 events/hour/IP/gallery, silently ignored after.
No third-party analytics, no per-photo view stats.

---

## 13. "Install app" (home screen) hint — `src/lib/InstallHint.tsx`
- Shown only on phones (`pointer: coarse`), not already standalone, not dismissed (`localStorage['install-hint:<id>']`). Light variant in the photo gallery (under the expiry line).
- Android/Chrome: captures `beforeinstallprompt` → underlined button "הוסיפו את הגלריה למסך הבית" → native prompt, then hides.
- iPhone/iPad Safari only: text "לשמירת הגלריה במסך הבית: לחצו על **שיתוף** ⬆︎ ואז **"הוספה למסך הבית"**."
- Other browsers: nothing. Close "×" ("סגירה") hides it for this gallery on this device.
- Per-gallery manifest (`worker/pages.ts:157-180`): name "{couple} · {studio}", short_name = couple (≤24 chars), `id/start_url/scope` = `/<slug>/<id>` (or `/watch/<id>`), `display: standalone`, `dir: rtl`, `lang: he`, photos: `background_color`/`theme_color` `#ffffff`; icon = studio logo (`sizes: any`) or `/favicon.svg`; `Cache-Control: private, max-age=300`.

---

## 14. Accessibility

- **There is no accessibility menu/toolbar widget.** Only a statement page (`src/Accessibility.tsx`) linked from the footer, with the
  studio's own name/accent/contacts (`/accessibility?g=<id>` reads `GET /api/watch/<id>`). Title "הצהרת נגישות"; claims ת"י 5568 / WCAG 2.0 AA;
  sections "מה עשינו", "מה עוד לא מושלם", "נתקלתם בבעיה?" (phone, Instagram, contactLine, or "דרך פרטי הקשר שקיבלתם מהסטודיו."), "ההצהרה עודכנה בספטמבר 2026."
  **Gap:** Studio Plan's statement text speaks only about films (watch/download films, chapters, no subtitles); the original's photo bullets were dropped (see §17).
- In the page: every dialog uses `useDialog` (focus moves in, Tab trapped, Esc closes the top-most only, focus returns) (`src/lib/dialog.ts:13-51`);
  buttons have Hebrew aria-labels; `aria-pressed` on hearts/marks/tabs-like toggles; screen-reader name per photo "תמונה i מתוך N · set";
  `role=alert` on warnings, `role=status` on toasts/progress; visible `:focus-visible` outlines everywhere (`styles.css:440, 450, 501-506, 550, 705, 722`);
  `prefers-reduced-motion` turns off shimmer and fades; `<html lang="he" dir="rtl">`.

---

## 15. Mobile vs desktop differences (collected)

| Area | Phone | Desktop |
|---|---|---|
| Grid | container <600px: rows 170px (2 columns in columns mode), gap 4 | 300px rows / 4 columns, gap 8 |
| Top bar | 3 stacked rows, actions scroll sideways (≤760px) | one row, 3 columns |
| Grid hearts / Instagram | always visible (0.85) | on hover/focus |
| Viewer arrows | hidden; swipe; double-tap & pinch zoom | arrows + keys; double-click zoom; key hints shown |
| List key numbers / hints | hidden (`pointer: coarse`) | shown |
| Single download | blob → share sheet "שמירה בגלריה של הטלפון" | native file download (full) / blob save (small) |
| Download menu | bottom sheet (≤640px) | dropdown |
| ZIP | in-memory 500MB parts | Chrome/Edge: streamed to one file via Save-as |
| Share guests | Web Share sheet | copy to clipboard + toast |
| Install hint | shown | never |

---

## 16. Performance tricks

- Route code-splitting (`React.lazy`) so the couple's page does not ship the studio/album/faces/print code (`App.tsx:6-15`).
- One JSON for everything (no per-set requests); `no-store` on it.
- Grid: `loading=lazy`, `decoding=async`, `srcset` m/md with exact `sizes`, windowing >200 photos (±1600px, 400px steps, rAF).
- Image URLs versioned with `v<gen>` → `immutable` 1-year browser cache + Cloudflare edge cache per gallery/visible-version/gen/size.
- Viewer: m placeholder under l; neighbours preloaded; slideshow preloads next 2.
- ZIP: 4 parallel fetches, streaming to disk where possible.
- Fonts: Assistant + Frank Ruhl preloaded non-blocking (`index.html:13-24`); the design font injected only when chosen.
- **No service worker / offline cache**; no prefetching of other sets.
- Static assets (`/assets/*`) served directly by Cloudflare assets; gallery paths go through the Worker for the OG card (`wrangler.jsonc` `run_worker_first`).

---

## 17. Studio Plan vs the original (ORIG `src/photos`, `src/watch`, `worker/pages.ts`)

Studio Plan **added** (not in ORIG):
- `favState.ts`: sequenced optimistic hearts/marks with partial rollback and one resync read (ORIG did naive optimistic + full rollback).
- Viewer tracks the open photo by key; closes/moves when the photo leaves the list; releases scroll lock when nothing is shown.
- `onError` → broken-photo glyph instead of endless shimmer.
- `cloudOff` banner; expiry wording by Israel calendar day ("היום/מחר ב-23:59") in banner and terms (ORIG: "מחר" / "בעוד N ימים" from daysLeft).
- Download counting (`countPhotoDownload`) for single and ZIP downloads; one view per visit for photo galleries; guest views apart.
- Full-quality probe (Range 0-0) before navigating to the download (ORIG did `window.location.href = …&dl=1`).
- ZIP: 4 parallel fetches (ORIG sequential), non-image responses rejected, collision-proof entry names.
- Studio accent colour applied; studio-slug canonical redirect; `?pt=` preview token handling; design `postMessage` accepted from the parent frame of any origin but sanitized with `cleanDesign` (ORIG: same-origin only, unsanitized).
- Face-search link goes through the guests' link.
- Logo is a URL (`logoUrl`) instead of a data URL.

Studio Plan **dropped / regressed**:
- Accessibility statement lost the photo bullets (keyboard arrows on photos, screen-reader description of photos, pinch zoom, "photos have no content description", album drag note) — now films-only text.
- WhatsApp cards for sub-pages `/…/me`, `/…/album`, `/…/order` (ORIG gave each its own description) — now only the gallery root gets a card.
- No `/order` route at all (ORIG `src/order`, album order wizard) — not linked from the photo page in either app.
- CSS for `.pg-notme` ("לא אני" button used by the guest face-search grid) is missing in SP `styles.css` (present in ORIG) → that button renders unstyled inside an `overflow:hidden` cell and is probably invisible (side-finding, face search is out of scope).
- Stale header comment in SP `PhotoGallery.tsx:1-2` says face search is "not here yet" although it is wired.

Identical: `justify.ts`, `Slideshow.tsx`, `Expired.tsx`, `InstallHint.tsx`, `Loading.tsx`, overall layout/texts.

---

## 18. Bugs / oddities noticed (for the rebuild to decide)

1. **Expired + password gallery, not unlocked:** the server's locked payload has no `expiresAt`/`contactLine`/`instagram`, but `Expired` is
   shown first → text reads "…הסתיימה ב־. התמונות אינן זמינות…" with an empty date and no contact (`WatchPage.tsx:94`, `worker/index.ts:1112-1117`, `Expired.tsx:14`).
2. "בחירת כל N" + "♥ למועדפים" / "לאינסטגרם" / list with more than **500** photos sends one request → server 400 "עד 500 תמונות בכל פעם" (`worker/index.ts:1268-1276`, `PhotoGallery.tsx:862-886`). No chunking on the client.
3. The free 2048px previews are downloadable without the download code (by design: "איכות רגילה"), so the code only protects originals.
4. "תמונה מקורית" link isn't counted as a download and bypasses the probe (opens raw `?s=full`).
5. Terms pill says "חדר הקרנה פרטי" (screening room) also for photo galleries.
6. Loading skeleton and Offline screen are dark even for light photo galleries (flash).
7. Slideshow advances on a timer even if the next photo hasn't loaded (comment claims otherwise).
8. In the viewer, the heart shows "on" if anyone hearted (aria-pressed = anyone), while the grid's aria-pressed = "mine"; tapping adds *your* heart, it never removes someone else's — can confuse ("I tapped the red heart and it stayed red").

---

## 19. Test specs that pin this behaviour

- `e2e/gallery.spec.ts`: 408-504 (load folder, hidden photos, hearts by name via API, films↔photos link, module gating, WhatsApp card);
  506-587 (browse sets, open photo, arrows, first heart asks name, small download `-small.jpg`, Back closes viewer, favourites tab and "בחרתם 3 · מומלץ 150 לאלבום", deep link `?photo=`, closed gallery 410 and "התמונות אינן זמינות");
  589-601 (films ↔ photos buttons); 603-704 (two people hearting, people filter, slideshow with song "1 / 30", ZIP of favourites "מאי & אופק - המועדפים.zip", Instagram tab);
  706-776 (password "הסיסמה לא נכונה", download code once, guests view-only, studio preview token);
  1401-1468 (select mode, Shift range, list via keys 3/4/0, ZIP of a list); 1470-1508 (design + live preview); 1510-1562 (last favourite removed closes viewer; view counts); 1564-1590 (failed heart resync).
- Unit: `test/fav-state.test.ts`, `test/zip.test.ts` (non-image rejected, ≤4 parallel and order kept, part split loses nothing, abort), `test/zip-names.test.ts`, `test/expiry.test.ts` (Israel days, wording), `test/pages.test.ts` (card + manifest), `test/photos.test.ts:103-109` (favourites message / 150).

---

## 20. Pages this one links to (out of scope, how)

- **Album designer**: `<Link to="{path}/album">` "עיצוב האלבום" (couple only). It reads the same hearts.
- **Guest face search**: `<Link to="{guestPath}/me">` "מצאו את התמונות שלי" when `photos.faceSearch`. Reuses `Grid`, `Lightbox` and `ZipDialog` exported from `PhotoGallery.tsx` / `ZipDialog.tsx` (`src/faces/GuestPage.tsx:8-9`).
- **Film gallery**: cover button "לסרטים שלכם" and bar "הסרטים" when the studio linked the couple's films gallery; the films hero shows "לגלריית התמונות" back (`src/watch/Hero.tsx:98-102`).
- **Studio design screen (hub)**: iframes `?preview=1` and posts `{type:'pg-design', design}`; the page posts `{type:'pg-ready'}`.
- Print, order wizard, studio page: not linked from the photo gallery.
