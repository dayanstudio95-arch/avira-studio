# 4 — Guest face search ("זיהוי פנים לאורחים") — full spec for a faithful rebuild

Source studied (read only): `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os` (Studio Plan; films Worker at
films.studioplan.co.il + hub) and, for comparison only, `/Users/danieldayan/Downloads/מערכת צפיה וידאו` (the original
standalone Avira films app it was ported from on 2026-09-27).
All paths below are relative to `studio-os/` unless they start with `/`. `FW` = `apps/films-worker`.

---

## 0. One-paragraph summary

A studio switches face search on per photo gallery in the hub. A new browser tab on the films site (the studio's own
computer) downloads every visible photo's large preview, runs **face-api (@vladmandic/face-api 1.7.15, TensorFlow.js,
WebGL→CPU)** with **SSD MobileNet v1 + 68-landmark net + face-recognition net (128-D descriptor)**, and uploads **only
numbers**: per face a box (4×u16) and a 128-number descriptor quantised to int8 (136 bytes/face), in binary "chunks" of
≤120 photos, into a **private Supabase Storage bucket `films-faces`**. A guest opens `<guests' link>/me`, ticks a consent,
takes a selfie with the front camera; **the selfie never leaves the phone** — the phone detects the biggest face, checks
its quality, asks the server for a 10-minute token (consent recorded, rate limited), downloads all chunks (only photos
still shown), and compares locally (Euclidean distance < 0.50; a second "maybe you too" pass from the sure matches
< 0.42). Results: a grid in gallery order, "לא אני" to drop a photo, a personal link `#p=<keys>` that reopens the result
without a selfie, a WhatsApp share, and a ZIP of "my photos". **No ML ever runs on the server.** Face data is deleted
when the studio switches search off, when the gallery is closed/trashed/purged, 12 months after the scan, 30 days after
the studio subscription ends, and photo-by-photo when photos are hidden; a guest can ask the studio to remove them
("הסר אדם זה").

---

## 1. Architecture at a glance

```
HUB (apps/hub, React 18)                        FILMS SITE (FW, Cloudflare Worker + React 19)           SUPABASE
PhotosEditor.jsx › FaceCard                      /<studio>/<id>/faces  (StudioFaces.tsx, studio only)
  [x] זיהוי פנים לאורחים ── PUT …/photos {faceSearch} ──────────────────────────► films_photos.data.faceSearch
  GET /api/admin/galleries/:id/faces (counts) ◄──────────────────────────────── films_faces(+_done)
  "סריקת פנים" → opens new tab ?pt=<preview token>
                                                 GET  /api/watch/:id/faces/scan  → {keys, done, faces, base}
                                                 for each key not done: GET <base>/<key>?s=l (2048px preview)
                                                   → canvas ≤1280px → face-api detectAll (in the STUDIO's browser)
                                                 every 120 photos: POST /api/watch/:id/faces (binary chunk)
                                                                               ──► Storage films-faces/<gid>/<ts>-<rnd>.bin
                                                                               ──► rpc films_faces_add
GUEST PHONE                                      /<studio>/<guestId>/me  (GuestPage.tsx)
  consent ✓ → selfie (capture="user") → face-api detectOne + quality check (ON THE PHONE)
  POST /api/watch/:id/faces/search {consent:'v2'} → {ready, partial, chunks, version, token}  (row in films_face_searches)
  GET  /api/watch/:id/faces/:n?v=<version>  header X-Face-Token, 8 in parallel → filtered bytes (only photos still shown)
  findPerson / expandSearch (ON THE PHONE) → results grid, #p=keys link, WhatsApp, ZIP
Hourly cron (FW worker/cleanup.ts nightly) → films_faces_cleanup_candidates / films_faces_dirty_candidates → delete / rewrite
```

---

## 2. File map (everything face-related)

| Area | File | What |
|---|---|---|
| Shared format + matching | `FW/shared/faces.ts` (208 lines) | binary chunk encode/decode/filter, distance, `findPerson`, `expandSearch`, `#p=` link, constants |
| Browser engine | `FW/src/faces/engine.ts` | lazy face-api load, backend, models from `/models`, `detectAll`, `detectOne`, `toCanvas` |
| Selfie quality | `FW/src/faces/quality.ts` | brightness / sharpness / size / score checks + Hebrew messages |
| Studio scan | `FW/src/faces/faceIndex.ts` | sequential scan, prefetch, retry, upload every 120 photos |
| Studio scan page | `FW/src/faces/StudioFaces.tsx` | progress UI, stop, "הסר אדם זה" |
| Guest download | `FW/src/faces/download.ts` | start search (token), chunk download 8 at a time, page cache |
| Guest page | `FW/src/faces/GuestPage.tsx` | consent, selfie, results, maybe, not-me, WhatsApp, ZIP |
| Routes (SPA) | `FW/src/App.tsx:13-14, 28-29, 34-35` | `/watch/:id/me`, `/watch/:id/faces`, `/:studio/:id/me`, `/:studio/:id/faces` (lazy) |
| Entry from gallery | `FW/src/photos/PhotoGallery.tsx:1093-1099` | "מצאו את התמונות שלי" button; `:450-453` "לא אני" button on grid tiles |
| Worker logic | `FW/worker/faces.ts` (159 lines) | upload, guest chunk filter, file rewrite, hidden-photo removal, remove person, token |
| Worker routes | `FW/worker/index.ts:1537-1663` | 8 face routes; plus hooks at `:462-463, 470-576, 589, 664-691, 768-794` |
| Gallery lifecycle | `FW/worker/galleries.ts:356-382` | trash / purge delete faces first |
| Clean-up | `FW/worker/cleanup.ts:1-215` | hourly deletion + file rewrite |
| Store interface | `FW/worker/store.ts:35-73, 341-388, 551-569` | types + methods |
| Supabase impl | `FW/worker/store-supabase.ts:529-666` | Storage + RPC calls |
| Memory impl (tests) | `FW/worker/store-memory.ts:505-700` | mirrors SQL semantics |
| Models | `FW/public/models/*` (copied from npm by `FW/vite.config.ts:6-19`) | 3 nets, 12.4 MB |
| Hub card | `apps/hub/src/components/films/PhotosEditor.jsx:744-755, 1030-1122` | switch, counts, scan link, guests' link |
| Hub notices | `apps/hub/src/pages/films/FilmsGalleries.jsx:224, 264, 328-340, 617`; `apps/hub/src/lib/filmsBatch.js:22-50, 64` | "switched off because deleted" |
| Legal | `apps/hub/src/pages/Privacy.jsx:21-24, 75, 88-105, 196-199`; `apps/hub/src/pages/Terms.jsx:130-133, 168-169, 183` | verbatim in §9 |
| DB | `supabase/migrations/0081_face_search.sql`, `0105_films_cleanup.sql` (face parts), `0136_films_face_search.sql`; rollback `supabase/rollback/0136_films_face_search.down.sql` | |
| Backups | `tools/prod/lib/backup-lib.mjs:34` (`SKIPPED_BUCKETS = ['films-faces']`), `tools/prod/backup-storage.mjs:6` | face files excluded from operator backups |
| Tests | `FW/test/faces.test.ts`, `selfie.test.ts`, `face-rules.test.ts`, `face-scan.test.ts`, `FW/e2e/gallery.spec.ts:1174-1336`, `tools/db-test/tests/face-search.test.mjs`, `films-cleanup.test.mjs`, `apps/hub/src/lib/filmsBatch.test.js:37-41,75-78` | §12 |
| Docs | `docs/port-from-avira-films.md:93-97,123,140,149,255-269`; `docs/runbook.md:875-908 (P69), 2499-2534 (P68)`; `CLAUDE.md:205-215` | decisions D06(1)-(5), fix plans P68/P69 |

Not in scope but shares the engine: the album designer's "⚠️ פנים בקפל" (`apps/hub/src/lib/albumDesigner/faces.js`) uses the
same @vladmandic/face-api SSD MobileNet model self-hosted in the hub's `/models` — detection only, no descriptors.

---

## 3. Studio side

### 3.1 Per-gallery switch (hub → photo gallery screen → card "זיהוי פנים לאורחים")
`apps/hub/src/components/films/PhotosEditor.jsx:1036-1122` (`FaceCard`), mounted at `:744-755` under the album card.

- Stored as `faceSearch: true|false` inside the gallery's photo-list JSON (`films_photos.data.faceSearch`,
  `FW/worker/types.ts:303`). Default: absent = off. Written by `PUT /api/admin/galleries/:id/photos {faceSearch}`
  (`FW/worker/photos.ts:557-568`, field list `FW/worker/store.ts:533`).
- Turning **on**: no confirmation. Turning **off**: confirm dialog (verbatim):
  `לכבות את החיפוש לפי פנים? נתוני הפנים של הגלריה יימחקו, והדף לאורחים יפסיק לעבוד.` → server deletes all face data at once
  (`FW/worker/index.ts:786-787`).
- A read-only studio (lapsed subscription) may still send exactly `{faceSearch:false}` (privacy-reducing) and nothing
  else (`index.ts:771-772`).
- Card text (verbatim): **`זיהוי פנים לאורחים`** · `כל אורח מצלם סלפי ומקבל רק את התמונות שבהן הוא מופיע. הסריקה רצה במחשב שלכם והסלפי נבדק בטלפון של האורח: התמונות והסלפי לא נשלחים לשום חברה חיצונית, ונשמרים רק מספרים (לא תמונות של פנים).`
- If off because data was deleted (`offBecauseDeleted`): `זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש.`
- When on, counts come from `GET /api/admin/galleries/:id/faces` (`index.ts:1547-1554`) → `{chunks, photos, faces,
  visible, scanned, left, offBecauseDeleted}`; the card reloads on window focus (coming back from the scan tab).
  - `left > 0`: `נסרקו {scanned} מתוך {visible} תמונות.` (+ when 0 scanned: ` עד הסריקה, אורחים יראו שהחיפוש עוד לא מוכן.`)
    and a gold button **`סריקת פנים`** / **`המשך סריקה`** (opens `${coupleUrl}/faces?pt=<previewToken>` in a new tab) +
    hint `נפתחת לשונית חדשה; השאירו אותה פתוחה עד הסוף. אם נעצר, זה ממשיך מאותו מקום.`
  - all scanned: `✓ כל התמונות נסרקו · נמצאו {faces} פנים`
  - Guests' link block: **`הקישור לאורחים`**, the link `<guestUrl>/me` (LTR box), button `העתקה` (toast
    `הקישור לאורחים הועתק`), button `שליחה בוואטסאפ` → `https://wa.me/?text=` + `מצאו את התמונות שלכם מהחתונה של {coupleName}: {link}`,
    hint `שלחו לזוג כדי שיעבירו לאורחים, או הדפיסו כ-QR לשולחנות. כל אורח מאשר לפני הסלפי, ונתוני הפנים נמחקים כשהגלריה נסגרת.`
  - **QR: there is NO QR generator in this feature** — the hint tells the studio to print one themselves.
- Galleries list notice after extend/restore of a gallery whose search went off with its data
  (`FilmsGalleries.jsx:328-340`): `זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש:` + links to the galleries.
- Batch failure reason (`filmsBatch.js:64`): `נתוני זיהוי הפנים שלהן לא נמחקו, ולכן הן לא טופלו. נסו שוב בעוד רגע`.

### 3.2 Where indexing runs: **in the studio's own browser**, on the films site
`FW/src/faces/StudioFaces.tsx`, route `/<studio>/<id>/faces` (also `/watch/<id>/faces`).
- Opened from the hub with `?pt=<preview token>`; the site turns it into a studio cookie and strips `pt` from the URL
  (`StudioFaces.tsx:97-99`). Preview token/cookie lifetime = **12 hours** (`FW/worker/access.ts:127`). Same-origin, so the
  photos and models load from the films site. Server checks for every scan call (`index.ts:1564-1573`): photo gallery,
  studio access (403 `רק הסטודיו סורק פנים. פתחו את הסריקה מהמערכת.`), subscription ok (402 `המנוי לא פעיל`), face search on
  (400 `החיפוש לפי פנים כבוי בגלריה הזו. הדליקו אותו במערכת.`).
- On open: `GET /api/watch/:id/faces/scan` → `{keys: visible photo keys, done: scanned keys, faces, base:
  "/api/photos/<id>/v<gen>"}` (`index.ts:1575-1580`). **Starts automatically** if anything is left (`StudioFaces.tsx:104`).
- Page texts (verbatim): title `{coupleName} · סריקת פנים`; h1 `סריקת פנים · {coupleName}`; explanation
  `המחשב שלכם עובר על התמונות ושומר לכל פנים רק מספרים (לא תמונה). התמונות לא נשלחות לשום חברה חיצונית. השאירו את הלשונית פתוחה עד הסוף; אם זה נעצר, פתיחה מחדש ממשיכה מאותו מקום.`
- Progress bar text: `מחפש פנים {done}/{total} · {faces} פנים חדשות · {eta}` with eta `פחות מדקה` / `עוד כ-{m} דק׳` /
  `עוד כ-{h} שע׳ ו-{m} דק׳` (ETA = average time per photo this run × photos left). Status while loading:
  `טוען את מנוע זיהוי הפנים…`. Button `עצירה` (abort; what was found is uploaded).
- Idle with photos left: `נסרקו {n} מתוך {total} תמונות.` + ` {failed} תמונות לא נסרקו, הריצו שוב.` + button
  `המשך סריקה` / `סריקת פנים`. Done: `✓ כל התמונות נסרקו · נמצאו {faces} פנים` + `. אפשר לסגור את הלשונית.`
- Scan algorithm (`FW/src/faces/faceIndex.ts`):
  - Only keys not in `done` (**resumable / incremental**). Sequential: one photo searched while the next preview downloads.
  - Preview = `<base>/<key>?s=l` (cloud thumbnail 2048 px: Dropbox `w2048h1536`, Drive `w2048`, pCloud `2048x1024` —
    `FW/worker/photos.ts:862-867`), drawn to a canvas of **≤1280 px** long side (`toCanvas`).
  - Download failure → one retry after 1 s (8 s after HTTP 429) (`:33-34, 112-125`). A failed download or a detector
    exception is **not recorded as scanned** (counted in `failed`, retried next run). **10 failures in a row stop the scan**:
    `הסריקה נעצרה: 10 תמונות ברצף לא נטענו. בדקו את החיבור ואת התיקייה, והריצו שוב.` (`:31, 64-69`).
  - A photo with 0 faces IS recorded as scanned (with 0 faces).
  - Upload every **120 photos** and at the end/stop (`:87, 102-107`); a batch leaves the client queue only after the
    server accepted it (`:54-62`). Upload error fallback text `שמירת נתוני הפנים נכשלה`.
- **Re-index**: there is no "rescan everything" button. New/unhidden photos show as "left" → "המשך סריקה". A full rescan =
  switch off (deletes everything) → on → scan. Photos hidden or gone from the folder are removed automatically (§7.3).
  Note: a photo whose *file* changed but kept its key (P66 re-edit) keeps its old descriptors.

### 3.3 "הסר אדם זה" — remove one person on request (decision D06(4))
`StudioFaces.tsx:64-92, 166-178`, server `index.ts:1594-1605`, `worker/faces.ts:119-139`.
- Card (shown once something was scanned): **`הסרת אדם מהחיפוש`** · `אורח ביקש שלא ימצאו אותו בחיפוש לפי פנים? בחרו תמונה ברורה שלו (למשל תמונה מהגלריה). הפנים שתואמות לו יימחקו מנתוני הפנים של הגלריה; התמונות עצמן נשארות.` Button (file picker, any image) **`הסר אדם זה`**.
- Flow in the studio's browser: `מחפש את האדם בתמונות…` → `detectOne` on the reference photo (≤900 px) → if none:
  `לא נמצאו פנים בתמונה. בחרו תמונה ברורה של האדם.` → `POST …/faces/search` (no consent needed for studio; logged as
  role `studio`) → if no data `אין עדיין נתוני פנים בגלריה.` → download all chunks → `findPerson` (threshold 0.50; **not**
  the expanded pass) → none: `האדם לא נמצא בנתוני הפנים של הגלריה.` → `window.confirm`:
  `האדם נמצא ב-{n} תמונות. למחוק את נתוני הפנים שלו מהגלריה? התמונות עצמן נשארות, ואורחים לא ימצאו אותו בחיפוש.`
  → `POST /api/watch/:id/faces/remove {faces:[{key,face}]}` repeated with `remaining` (≤50 rounds; server rewrites ≤12
  files per call, ≤5000 faces per call) → `✓ נתוני הפנים של האדם נמחקו מ-{n} תמונות.`
- Effect: those faces are cut out of the stored files (other faces in the photo stay; the photo stays "scanned", so a
  later scan never re-adds it). **Not blocked for photos scanned later** — by design, keeping the person's descriptor to
  block them would itself keep biometric data (runbook P68 "Not in this package").

---

## 4. Guest / couple side

### 4.1 Entry points
- Couple's or guests' gallery top bar: link **`מצאו את התמונות שלי`** (face icon) when `photos.faceSearch` is on AND (the
  viewer is on the guests' link OR a guests' link exists) (`PhotoGallery.tsx:1093-1099`). It always points at the
  **guests' link** `/…/<guestId>/me`, so anything shared from there never carries the couple's link (which can heart,
  choose, design the album). e2e asserts the guest page HTML never contains the couple gallery id.
- Direct link from the studio/couple: `<guests' link>/me` (copied / WhatsApp from the hub card).
- Personal result link: `<guests' link>/me#p=<key>.<key>…` (§4.5).
- Password-protected galleries show the normal lock screen first (`Locked` with `light` style; `PinProvider` for download
  PIN) — handled by the gallery code.

### 4.2 Page states (`FW/src/faces/GuestPage.tsx`)
Header: cover photo (`?s=l`, with saved cover position), studio name, couple name, formatted date.
Errors before anything: closed `הגלריה נסגרה`; off `החיפוש לפי פנים לא פעיל בגלריה הזו` (also non-photo galleries).

**intro** (`:175-211`)
- h2 `מצאו את עצמכם בתמונות`, p `מצלמים סלפי, והטלפון מחפש אתכם בתמונות מהאירוע.`
- Not scanned yet (`ready:false`): `הסטודיו עוד מכין את החיפוש בגלריה הזו. נסו שוב מאוחר יותר.` — and NO selfie button
  (never an empty search).
- Partially scanned: `הסטודיו עוד סורק חלק מהתמונות, כך שהחיפוש עדיין לא כולל את כולן.`
- **Consent checkbox (verbatim, version `v2`, `shared/faces.ts:12`)**:
  > אני מסכים/ה שהטלפון שלי ישווה את הפנים שבסלפי שלי לפנים בתמונות מהאירוע, ואני מחפש/ת רק את עצמי. הסלפי נבדק רק על המכשיר שלי, לא נשמר ולא נשלח לשום מקום; נשמר רק שבוצע חיפוש. נתוני הפנים של הגלריה נמחקים כשהגלריה נסגרת. מי שלא רוצה שימצאו אותו בחיפוש יכול לבקש מהסטודיו להסיר אותו.
- Button **`צילום סלפי`** — disabled (faded) until the box is ticked. It is `<input type="file" accept="image/*"
  capture="user">`: on phones it opens the **front camera directly**; there is deliberately **no "choose existing photo"**
  button (D06(3); the original app had one). (On desktop browsers `capture` is ignored → a file picker.)
- Notices (red) and, after a weak selfie, a ghost button **`לחפש בכל זאת`** (searches with the same kept file, skipping the
  quality check).

**working** (`:213-218`): spinner + status: `טוען את מנוע זיהוי הפנים…` → `מחפשים את הפנים בסלפי…` →
`משווים לכל {N} התמונות…` (fallback `רגע…`).

**Search steps** (`search()`, `:96-143`):
1. Load engine (first time downloads ~13.7 MB, §8).
2. Selfie → canvas ≤900 px → `detectOne` (minConfidence 0.4, max 10, take the **biggest** face). None →
   `לא מצאנו פנים בתמונה. נסו סלפי מקרוב, עם אור טוב, בלי משקפי שמש.`
3. Quality check (unless "לחפש בכל זאת"), first failing rule wins (`quality.ts:48-55`):
   | rule | threshold | message (verbatim) |
   |---|---|---|
   | face width / photo width | < 0.12 | `הפנים קטנות מדי בתמונה. צלמו מקרוב יותר, שהפנים ימלאו את רוב התמונה.` |
   | mean brightness of face (0-255) | < 55 | `התמונה חשוכה מדי. נסו ליד חלון או באור חזק יותר.` |
   | mean brightness | > 225 | `יש יותר מדי אור על הפנים. התרחקו מהשמש או מהפלאש.` |
   | sharpness = variance of Laplacian on the face crop resized to 128×128 grey | < 12 | `התמונה מטושטשת. החזיקו את הטלפון יציב ונסו שוב.` |
   | detector score | < 0.7 | `קשה לראות את הפנים. הסירו משקפי שמש או כובע ונסו שוב.` |
   (Thresholds "not yet validated on real selfies" — `docs/port-from-avira-films.md:95`.)
4. `POST /api/watch/:id/faces/search {consent:"v2"}` → `{ready, partial, chunks, version, token, expiresIn:600}`.
5. Download chunks (`download.ts`): 8 parallel lanes, `GET /api/watch/:id/faces/:n?v=<version>` with header
   `X-Face-Token`. Decoded result kept in page memory per gallery+version (a second selfie downloads nothing); the
   browser also HTTP-caches each chunk 24 h (`Cache-Control: private, max-age=86400`).
6. `findPerson(selfie, photos)` filtered to photos currently shown → "found"; `expandSearch` → "maybe".
   0 found → stage results with notice `לא מצאנו אתכם בתמונות. נסו סלפי אחר: מקרוב, עם אור טוב, בלי משקפי שמש.`
   Errors: chunk 409 → `נתוני החיפוש התעדכנו בדיוק עכשיו. נסו שוב.`; other → `הורדת הנתונים נכשלה`; token expired 403
   `החיפוש פג. צלמו סלפי שוב.`; rate limit 429 `היו הרבה חיפושים מהרשת הזו בזמן קצר. נסו שוב בעוד כמה דקות.`

### 4.3 Results (`:220-263`)
- h2 `מצאנו אתכם ב-{n} תמונות` / `לא מצאנו אתכם בתמונות`.
- Buttons: **`שלחו לעצמכם בוואטסאפ`** (only with results and a guests' link) → `https://wa.me/?text=` +
  `התמונות שלי מהחתונה של {coupleName}: {personalLink}`; **`הורדת כל התמונות שלי`** (ZIP dialog, §4.6);
  **`סלפי אחר`** (clears results, "not me" and the `#p=` hash, back to intro; the consent box stays ticked).
- Hint: `לחצו על תמונה כדי לראות אותה בגדול ולהוריד. תמונה שאתם לא בה? "לא אני" מוציא אותה. הקישור בוואטסאפ פותח את התמונות שלכם בלי סלפי נוסף.`
- Grid = the gallery's normal `Grid` component, **in gallery order (the day's story), not by match distance**; no hearts /
  Instagram marks; each tile has **`לא אני`** (aria `זה לא אני, להוציא את התמונה`).
- "Maybe" section: h3 `אולי גם אתם ({n})` + `תמונות שבהן הפנים פחות ברורות (מהצד או מרחוק). מה שלא שלכם, מוציאים ב"לא אני".`
  + a second grid. "לא אני" on any photo removes it from both lists AND recomputes "maybe" without that face.
- Lightbox over found+maybe (phone Back closes the photo); single-photo download per gallery rules.

### 4.4 "My photos" = found ∪ maybe (minus "not me"). Used for the lightbox, the ZIP and the personal link.

### 4.5 Personal link (no selfie needed again)
`keysToHash` / `keysFromHash` (`shared/faces.ts:201-208`): URL fragment `#p=1a2b3c4d.5e6f7a8b…` (8-hex photo keys joined by
dots; only keys matching `^[0-9a-f]{8}$` are read). Updated live with `history.replaceState` as results change. Opening
it goes straight to results showing those photos (filtered to photos still shown) — no engine, no face data download.
The share path is always the guests' link (`sharePath`, `:160-161`); opened from the couple's link without a guests'
link → no personal link / no WhatsApp button. The fragment is never sent to the server.

### 4.6 Download "my photos"
Reuses the gallery ZIP dialog (`FW/src/photos/ZipDialog.tsx`, client-side ZIP via `client-zip`): one group
`{id:'mine', label:'התמונות שלי'}`, file name `{coupleName} - התמונות שלי`, quality full/small, download PIN if the gallery
has one. (Details belong to the gallery researcher.)

---

## 5. Algorithm

### 5.1 Library and models
- **`@vladmandic/face-api` 1.7.15** (maintained fork of face-api.js; bundles TensorFlow.js 4.22). Lazy-loaded chunk
  `face-api.esm-*.js` = **1.31 MB** (uncompressed) — only on `/me` and `/faces` pages.
- Backend: `tf.setBackend('webgl')`, fallback `'cpu'` (`engine.ts:34-40`). WASM backend not used.
- Models, **self-hosted** at `https://films.studioplan.co.il/models/…` (`loadFromUri('/models')`, `engine.ts:41`),
  copied from `node_modules/@vladmandic/face-api/model` into `public/models` on every build (`FW/vite.config.ts:6-19`,
  not tracked in git). Served as static assets (`wrangler.jsonc` `run_worker_first` excludes `/models/*`). `models` is a
  reserved studio slug (`0081:67-76`, `packages/shared/product.js:8`, `FW/worker/pages.ts:30`).
  | file | size | role |
  |---|---|---|
  | `ssd_mobilenetv1_model.bin` + manifest (28 KB) | 5,616,957 B | face detector (SSD MobileNet v1, uint8-quantised) |
  | `face_landmark_68_model.bin` + manifest (8 KB) | 356,840 B | 68-point landmarks (alignment) |
  | `face_recognition_model.bin` + manifest (20 KB) | 6,444,032 B | ResNet-34-style net → **128-D descriptor** (dlib-style) |
  | total | ≈ 12.47 MB | |
- No CDN, no external API, no server ML. Tests inject a fake engine via `window.__faceEngine`.

### 5.2 Detection parameters
| use | detector options | post-filter | canvas size |
|---|---|---|---|
| studio scan `detectAll` (`engine.ts:42-53`) | SSD, `minConfidence 0.5`, `maxResults 40` | drop faces with box width **< 28 px** (on the ≤1280 px canvas) — "far in the crowd, unreliable" | preview 2048 → **≤1280** long side |
| guest selfie / studio reference `detectOne` (`:54-60`) | SSD, `minConfidence 0.4`, `maxResults 10` | biggest box wins; returns descriptor + box + score | **≤900** long side |
- **Multiple faces per photo**: all kept (≤40 by detector; the format caps at 255). Each face keeps its box (fractions of
  the photo) and its index within the photo (used by "remove person").
- Pipeline: detect → landmarks → aligned descriptor (`detectAllFaces(...).withFaceLandmarks().withFaceDescriptors()`).

### 5.3 Matching (`shared/faces.ts`)
- **Distance**: Euclidean over 128 dims between the selfie (float) and the stored int8 descriptor ÷ 400.
- **`MATCH_DISTANCE = 0.5`** (`:16`) — stricter than face-api's usual 0.6 "too loose for crowds".
- Per photo the **closest face** counts; photo is a hit if best < 0.5 (`findPerson`, `:155-170`).
- **Second pass "אולי גם אתם"** (`expandSearch`, `:172-199`): take hits with distance **< `SURE_DISTANCE` 0.42** not marked
  "not me" (at most 25, need **≥ 2**); average them with the selfie (mean of selfie + sure faces); search again with
  the mean (< 0.5); keep only new photos not "not me" whose face is still **< 0.62** (0.5 + 0.12) from the selfie itself
  (guard against drifting to another person).
- Quantisation: ×400 → int8 clamp ±127 (descriptor values ≈ ±0.3); error ≤ 0.00125/dim, ≤ ~0.014 total distance (test
  expects < 0.02, `test/faces.test.ts:25`).

---

## 6. Storage

### 6.1 Binary chunk format (`shared/faces.ts:6-8, 34-76`), little-endian
```
u16 photoCount
repeat photoCount:
  4 bytes  photo key (the 8-hex photo key as 4 raw bytes)
  u8       faceCount (≤255)
  repeat faceCount:
    4 × u16  box x, y, w, h   (fractions of the photo × 65535)
    128 × i8 descriptor       (value × 400, clamped to ±127)
```
Size = 2 + Σ(5 + 136 × faces). No picture data, no crop, no landmarks. `filterChunk` (`:87-135`) copies photos/faces byte
for byte (no re-rounding) to drop photos (hidden) or single faces (remove person).

### 6.2 Supabase Storage
- Private bucket **`films-faces`**, `public=false`, `file_size_limit 4194304` (4 MB), mime `application/octet-stream`, **no
  storage policies** → only the service role (the films Worker) reads/writes (`0081:62-65`).
- Object names `films-faces/<16-hex gallery id>/<Date.now base36>-<random>.bin` (`store-supabase.ts:551, 601`).
  (The port doc's planned `<tenant>/<gallery>/<n>.bin` was not used.)
- Server re-checks: body ≤ 4 MB, ≥ 1 photo, every key belongs to this gallery, drops photos already scanned or hidden
  (`worker/faces.ts:34-56`).

### 6.3 Tables (all RLS on; studio users may only SELECT their tenant's rows; writes only via service-role RPCs)
`films_faces` (0081 + 0105 + 0136) — one row per gallery, **deliberately no FK to films_galleries** (row survives gallery
deletion so the cleaner finds the files):
| column | meaning |
|---|---|
| `gallery_id text PK` (`^[a-f0-9]{16}$`) | |
| `tenant_id uuid` FK tenants on delete cascade | |
| `files text[]` | storage object names in order; chunk n = files[n] |
| `photos int`, `faces int` | counts (photos = rows in films_faces_done) |
| `done text[]` | LEGACY (frozen since 0136, kept for rollback) |
| `version bigint` | ms timestamp, raised on every change of what a guest downloads; in chunk URLs |
| `dirty text[]` | files still holding faces no longer shown → to rewrite |
| `created_at` (scan start; retention clock), `updated_at`, `cleanup_failed_at` | |

`films_faces_done` (0136) — one row per scanned photo: `(gallery_id FK films_faces on delete cascade, key 8-hex,
tenant_id, file)` PK (gallery_id,key); `file` = chunk holding its faces (null for rows migrated from the old array).

`films_face_searches` (0136) — audit log, one row per search: `id, gallery_id FK films_galleries on delete cascade,
tenant_id, role ∈ couple|guest|studio, consent (1-40 chars, 'v2' or 'studio'), created_at`. **No selfie, no face data,
no IP address.**

`films_galleries.faces_off_at timestamptz` (0136) — set when face search was switched off because data was deleted;
cleared by trigger `films_faces_off_clear` on `films_photos` when faceSearch becomes true again.

RPCs (security definer, `service_role` only): `films_faces_add` (insert done rows; no new photo → `duplicate`, Worker
deletes the file; partial overlap → file marked dirty), `films_faces_remove` (photos hidden/gone → delete done rows, mark
files dirty, bump version), `films_faces_done_keys`, `films_faces_chunk` (file + keys a guest may get), `films_faces_plan`
/ `films_faces_swap` (rewrite files atomically, only while old file still listed), `films_faces_dirty_candidates`,
`films_faces_forget(p_search_off)` (delete record; if there WAS data and search was on → set faceSearch false + faces_off_at),
`films_faces_cleanup_candidates` (0105:52-96, §7.2). Tenant write gate applied to the three tables.

### 6.4 Per-gallery data size (exact formula, assumed face counts)
2,000 photos × avg 2-6 kept faces = 4,000-12,000 faces × 136 B + 10 KB headers ≈ **0.55-1.65 MB**, in **17 files** (16×120 +
1×80 photos), each ≈ 33-100 KB.

---

## 7. API, lifecycle and deletion

### 7.1 Routes (`FW/worker/index.ts`)
| route | who | what | limits / errors |
|---|---|---|---|
| `GET /api/admin/galleries/:id/faces` (:1547) | studio admin, photos module | counts by keys `{chunks,photos,faces,visible,scanned,left,offBecauseDeleted}` | |
| `DELETE /api/admin/galleries/:id/faces` (:1556) | studio write (read-only allowed) | delete all + search off | (not used by the hub UI today) |
| `GET /api/watch/:id/faces/scan` (:1575) | studio cookie | `{keys, done, faces, base}` no-store | 403/402/400 above |
| `POST /api/watch/:id/faces` (:1586) | studio cookie | binary chunk upload → `{chunks,photos,faces,skipped}` | **1000 uploads/hour/gallery** (`יותר מדי העלאות בזמן קצר. נסו שוב בעוד כמה דקות.`); 400 `חלק גדול מדי` / `אין נתונים` / `תמונה שלא שייכת לגלריה` |
| `POST /api/watch/:id/faces/remove` (:1598) | studio cookie | `{faces:[{key,face}]}` → `{removed, remaining}` | ≤5000 faces (`יותר מדי פנים בבקשה אחת`), empty → `לא נבחרו פנים`; 12 files per call |
| `GET /api/watch/:id/faces` (:1627) | couple/guest link (+password) | `{ready, partial, chunks, version}` no-store | 410 `הגלריה נסגרה` (and deletes!), 404 `חיפוש לפי פנים לא פעיל בגלריה הזו` |
| `POST /api/watch/:id/faces/search` (:1638) | couple/guest link (+password) or studio | consent check, rate limit, log row, token | 400 `צריך לאשר את ההסכמה לפני החיפוש` (code `consent`); **300 searches/hour per IP(/64)+gallery** (high on purpose: a wedding hall shares one Wi-Fi; each "סלפי אחר" is a search) |
| `GET /api/watch/:id/faces/:n?v=` (:1655) | link + `X-Face-Token` | filtered chunk bytes; `private, max-age=86400` with `v`, else no-store | 403 `החיפוש פג. צלמו סלפי שוב.` (`face_token`); 409 `נתוני החיפוש התעדכנו. נסו שוב.` (`faces_changed`); 404 `לא נמצא` |

**Token** (`worker/faces.ts:141-159`): `<unix end>.<HMAC(derivedKey(FILMS_STATE_SECRET,'films-face-search-v1'), "<galleryId>.<end>")>`,
valid **600 s** (a token claiming more than 660 s ahead is refused), constant-time compare, bound to the gallery only (not to IP/role). Chunk reads
never read the photo list (P68 performance rule).

### 7.2 Every deletion / removal trigger
| trigger | where | effect |
|---|---|---|
| Studio switches search off | `index.ts:786-787` | delete all files + record (immediate) |
| Gallery to trash (single or batch) | `galleries.ts:360-362`, `index.ts:526-549` | delete all **before** trashing, search off + `faces_off_at`; batch handles ≤6 face galleries per request, rest in `remaining` (hub re-sends, ≤12 rounds); failure → gallery left as is, reason `faces_failed` |
| Batch "close" | `index.ts:529-549` | same, before closing |
| Purge (remove for good) | `galleries.ts:377-378`, batch | delete faces first; if it fails the gallery stays |
| Guest/visitor hits face API of a closed gallery | `index.ts:1615-1618` | delete on the spot + 410 |
| Gallery closes by date | hourly clean-up | reason `closed` |
| Photo hidden / gone from folder | `worker/faces.ts:97-117`, `index.ts:684, 789` | removed from what guests get **at once** (done rows deleted, version bumped); files rewritten now (≤6) and the rest by the hourly clean-up (`faces-rewrite`) |
| Folder replaced by another shared link (another couple's folder) | `index.ts:681-682`, `photos.ts:197-199, 249` | delete all; faceSearch reset |
| "הסר אדם זה" | §3.3 | that person's faces cut from files |
| Hourly clean-up `films_faces_cleanup_candidates` (0105:52-96) reasons: `gone` (gallery row missing), `trashed`, `closed`, `off` (search off / not photos), `too_old` (**scan > 365 days**, `FACE_MAX_AGE_DAYS`), `studio_ended` (tenant canceled/suspended **> 30 days** and access not ok, `CLOSED_STUDIO_GRACE_DAYS`), `orphan_files` (bucket folders without record, files > 1 day old) | `cleanup.ts:148-177` | delete + search off; failures marked `cleanup_failed_at` and retried last |
| Gallery row deleted | FK cascade | `films_face_searches` rows go with the gallery (not on close) |
| Operator backups | `tools/prod/lib/backup-lib.mjs:34` | `films-faces` bucket excluded (DB backups still contain `films_faces`/`_done` rows = file names + photo keys + counts, and the search log — no descriptors) |

Clean-up runs **every hour** (`wrangler.jsonc` cron `0 * * * *`), within a subrequest budget (`CLEANUP_MAX_SUBREQUESTS`
45 on the free plan; face delete ≈ 4 requests, rewrite ≈ 14), 60 s time limit; face data goes first, then trash.
Runs recorded in `films_cleanup_runs` (facesRemoved, pendingFaces).

After any deletion with `searchOff`, extend/restore answer `faceSearchOff` so the hub tells the studio to switch on and
rescan (decision D06(2): guests never see an empty search). A gallery never scanned keeps its switch.

---

## 8. Performance & limits (2,000-photo gallery)
No measured timings exist in the repo; numbers below are computed from the code (exact) or estimated (marked ~).

| item | value |
|---|---|
| Studio downloads | 2,000 previews at 2048 px through the Worker (~0.3-0.7 MB each → **~0.6-1.4 GB**) + models 12.5 MB + JS 1.3 MB |
| Studio requests | 1 scan GET + 2,000 preview GETs (+ retries) + **17 chunk POSTs** (limit 1000/h) |
| Studio compute | sequential, 1 photo at a time, WebGL; **~0.3-1 s/photo → ~10-35 min** on a modern laptop; CPU fallback several × slower (~1-5 h). Tab must stay open; cookie lasts 12 h |
| Stored | **~0.55-1.65 MB** in 17 objects + 2,000 `films_faces_done` rows |
| Guest first visit | models 12.47 MB + face-api JS 1.31 MB + chunks 0.55-1.65 MB ≈ **14-15.5 MB** (browser-cacheable; models are static assets) |
| Guest requests | 1 meta + 1 search + 17 chunk GETs (8 parallel) |
| Guest compute | 1 detection on a ≤900 px selfie (~0.3-1.5 s on a phone, + one-time WebGL warm-up ~1-3 s) + 4k-12k distance computations (~1.5 M multiply-adds, a few ms) |
| Second selfie | 0 downloads (page cache) |
| Hard limits | ≤40 faces/photo detected (format 255); ≤120 photos per upload chunk (server accepts ≤4 MB / ≤65,535 photos); token 10 min; 300 searches/h/IP/gallery; 1000 uploads/h/gallery; remove-person ≤5000 faces & 12 files per call; 10 consecutive failures stop the scan |
| Server ML | none (Cloudflare Worker only filters bytes) |

---

## 9. Privacy / legal texts (verbatim)

### 9.1 Consent on the guest page (version `v2`) — see §4.2. Old v1 (original app, for comparison):
`אני מסכים/ה שהטלפון שלי ישווה את הפנים שלי לפנים בתמונות מהאירוע. הסלפי נבדק רק על המכשיר שלי ולא נשמר ולא נשלח לשום מקום. נתוני הפנים של הגלריה נמחקים כשהגלריה נסגרת.`
The consent version string is stored per search (`films_face_searches.consent`); any wording change must bump
`FACE_CONSENT` in `shared/faces.ts:12`.

### 9.2 Privacy policy (`apps/hub/src/pages/Privacy.jsx`; code comment `:21-24`: "LAWYER REVIEW PENDING (M11) — the wording is a draft")
- `:75` list item: `בגלריות תמונות שבהן הסטודיו הפעיל חיפוש לפי פנים — נתוני פנים של המצולמים (ראו להלן).`
- `:88-105` section **`זיהוי פנים לאורחים בגלריות תמונות`**:
  > סטודיו יכול להפעיל בגלריית תמונות חיפוש לפי פנים, כדי שאורחים ימצאו את התמונות שבהן הם מופיעים. לשם כך הפנים בתמונות הגלריה נסרקות (הסריקה נעשית בדפדפן של הסטודיו), והמערכת שומרת לכל פנים תבנית מספרית — רצף מספרים, לא תמונה של הפנים. זהו **מידע ביומטרי**. התבניות נשמרות באחסון פרטי שאינו פתוח לציבור, ונשלחות רק למכשיר של מי שנכנס לגלריה בקישור שלה (ובסיסמה, אם הסטודיו קבע סיסמה) ואישר את ההסכמה לפני החיפוש — רק של תמונות שמוצגות בגלריה, ובהרשאה שתקפה 10 דקות — כדי שההשוואה תיעשה על המכשיר עצמו. מספר החיפושים מכל רשת מוגבל. הסלפי של האורח נבדק רק על המכשיר שלו, אינו נשמר ואינו נשלח למערכת; נשמר רק רישום שבוצע חיפוש (מתי, באיזו גלריה, מאיזה קישור ואיזה נוסח הסכמה אושר), בלי הסלפי ובלי כתובת הרשת. התמונות והסלפי אינם נשלחים לשום שירות חיצוני לזיהוי פנים. מי שלא רוצה שימצאו אותו בחיפוש יכול לבקש זאת מהסטודיו, והסטודיו מוחק את נתוני הפנים שלו מהגלריה.
  >
  > נתוני הפנים של גלריה נמחקים: כשהסטודיו מכבה את החיפוש; כשהגלריה נמחקת או נסגרת לצפייה; לכל המאוחר 12 חודשים אחרי הסריקה; ו-30 יום אחרי שמנוי הסטודיו בוטל או הושעה. נתוני הפנים של תמונה שהסטודיו מסתיר או שיוצאת מהתיקייה נמחקים גם הם. כשנתוני הפנים של גלריה נמחקים, החיפוש בה כבה. המחיקה נעשית באופן אוטומטי, בבדיקה שרצה כל שעה. רישומי החיפוש נמחקים יחד עם הגלריה. נתוני הפנים אינם נכללים בגיבויים של המפעיל.
- `:196-199` backups: `המפעיל שומר מעת לעת עותק גיבוי מוצפן של מסד הנתונים ועותק של הקבצים שבמערכת (למעט נתוני פנים), …`

### 9.3 Terms (`apps/hub/src/pages/Terms.jsx`)
- `:130-133` (cancellation): `… נתוני זיהוי הפנים בגלריות נמחקים באופן אוטומטי 30 יום לאחר ביטול המנוי או השעייתו. … גם במצב צפייה בלבד הלקוח יכול לסגור גלריות, להעביר אותן לסל, להחליף סיסמה, לבטל קישורים ולמחוק נתוני פנים.`
- `:168-169` (customer responsibility): `אם הפעיל חיפוש לפי פנים בגלריה — יש לו בסיס כדין לעיבוד המידע הביומטרי של המצולמים, והוא מיידע אותם על כך כנדרש.`
- `:183` backups: `… (כגון חוזים חתומים וקבצי אלבום, למעט נתוני זיהוי פנים) …`

### 9.4 Legal basis notes in code
`0081:4`: "The numbers are biometric data (Israeli privacy law, amendment 13)". Decisions D06(1)-(5): 12-month cap, 30-day
grace after studio ends, search off on deletion, no server matching (server matching "only if the lawyer asks"), removal
on request; legal wording still with the lawyer (D06(5), P85). Studio is the data controller (Terms 6).

---

## 10. Hebrew strings index (verbatim, not listed above)
Client: `טוען…` (scan page loading), `לא נמצא`, `הגלריה לא נמצאה` (404 non-photo gallery).
Worker: `חלק גדול מדי`, `אין נתונים`, `תמונה שלא שייכת לגלריה`, `נתוני החיפוש התעדכנו. נסו שוב.`, `לא נבחרו פנים`,
`יותר מדי פנים בבקשה אחת`, `רק הסטודיו סורק פנים. פתחו את הסריקה מהמערכת.`, `המנוי לא פעיל`,
`החיפוש לפי פנים כבוי בגלריה הזו. הדליקו אותו במערכת.`, `יותר מדי העלאות בזמן קצר. נסו שוב בעוד כמה דקות.`,
`הגלריה נסגרה`, `חיפוש לפי פנים לא פעיל בגלריה הזו`, `צריך לאשר את ההסכמה לפני החיפוש`,
`היו הרבה חיפושים מהרשת הזו בזמן קצר. נסו שוב בעוד כמה דקות.`, `החיפוש פג. צלמו סלפי שוב.`
(All other UI strings are quoted in §3-§4.)

---

## 11. How faces plug into the other gallery parts
- **Photo list** (`films_photos.data`): carries `faceSearch`; every save of the list (load folder, hide/unhide, PUT edits)
  calls `removeFacePhotos` / `deleteFaces` (`index.ts:681-684, 786-789`). Public list exposes `faceSearch` (`photos.ts:795`)
  and `photoCount` (= visible photos, used for `partial`).
- **Photo serving**: the scan uses the same `/api/photos/<id>/v<gen>/<key>?s=l` preview URL the gallery uses (studio
  cookie); the results grid/lightbox/ZIP use the normal gallery URLs of the guests' link.
- **Links/access**: works on the couple's link and the guests' link (role logged); password cookie required; the
  "find me" entry always goes to the guests' link. Rotating the guests' link (P73) makes the old `/me` link 404.
- **Gallery lifecycle**: close/trash/purge/extend/restore hooks in §7.2; `faceSearchOff` flag on extend/restore answers.
- **Album editor**: no dependency (only shares the engine).

---

## 12. Tests (what they lock in)
- `FW/test/faces.test.ts`: chunk size formula `2+(5+2·136)+5`; compression keeps the match (< 0.02); finds the right
  photos; `#p=` parsing; expandSearch finds the side/far photo and nothing else; "not me" and < 2 sure → none.
- `FW/test/selfie.test.ts`: Laplacian sharp > 1000 vs blurry < 1; each quality message.
- `FW/test/face-rules.test.ts`: only gallery photos accepted; hourly clean-up keeps open+on, deletes closed / deleted /
  switched-off; trash deletes at once; consent required (400), token per gallery & 10 min (403), old version 409, search
  logged with consent; chunk never reads the photo list, cache header; **300/h rate limit per IP**; hidden photo leaves
  at once and its file is rewritten; duplicate chunk not stored; close → 410, extend → `faceSearchOff`, on again →
  `ready:false`; batch trash/restore names only galleries that had data; "הסר אדם זה" studio-only (403 otherwise), removes
  only that person's faces, photo stays scanned; clean-up rewrites dirty files.
- `FW/test/face-scan.test.ts`: failed preview / broken detector not recorded; 429 retried after 8 s; rerun retries exactly
  the failed ones; 10 failures in a row stop; a refused upload batch stays queued.
- `FW/e2e/gallery.spec.ts:1174-1336`: full studio scan with fake engine (30 photos → "נמצאו 30 פנים", `pt` removed from
  URL), stranger upload 403, "find me" link uses guests' id, consent gates selfie button, results, no hearts, no couple id
  in HTML, WhatsApp link `/<guestId>/me#p=`, personal link reopens, remove person → "לא מצאנו", switch off → 404 + 0
  photos; weak selfie flagged → "לחפש בכל זאת", maybe (1), "not me", only one file input (camera only), consent no longer
  says "רק התמונות שלכם", second selfie downloads no chunks, closed → 410 + data gone, extend → off, on → not-ready.
- `tools/db-test/tests/face-search.test.mjs`: RLS (studio can read only, cannot write or call RPCs), duplicate file,
  one row per photo, remove/chunk/plan/swap/dirty/forget semantics, row survives gallery deletion, bucket private.

---

## 13. Differences from the original standalone app (`/Users/danieldayan/Downloads/מערכת צפיה וידאו`)
| original | Studio Plan |
|---|---|
| KV keys `faces:<id>:meta` + `faces:<id>:<n>` (`worker/faces.ts:1-49`) | Supabase private bucket + tables + RPCs |
| scan in the admin app; MyAirBridge galleries used originals `?s=full` | scan page on the films site; always `?s=l` |
| guest downloaded raw chunks without token/consent log | consent version, rate limit, 10-min token, only shown photos, version/409 |
| camera + "choose a photo" | camera only |
| consent v1 (shorter) | v2 (adds "only myself", search logged, removal on request) |
| nightly cron | hourly, DB-chosen candidates, 12-month & studio-ended rules, orphan files |
| no person removal, hidden photos stayed | "הסר אדם זה", hidden photos removed at once |

---

## 14. Rebuild requirements

**Accounts / infra**: Supabase project (Postgres + Storage; private bucket `films-faces`, service-role-only); a server
runtime that can serve binary responses and run an hourly job (today Cloudflare Worker + cron); static hosting for the
model files on the **same origin** as the scan and guest pages (or CORS); HTTPS (camera capture + WebGL).

**Secrets**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Storage + RPC); `FILMS_STATE_SECRET` (face token key derived with
label `films-face-search-v1`; also signs preview tokens). No ML/API keys — nothing external.

**Assets**: npm `@vladmandic/face-api@1.7.15` (MIT) and its `model/` folder: `ssd_mobilenetv1_model.bin`+manifest,
`face_landmark_68_model.bin`+manifest, `face_recognition_model.bin`+manifest (≈12.5 MB). Reserve the path/slug `models`.

**Must keep identical** for compatibility with existing data: binary format (§6.1), SCALE 400, MATCH 0.5 / SURE 0.42 /
+0.12 guard, 28 px min face, 1280/900 canvas sizes, 8-hex photo keys, `#p=` link format, consent version string.

---

## 15. Open questions / risks
1. **Biometric data goes to every guest's phone.** Matching is client-side by decision (D06(3)), so anyone with the
   gallery link (+password) who ticks the box receives the descriptors + boxes of **everyone** in the shown photos for 10
   minutes (and their browser keeps the chunks up to 24 h in HTTP cache, also after a person was removed or the gallery
   closed). Rate limit is per IP and generous (300/h). Server-side matching is the stronger privacy option — lawyer to
   decide (open since D06(3)/P85).
2. **Consent is the guest's only, not the photographed people's.** Those indexed never consented; the studio's legal basis
   is pushed onto the studio (Terms 6). Privacy/consent wording is marked **"LAWYER REVIEW PENDING"** (Privacy.jsx:24).
3. **"Camera only" is mobile-only**: `capture="user"` is ignored on desktop, so a desktop user can upload any photo of
   another person and find them. Consent text ("אני מחפש/ת רק את עצמי") is the only guard.
4. **Removal is incomplete by design**: "הסר אדם זה" uses only the 0.5 pass (side/far faces may stay), and photos scanned
   later are not blocked (the studio must remove again after scanning new photos). No guest-facing removal request
   form — it goes through the studio by phone/WhatsApp.
5. **Search log retention**: `films_face_searches` rows are deleted only with the gallery row (purge), not when face data is
   deleted or the gallery closes; no explicit retention period. DB backups contain them (no IP, no selfie).
6. Hard-coded wedding wording in WhatsApp texts (`…מהחתונה של…`) for every event type.
7. No QR generator although the hub tells studios to print a QR.
8. Selfie quality thresholds and the 0.5/0.42 thresholds are not validated on real data (port doc :95); no measured
   performance numbers; CPU-fallback scans on weak machines can take hours; scan needs the tab open; preview cookie 12 h.
9. During an active scan, every upload bumps `version` → guests mid-download get 409 "נתוני החיפוש התעדכנו…" (retry works).
10. A photo whose file was replaced but kept its key keeps its old descriptors (no rescan of changed files).
11. Large galleries: all chunks are downloaded to the phone (no server-side pre-filter); fine at 2,000 photos (~1-2 MB),
    grows linearly.
12. Model/weights licensing to confirm for commercial use (face-api is MIT; the recognition weights derive from dlib's
    ResNet model — check its training-data terms).
13. Clean-up budget: on the free Workers plan (45 subrequests/run, 12 kept for one trash purge, 4 per face gallery) only ~8 galleries' face data per hour; a mass expiry
    could leave data alive for hours past "closed" (pending count is logged in `films_cleanup_runs`).
14. CSP: no `script-src` yet "until face search is checked with it" (`index.ts:2058-2061`) — TF.js WebGL needs to be tested
    under any future strict CSP.
