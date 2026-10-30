# 5 — The album editor connected to the photo galleries (Studio Plan → rebuild in Avira)

Research only (read-only). Paths are relative to `/Users/danieldayan/Downloads/ALL IN ONE SYSTEM/studio-os` unless stated.
`FW` = `apps/films-worker`, `HUB` = `apps/hub/src`, `MIG` = `supabase/migrations`.
Avira = `/Users/danieldayan/Downloads/אווירה סטודיו מערכת/avira-studio-v31-copy-23960b65`.
Original films app = `/Users/danieldayan/Downloads/מערכת צפיה וידאו` (live copy, reference only).

---

## 0. The short version

There are **three different "album" things**, and they must not be confused:

| # | What | Where (Studio Plan) | Who designs | Photos from | Output |
|---|---|---|---|---|---|
| A | **The couple's album designer in the photo gallery** (this document's main subject) | films site `/<studio>/<gallery>/album` — `FW/src/album/*`, `FW/shared/album.ts`, `FW/worker/albums.ts` | The couple (the studio can open it too, with a preview token) | The gallery's photos (hearts first) | One JSON doc in `films_albums`; on "send" → an **album order** in the hub (`album_orders.source='couple_designer'`) → the couple buys/pays in the hub's album portal; print files are rendered **in the browser** (9449×3543 JPEG, 300 DPI) by the studio or by the print shop via a private link |
| B | **Wedding Albums module** (orders, catalog, purchase wizard, bank-transfer payment, lab link) | hub `AlbumOrders.jsx`, `AlbumOrderDetail.jsx`, `AlbumPortal.jsx`, Edge Functions `album-portal`, `album-print-access`, migrations 0031… | — (it sells; studio uploads sketch versions) | — | Avira **already has this** (older version) |
| C | **The studio's album sketch editor** ("🎨 עורך סקיצה (בטא)") | hub `/AlbumOrders/:orderId/design` — `HUB/pages/AlbumDesignEditor.jsx`, `HUB/lib/albumDesigner/*`, `HUB/components/albumDesigner/*`, migrations 0172–0174 | The studio (+ optional couple draft in the portal) | **In Studio Plan:** the event's photo gallery through the films Worker (+ uploads). **In Avira:** a public Google Drive folder | Exported as a normal **version** of an album order (B) |

A (the couple's gallery designer) and C (the studio's sketch editor) are **separate editors with separate document formats and separate layout libraries**. They share only: the spread size constant (`ALBUM_SIZES`, 80×30 cm, 9449×3543 px, 300 DPI), `placePhoto()` (cover-fit math) and `setJpegDpi()` — the hub imports them from `@films-shared/*` (`HUB/lib/albumDesigner/doc.js:28`, `templates.js:12`, `render.js:10`). C is **blocked** for orders made by A (`HUB/lib/albumDesigner/export.js:57`, `HUB/pages/AlbumOrderDetail.jsx:1146`), and the couple's portal editing of C is refused for A orders (`supabase/functions/_shared/albumPortalRules.ts:86`).

Origin: A was ported 2026-09-27 from the original films app (`מערכת צפיה וידאו`, files `shared/album.ts`, `src/album/*`, `src/print/*`), where it was wired to that app's **own** order system (D1 `orders`, KV catalog, `src/order/OrderPage.tsx`, bank transfer + receipt). Studio Plan dropped that order system and fed the hub's Wedding Albums module instead (decision D3(a), `docs/port-from-avira-films.md:134-148`).

---

## 1. The couple's flow (A)

### 1.1 Entering the editor from the gallery
- Gallery top bar button (couple link only, never the guests' link): `FW/src/photos/PhotoGallery.tsx:1106-1111` — link to `<current path>/album`, label **"עיצוב האלבום"**, `data-testid="pg-album"`, book icon. Hidden when `data.role === 'guest'` (`:689`).
- Routes: `/watch/:id/album` and `/:studio/:id/album` → lazy `AlbumPage` (`FW/src/App.tsx:9,23,32`).
- `AlbumPage` (`FW/src/album/AlbumPage.tsx`):
  - Loads the album fonts stylesheet only on this page (`FONTS_URL`, `:44-53`).
  - Accepts `?pt=<preview token>` (studio opened it from the hub) → GET `/api/watch/:id?pt=` turns it into a studio cookie and strips it from the URL (`:57-61`).
  - Errors (exact strings): locked by password → **"הגלריה מוגנת בסיסמה. פתחו אותה קודם מהקישור שקיבלתם."**; guest link → **"עיצוב האלבום זמין רק בקישור של הזוג"**; not a photo gallery → **"לגלריה הזו אין אלבום"** (`:62-69`). Loading text **"מכינים את האלבום…"** (`:124`).
  - Closed (expired) gallery → card **"הגלריה נסגרה"** + button **"להמשך ההזמנה"** if an order link exists (`:64-67, :104-116`).
  - `GET /api/watch/:id/album` → `{ album, ordering }`. If no album yet → **first draft from the hearts** (§1.2), saved with `PUT … { album, rev: 0 }`; if the partner created it first (409 with `album`) → use theirs (`:72-88`).
  - Placing a photo that is not hearted auto-hearts it (`AlbumEditor.tsx:270`, `AlbumPage.tsx:95-98` → `POST /api/watch/:id/fav`).
  - "→ לגלריה" goes back to `/<studio>/<id>` (`:137`).

### 1.2 The first draft (`autoAlbum`, `FW/shared/album.ts:256-275`)
- Photos = the gallery's visible photos filtered to the hearts (union of everyone's hearts), **in gallery order** (`AlbumPage.tsx:77`).
- Length = `size.baseSpreads` = **30 spreads** (`album.ts:49`), layout order = the longest of three real album sequences in `album-templates.json` (`defaultSequence`, `:246-253`): spread 1 = `COVER_TEMPLATES[0]` (t01), then the sequence's layouts cycled.
- Photos fill slots in order; `fillSpread` (`:230-243`) pairs photos to slots by shape (portrait → tallest slots).
- Opening spread gets two texts in its white panel: couple name (Assistant 300, size 0.045, `#2b2b2b`, spacing 0.15) and date `d.m.yy` (`formatDate`, `FW/src/lib/format.ts:4-8`; Assistant 400, size 0.022, `#555555`, spacing 0.2), centered (`album.ts:265-271`).
- Few hearts → empty slots remain (allowed).

### 1.3 Editor screen (`FW/src/album/AlbumEditor.tsx`, 1,110 lines)
Header (`:586-635`):
- **"→ לגלריה"**; title **"האלבום של {coupleName}"** + `{size.label} 80×30 ס״מ` (label **"אלבום זוג"**, `album.ts:43`).
- **"↶ ביטול"** / **"↷ חזרה"** (undo/redo, 100 steps, grouped edits within 1.2 s, `:61, :205-248`).
- Stats: **"{n} דפים"** (+ **" · {x} נוספים (+{cost} ₪)"** when priced), **"{n} תמונות · מומלץ 150"**, save state **"שומר…" / "✓ נשמר" / "לא נשמר"** or **"נשלח לסטודיו"** when locked (`:606-616`).
- Buttons: **"⌨"** (keys), **"✦ בנייה אוטומטית"**, **"+ דף"**, **"סיימתי, שלחו לסטודיו"** (`:617-634`).
- Locked banner: **"האלבום נשלח לסטודיו ב-{date}. לשינויים פנו לסטודיו."** + button **"צפייה בהזמנה"** (order already past draft) or **"להמשך ההזמנה: כריכה ותשלום"** (`:637-646`).

Left column — the photo bank (`:662-707`):
- Chips: **"♥ המועדפים {n}"** (hearts + photos already used), **"כל התמונות {n}"**, one chip per gallery set that has photos (set names from the gallery, e.g. התארגנות…).
- **"להסתיר תמונות בשימוש"** checkbox; **"תמונות גדולות" / "תמונות קטנות"** toggle (bank 340px ↔ 420px wide, `styles.css:579-584`).
- Hint: **"גררו תמונה למשבצת (בטלפון: לחיצה ארוכה ואז גרירה), או לחצו על משבצת ואז על תמונה. אפשר לגרור גם לדף ברצועה למטה."**
- Used photos show **"✓ בשימוש"**; tooltip **"כבר באלבום. גרירה תעביר אותה לכאן."**; empty: **"אין תמונות כאן."**
- Thumbs: `${base}/${key}?s=m` (≈640–800 px preview).

Center — the stage (`:709-863`):
- Heading **"דף הפתיחה"** or **"דף {n}"**, plus **" · דף נוסף (+{price} ₪)"** past the included pages.
- Buttons: **"החלפת פריסה"** (L); on the opening only **"+ טקסט"**; on other pages **"חלוקת הדף לשניים"** (D), **"›"**/**"‹"** (move page earlier/later — opening stays first), **"מחיקת הדף"** (confirm **"למחוק את הדף? {n} התמונות שבו יחזרו לבנק."**).
- The spread itself (`SpreadView`, §1.6). Hint: **"גרירה של תמונה מעבירה אותה למשבצת אחרת · לחיצה כפולה על תמונה מאפשרת להזיז אותה בתוך המשבצת · הקו המקווקו הוא הקפל"**.
- Slot tools when a slot is selected (`:766-804`): **"זום"** slider 1–3, **"מיקום בתוך המשבצת"/"סיום מיקום"**, **"איפוס"**, **"העברה למשבצת אחרת"**, **"הוצאת התמונה"**; empty slot: **"משבצת ריקה: לחצו על תמונה בבנק כדי לשים אותה כאן."**; layout surgery: **"◫ פיצול לרוחב"**, **"⊟ פיצול לגובה"**, **"מחיקת המשבצת"**, **"★ שמירת הפריסה"**.
- Text tools (`:806-861`): textarea (max 200), font select (14 fonts, §1.7), **"גודל"** slider, color picker (**"צבע"**), weight chips **"דק" "רגיל" "בינוני" "מודגש"**, **"נטוי"**, **"ריווח"** slider, align **"ימין" "מרכז" "שמאל"**, **"מחיקת הטקסט"**, hint **"גררו את הטקסט על הדף כדי להזיז אותו."**

Bottom — the strip (`:866-891`): mini spreads, label **"פתיחה"** or the number, **" +"** suffix on paid extra pages; drop target for photos; **"+"** between pages = insert here (title **"הוספת דף כאן"**).

Modals: layout picker (`:893-934`), save preset (`:936-958`), auto build (`:960-992`), keyboard (`:994-1030`), add page (`:1032-1056`), submit (`:1058-1085`) — strings in §1.4–§1.10.

Phones: CSS collapses to one column with the bank under the spread (`FW/src/styles.css:619-622`); finger drag via `touchDrag.ts` (§1.6). The editor is usable on phones (e2e "album on a phone").

### 1.4 Layouts / templates (`FW/shared/album-templates.json`, 1,803 lines)
- `{ source, grid: [1600,600], templates: [...42], sequences: { seq-a(36), seq-b(30), seq-c(32) } }`. Each template: `{ id: "t01".."t42", slots: [{x,y,w,h}], panels: [{x,y,w,h}], uses, from }` — all **fractions of the whole spread (0..1)**, reading order right page first. Measured automatically from the owner's real album sketches (`scripts/extract-album-templates.py` in the original app). Identical geometry to the original app; Studio Plan only anonymized `source`/`from`/sequence names (couple names removed).
- Slot counts: 2-photo ×4, 3 ×3, 4 ×4, 5 ×12, 6 ×9, 7 ×6, 8 ×3, 10 ×1. Most used: t03 (4 photos, 18 uses), t18 (6), t09 (3).
- **Opening layouts** = templates with a white names panel: `t01` (2 photos + panel = right quarter, x 0.7475 w 0.2525) and `t25` (2 photos + panel = the whole right page, x 0.5044 w 0.4956) (`COVER_TEMPLATES`, `album.ts:67`). The picker offers them only on spread 1 (`AlbumEditor.tsx:920`).
- Gap between photos = 33 px of 9449×3543 (≈2.8 mm) (`GAP_X/GAP_Y`, `album.ts:99-100`) — baked into the measured rects; used when splitting slots.
- Fold: a slot crossing x≈0.5 gets a red badge **"עוברת בקפל"** (`crossesFold`, `album.ts:183`; `SpreadView.tsx:146`); the fold is a dashed red line (`styles.css:603`).
- Layout picker (`AlbumEditor.tsx:893-934`): title **"בחירת פריסה לדף"**, note **"התמונות שכבר בדף יסודרו בפריסה החדשה לפי הסדר. אם יש פחות משבצות, התמונות הנוספות יחזרו לבנק."**; groups **"{n} תמונות"**; saved layouts section **"★ הפריסות השמורות"** (studio list + album's named custom ones), studio can delete one (**"×"**, confirm **"למחוק את הפריסה מהרשימה השמורה? דפים שכבר משתמשים בה לא ישתנו."**). Icons are SVG 160×60 (`LayoutIcon`, `:1097-1110`).
- `changeTemplate` keeps photos in order, re-pairs by shape; extras return to the bank (`album.ts:278-282`).
- **Custom layouts** (`c_<id>`): split a slot side-by-side / stacked with the gap (`splitSlot`, `:335-339`, refused past 16 slots or below 0.01×0.02 of the spread — toast **"המשבצת קטנה מדי לחלוקה, או שבדף כבר יש את מספר המשבצות המרבי."**), remove a slot (a neighbour sharing its whole edge grows, `removeSlot`, `:342-360`). A custom layout used by a page is stored inside the album (`album.custom`, `withLayout`, `AlbumEditor.tsx:253`) so the album prints on its own.
- **Save layout ("★ שמירת הפריסה")** (`:420-439`, modal **"שמירת הפריסה של הדף"**, field **"שם לפריסה"**, placeholder **"למשל: 3 אנכיות ופנורמה"**, default name **"פריסה {n}"**): if the editor was opened by the studio (`canSave`), `POST /api/watch/:id/layouts` saves it to **all the studio's albums** (`films_studio_settings.album_layouts`, ≤60) — toast **"הפריסה "{name}" נשמרה לכל האלבומים של הסטודיו"**; a couple's saved layout stays **inside their album** — **"הפריסה "{name}" נשמרה באלבום הזה"**.
- `extraSpreadTemplate()` (layout of a new page) = most-used 4–5 photo non-opening layout = t03 (`album.ts:306-309`).

### 1.5 Auto layout — "✦ בנייה אוטומטית" (`storyAlbum`, `album.ts:382-475`; modal `AlbumEditor.tsx:960-992`)
- Modal **"בנייה אוטומטית של האלבום"**: text explains the opening = 1–2 photos from **"צילומי חוץ"** with the names, then pages in the order **"התארגנות, צילומי חוץ, משפחות, טקס חופה, אולם, מסיבה"** (set "ריקודים" counts as מסיבה), one set per page, spread over the 30 pages, layouts fitted to photo shapes.
- Source radio **"מאיזה תמונות?"**: **"המועדפים ({n})"**, **"כל התמונות שמשויכות לסטים ({n})"**, **"רק מהסט "{name}" ({n})"**. Warning **"העיצוב הנוכחי יוחלף. אם לא אהבתם, "↶ ביטול" (Cmd+Z) מחזיר אותו."** Buttons **"ביטול"** / **"בנייה"**.
- Algorithm: groups by set, ranks by STORY_ORDER then other sets then no-set; opening uses t01/t25 with outdoor photos; pages per set ∝ photo count (≥1 each, ≥ ceil(n/10)), balanced to 29 inner pages (more photos → extra pages beyond 30, capped at 60); each page's layout = `bestTemplate` (same slot count, slot shapes vs photo shapes in log-aspect, bonus for frequently-used layouts, penalty for repeating the previous page's layout) (`:366-379`); pads to 30 with empty t03 pages. Keeps the couple's existing opening texts (`AlbumEditor.tsx:457-459`). Toast **"העיצוב נבנה אוטומטית. אפשר לבטל עם ↶ (Cmd+Z)."** — no error if empty source: **"אין תמונות במקור שבחרתם."**
- "Split a page" (`splitSpread`, `album.ts:478-489`): first half stays (keeps an opening layout), second half → new page with a best-fit layout. Not on the opening or with <2 photos: **"אפשר לחלק דף שיש בו לפחות שתי תמונות (לא את דף הפתיחה)."**; done: **"הדף חולק לשניים"**.

### 1.6 Placing, drag & drop, crop, keyboard
- Place: drag from bank (`text/photo`) onto a slot, or select a slot then click a bank photo. **Each photo appears once**: placing a used photo moves it (`place`, `AlbumEditor.tsx:264-271`).
- Drag a filled slot onto another slot (any page; `text/slotref` = `"page:slot"`) = swap; zoom/focus reset (`moveFill`, `:274-285`; `SpreadView.tsx:117-132`).
- Drop on a strip page = first empty slot there; none → **"אין משבצת ריקה בדף הזה. פתחו אותו וגררו על תמונה כדי להחליף."**; done → **"התמונה עברה לדף {n|הפתיחה}"** (`:288-305`).
- Move mode ("X" / **"העברה למשבצת אחרת"**): banner **"בחרו משבצת יעד לתמונה (אפשר לעבור דף עם החצים או ברצועה למטה)."** + **"ביטול (Esc)"**; toast **"בחרו משבצת יעד, בכל דף (החצים מחליפים דף). Esc לביטול."**
- Crop/pan: double-click a photo (or Enter) → badge **"גררו למיקום · לחיצה כפולה לסיום"**; pointer drag moves the focus point `cx,cy` (0..1) with the photo always covering the slot (`placePhoto` cover math, `album.ts:191-212`; `SpreadView.tsx:56-74`). Zoom 1–3 in the UI (server clamps 1–4).
- **Phones** (`FW/src/album/touchDrag.ts`): press and hold 320 ms → vibration + a floating ghost image follows the finger; release over `[data-slot]` or `[data-drop-page]`; moving >10 px before the hold = normal scroll; long-press context menu suppressed.
- Keyboard (`:493-574`, help modal **"קיצורי מקלדת"**): ←/→ next/previous page (Hebrew album: ← = next), Home/End, Tab/Shift+Tab next slot, Enter crop, +/− zoom, 0 reset, Delete remove photo/text, X move, L layout, N new page after this one, D split page, Cmd+Z / Cmd+Shift+Z / Cmd+Y, Esc, ?. Hebrew-layout keys also work (ך, מ, ג, ס).

### 1.7 Text (opening spread only)
- **"+ טקסט"** is shown only on spread 1 (`AlbumEditor.tsx:720-724`); new text = **"הטקסט שלכם"** in the panel centre; ≤12 texts per page, ≤200 chars (`MAX_TEXTS`, `MAX_TEXT_LENGTH`, `album.ts:88-89`); limit toast **"אפשר עד 12 טקסטים בדף."**
- Text model (`AlbumText`, `album.ts:114-129`): `{ id, text, x, y (centre, fraction of spread), size (fraction of spread height, 0.04≈1.2 cm), font, color #rrggbb, weight 300|400|600|700, italic, spacing (em), align }`. Multi-line allowed (`\n`).
- 14 fonts (`FONTS`, `album.ts:153-168`): אסיסטנט, היבו, רוביק, פרנק רוהל, דוד, סואץ, סקולר, אמטיק (כתב יד), קרנטינה, Josefin Sans, Montserrat, Cormorant, Playfair, Great Vibes (כתב). One Google Fonts URL (`FONTS_URL`, `:170-171`).
- Drag a text on the spread to move it (`SpreadView.tsx:76-89`); rendered with CSS = same geometry as the print canvas (`textStyle`, `SpreadView.tsx:173-185`; `drawText`, `render.ts:119-138`, line-height 1.15, RTL when Hebrew letters).

### 1.8 "Cover"
- The couple's designer has **no physical cover design**. "Cover" in the editor = the **opening spread** (דף הפתיחה) with the names panel. The physical cover (material, color), engraving and add-ons are chosen **after sending**, in the hub album portal's purchase wizard (§1.11). (The gallery's own "cover photo" — `worker/covers.ts`, `shared/design.ts` cover styles — is the gallery hero image and is unrelated to the album.)

### 1.9 Page count rules and pricing
- Size: one size only today, `'80x30'` **"אלבום זוג"** 80×30 cm, `spreadPx [9449, 3543]`, 300 DPI, `baseSpreads 30`, `recommendedPhotos 150`, `maxSpreads 60` (`album.ts:40-53`). "Add a line here to offer another size."
- 1 page (דף) in the UI = 1 spread (2 printed pages). Add-page modal says **"האלבום כולל {included} דפים ({included*2} עמודים)."**
- The studio's numbers come from the hub (fix plan P53 — **never a number from code**; the original app had a hard-coded 45 ₪):
  - `includedSpreads` = `album_pricing_settings.included_spreads` (studio default) — else 30 for the editor's display.
  - `extraSpreadPrice` = price of the studio's single active `album_addons` row with `category='extra_pages'` (lowest sort_order) — else `null`.
  - Both from `films_album_order_state` (MIG/0139) via `orderingOf()` (`FW/worker/albums.ts:107-110`); only for studios with the **crm** module (album orders). `albumPrice()` (`album.ts:299-303`).
- Editor rules (`AlbumEditor.tsx:101-115`):
  - Studio **without crm** (no album orders): no prices at all; pages can be added up to 60; send = **"שליחה לסטודיו"**.
  - Studio with crm **and** an extra-page price > 0: pages past the included ones are allowed up to 60 and shown with **"+{price} ₪"** (add modal: **"כל דף נוסף הוא תוספת של {price} ₪."**, **"כבר הוספתם {n} דפים (+{cost} ₪)."**, button **"הוספת דף (+{price} ₪)"**, toast **"נוסף דף (+{price} ₪)"**).
  - Studio with crm but **no** extra-page price: capped at the included pages — **"הסטודיו עוד לא קבע מחיר לדף נוסף, אז אפשר עד {included} דפים. לדפים נוספים פנו לסטודיו."**; at 60: **"באלבום אפשר עד 60 דפים."**
  - Add-page tip: **"טיפ: ה-"+" שבין הדפים ברצועה למטה מוסיף דף בדיוק במקום שבחרתם."**
- The actual charge is computed **server-side in the hub** at purchase: `submit_album_purchase` uses `designed_spread_count` for `couple_designer` orders, `included = coalesce(product.included_spreads, studio.included_spreads)`; refuses `no_extra_page_price` / `pricing_incomplete` (MIG/0138:186-215).

### 1.10 Saving drafts (fix plan P57)
- Autosave **2 s** after the last change, **one save at a time** in a queue, each sent with the `rev` it started from (`AlbumEditor.tsx:53, 160-198`).
- `PUT /api/watch/:id/album { album, rev }` (`FW/worker/index.ts:1420-1428`): couple link only, gallery open (else 410 **"הגלריה נסגרה"**), rate limit 2,000 saves/hour per gallery+IP (**"יותר מדי שמירות בזמן קצר. נסו שוב בעוד כמה דקות."**), body ≤ 512 KB (**"האלבום גדול מדי לשמירה"**), `checkAlbum(…, null)` = shape check only (photo keys must look like 8 hex chars) — anything past a limit is **refused whole, never trimmed**: **"האלבום לא נשמר: {first problem}"** with `problems[]` (`albums.ts:30-39`; messages in `album.ts:521-553`, e.g. **"אפשר עד 60 דפים באלבום"**, **"{בדף הפתיחה|בדף N}: פריסה לא מוכרת"**, **"…: יותר תמונות ממשבצות"**, **"…: טקסט ארוך מ-200 תווים"**). Empty album → **"האלבום ריק"**.
- Conflict (another tab, the partner's phone): 409 `album_conflict` with the saved copy → the page shows the server copy, drops the local change and history, notice **"האלבום עודכן ממכשיר אחר. מוצגת הגרסה העדכנית."**; if it was sent elsewhere: **"האלבום נשלח לסטודיו ממכשיר אחר."** (`takeServer`, `AlbumEditor.tsx:144-158`; `albums.ts:11-19`).
- Network failure → state **"לא נשמר"** + **"השמירה נכשלה. בדקו את החיבור לאינטרנט."**; the pending change is retried on the next change or on send.
- Sent album → saves refused 409 `album_sent` **"האלבום כבר נשלח לסטודיו. לשינויים צריך לפנות לסטודיו."**
- No `beforeunload` guard: a change made <2 s before closing the tab can be lost (see risks).

### 1.11 Sending to the studio, the order and payment
- **"סיימתי, שלחו לסטודיו"** → modal **"לשלוח את האלבום לסטודיו?"** (`AlbumEditor.tsx:1058-1085`): **"{n} דפים, {m} תמונות."**; extra pages **"{x} דפים נוספים: תוספת של {cost} ₪."**; empty slots **"יש עוד {n} משבצות ריקות. אפשר לשלוח גם ככה, והסטודיו ישלים."**; **"אחרי השליחה לא אפשר לשנות לבד. אם תרצו שינוי, הסטודיו יפתח לכם את האלבום מחדש."**; with orders **"בשלב הבא בוחרים מוצר, כריכה, חריטה ותוספות, ומשלמים."**; buttons **"עוד לא"** / **"שליחה והמשך להזמנה"** (crm) or **"שליחה לסטודיו"**.
- Client: saves first (if the server copy changed meanwhile it shows it and stops), then `POST /api/watch/:id/album/submit { rev }` (`:466-490`).
- Server (`FW/worker/index.ts:1434-1457`, `albums.ts:47-73`):
  1. `submitAlbum`: reads the album, refuses a stale `rev` (409), reads the **visible** photo list only now; photos the studio hid since are emptied from their slots (`removed` → toast **"{n} תמונות שהסטודיו הסתיר הוצאו מהאלבום."**); writes `status='submitted', submittedAt` with `draftOnly` (a second click = no-op, `sent:false`).
  2. If `orderNeeded` (first send, or order missing, or unpaid order with another page count): `films_album_order_from_design(gallery, spreads, sha256(token))` → makes/refreshes the hub order (§3.4). Failure ⇒ **200 with `orderPending: true`** (the album stays sent; **"האלבום נשלח לסטודיו. ההזמנה עוד לא נפתחה — לחצו "להמשך ההזמנה" בעוד רגע."**).
  3. Answers `{ album, summary, ordering, removed }`.
- Then the browser goes to the order: `GET /api/watch/:id/album/order` → `{ url: "${HUB_URL}/album/<token>" }` (`index.ts:1460-1467`, `orderLink`, `albums.ts:113-120`). The portal token is **derived, never stored**: `HMAC(derivedKey(secret,'studio-plan/films/album-order-key/v1'), 'album-order:<galleryId>')`; the DB stores only its SHA-256 in `album_orders.portal_token_hash` (`albums.ts:84-96`; legacy derivation still accepted). If the studio made its own portal link → 409 **"הסטודיו שלח לכם קישור אחר להזמנה. השתמשו בו, או פנו לסטודיו."**; revoked → 403 **"הסטודיו ביטל את הקישור להזמנה. פנו לסטודיו."**; none → 404 **"עוד אין הזמנה לאלבום הזה"** (then `AlbumPage.orderUrl` re-sends to make it; still none → **"ההזמנה עוד לא נפתחה. נסו שוב בעוד כמה דקות, או פנו לסטודיו."**, `AlbumPage.tsx:12-27`).
- **In the hub album portal** (`HUB/pages/AlbumPortal.jsx`, Wedding Albums module — Avira has an older copy): the order arrives already **`approved`**, so the couple skips the sketch review and lands in the purchase wizard: steps **"מוצר", "כריכה", "חריטה", "תוספות", "משלוח", "תשלום"** (`:786-787`). The header shows a link back **"האלבום שעיצבתם ←"** to `${FILMS}/<slug>/<gallery>/album` (`DesignedAlbumLink`, `:312-322`). Page count for pricing = `designedSpreadCount` (`:862-863`). Purchase = one RPC `submit_album_purchase` (MIG/0138) → `awaiting_payment`.
- **Payment = bank transfer + proof upload** (`PaymentStep`, `AlbumPortal.jsx:1737-1855`): **"תשלום בהעברה בנקאית"**, **"סכום לתשלום: …"**, the studio's bank details (בנק / סניף / מספר חשבון / שם בעל החשבון / notes, from tenant settings, migration 0044) or **"לפרטי חשבון להעברה, אנא פנו לסטודיו בוואטסאפ או בטלפון."**; upload **"העלאת אסמכתת העברה (צילום מסך / קובץ)"** (image/* or PDF, signed upload URL into `album-files/<tenant>/<order>/transfer-proof/…`, then `confirmTransferProofUploaded`) → `payment_status='transfer_pending_review'`, **"אסמכתת ההעברה התקבלה, ממתינה לאישור הסטודיו."**, **"העלאת אסמכתא אחרת"**; rejected → **"הסטודיו לא אישר את האסמכתא הקודמת. העלו בבקשה אסמכתא אחרת."**; studio marked paid → **"התשלום התקבל. הסטודיו יבדוק את פרטי ההזמנה ויעדכן אתכם."** No card/online payment.
- Post-payment statuses shown to the couple (`:1859-1879`): **"התשלום התקבל, האלבום בהכנה"**, **"האלבום בהדפסה"**, **"האלבום נשלח אליכם"**, **"ההזמנה הושלמה, מקווים שנהניתם!"**

### 1.12 Statuses (end to end)
- Album doc (`films_albums.status`): `draft` → `submitted` (couple sends) → `draft` again only by the studio's unlock (§3.3). Couple UI: **"בעבודה אצל הזוג"** / **"נשלח ב-{date}"** (hub card).
- Order (`album_orders.workflow_status`, hub labels `HUB/pages/AlbumOrders.jsx:39-51`): created as `approved` **"אושר"** → `product_selected` **"מוצר נבחר"** → `awaiting_payment` **"ממתין לתשלום"** → `paid` **"שולם"** → `in_print` **"בהדפסה"** → `delivered` **"נמסר"** → `completed` **"הושלם"**. (`draft/sketch_uploaded/in_review/revision_requested` belong to studio-made sketches; not used by `couple_designer` orders, except a joined order that was in those states.)
- Payment (`payment_status`): `unpaid` **"לא שולם"** → `transfer_pending_review` **"העברה ממתינה לאישור"** → `paid` **"שולם"** (`paid_at` set by trigger, MIG/0082:32-52).
- Re-send rules (`films_album_order_from_design`, MIG/0139:194-305): unpaid → count updated, back to `approved` (buy again at the new price); proof pending → count updated, back to `approved` + `unpaid` (proof kept, studio told); paid → nothing changes, studio told both counts (print link pauses until the studio accepts, §3.5); later steps → unchanged + notice.

### 1.13 Closed gallery
- `GET album` → 410 for the couple (studio still allowed); `PUT` → 410; send → only an already-sent album may be "sent" again (to make a missing order), a draft gets 410 (`albums.ts:55-57`). The album page shows **"הגלריה נסגרה"** + **"להמשך ההזמנה"** (works after closing). The print-shop link keeps working (30 days from its creation).

---

## 2. The studio's flow (A side)

### 2.1 The gallery screen in the hub — "האלבום של הזוג" card
`HUB/components/films/PhotosEditor.jsx:738-742` (mount) and `:837-1025` (`AlbumCard`):
- Not started: **"הזוג עוד לא התחיל לעצב. הכפתור "עיצוב האלבום" מופיע להם בגלריה."**
- Status pill **"נשלח ב-{date}"** or **"בעבודה אצל הזוג"**; **"{n} דפים"**, **"{n} תמונות"**, **"{x} דפים נוספים · +{cost} ₪"** or **"· לא הוגדר מחיר לדף נוסף"**, **"{n} משבצות ריקות"**.
- Order line: **"כשהזוג שלח את האלבום נפתחה הזמנת אלבום, והם ממשיכים בה לבחירת מוצר, כריכה ותשלום. להזמנה"** → `/AlbumOrders/:id`. Missing order: **"הזוג שלח את האלבום אבל הזמנת האלבום עוד לא נפתחה. היא תיפתח כשהזוג ילחץ "להמשך ההזמנה" בעמוד האלבום."**
- Buttons: **"צפייה באלבום"** (opens the couple's editor as the studio: `${coupleUrl}/album?pt=<previewToken>` — the studio can edit the draft and save layouts for all albums), **"הורדה לדפוס (300DPI)"** (`${coupleUrl}/print?pt=…`, §4), **"פתיחה לעריכה מחדש"** (only when sent; confirm **"לפתוח את האלבום לעריכה מחדש? הזוג יוכל לשנות אותו ולשלוח שוב. קישור בית הדפוס יושהה עד שישלחו שוב."**; toast **"האלבום נפתח לעריכה"** / **"…. קישור בית הדפוס מושהה עד שהזוג ישלח את האלבום שוב."**).
- Print-shop link block **"קישור לבית הדפוס"** with text **"קישור פרטי לבית הדפוס: מוריד את דפי האלבום כפי שהזוג שלח אותו, באיכות מלאה, בלי סיסמה ובלי לראות שום דבר אחר מהגלריה. עובד 30 יום מיצירתו (אפשר לחדש), גם אחרי שהגלריה נסגרת לזוג."**; dates **"נוצר {d} · בתוקף עד {d}"** / **"פג ב-{d}"**; paused texts (`PRINT_PAUSED`, `:838-841`); hidden-photo warning **"{n} תמונות באלבום מוסתרות בגלריה. בית הדפוס עדיין יקבל אותן כחלק מהאלבום. כדי להוציא אותן, פתחו את האלבום לעריכה והחליפו אותן."**; buttons **"יצירת קישור לבית הדפוס"** (only after send; else **"אפשר ליצור קישור לבית הדפוס אחרי שהזוג שולח את האלבום."**), **"העתקה"**, **"חידוש ל-30 יום"**, **"ביטול הקישור"** (confirm **"לבטל את הקישור? מי שקיבל אותו לא יוכל להוריד יותר."**).

### 2.2 Dashboard tiles (`HUB/components/films/GalleriesSummary.jsx`; Worker `FW/worker/dashboard.ts`; SQL `films_dashboard`, MIG/0133:99-109)
- Tile **"אלבומים שהזוגות שלחו"** (photos module, or any sent): the 10 newest `films_albums.status='submitted'` of open/closed (not trashed) galleries; shows up to 6 (4 compact) — couple name → `/photos/<galleryId>` + short date; empty **"עוד לא נשלחו אלבומים."** (`:107-125`).
- Inside the "גלריות פתוחות" tile, with crm: **"ממתינות לתשלום: {n} ({total})"** (link to `/AlbumOrders`) and **"התקבל החודש מאלבומים: {sum}"** (`:69-79`). Computed **in the browser** from `album_orders(total_amount, payment_status, workflow_status, paid_at)` over **all** album orders (studio-made and couple-made): waiting = not paid and (`awaiting_payment` or `transfer_pending_review`); paid this month = `paid` with `paid_at` in the current Israel month (`orderMoney`, `:21-27`).

### 2.3 Notifications
- Every send writes `notifications(type='album_designed_by_couple', title, body, related_album_order_id)` (MIG/0139:300-301). Titles: **"אלבום חדש עוצב על ידי הזוג: {names}"**, **"הזוג עיצב את האלבום של ההזמנה: {names}"** (joined), **"הזוג שלח את האלבום מחדש: …"**, **"הזוג שלח את האלבום מחדש לפני שאישרתם את ההעברה: …"**, **"הזוג שלח את האלבום מחדש אחרי התשלום: …"**. Bodies e.g. **"{n} דפים. הזוג ממשיך לבחירת מוצר, כריכה ותשלום."**, **" העיצוב צורף להזמנה שפתחתם לאירוע הזה."**, **" לאירוע הזה יש עוד {n} הזמנות אלבום — כדאי לבדוק שזו לא כפילות."**, **"{n} דפים (בהזמנה ששולמה: {m}). המחיר לא השתנה, כדאי לבדוק."** Bell routes it to `/AlbumOrders`, tab "albums" (`HUB/lib/notificationCategories.js:55,131`).

### 2.4 The order in the hub (Wedding Albums module)
- List: badge **"עוצב על ידי הזוג"** (`HUB/pages/AlbumOrders.jsx:378-380`).
- Detail: `DesignedAlbumCard` (`HUB/components/albums/DesignedAlbumCard.jsx`), title **"עוצב על ידי הזוג"**: **"הזוג עיצב את האלבום בגלריית התמונות שלו ({n} דפים). אין כאן סקיצה להעלות: העמודים הם העיצוב שלהם, ומהם יוצאים קבצי הדפוס."**; buttons **"פתיחת האלבום"** (`/album?pt=`), **"קבצים לדפוס"** (`/print?pt=`), **"לגלריה"** (admins), **"הקישור של הזוג להזמנה"** (copies the derived portal URL; toast **"הקישור של הזוג להזמנה הועתק"**). Errors: gallery deleted **"הגלריה של האלבום נמחקה, ולכן אין גישה לעיצוב ולקבצים."**, no module **"הפתיחה והקבצים לדפוס זמינים עם מודול גלריות התמונות."**, forbidden **"אין הרשאה לפתוח את הגלריה של האלבום (רק מנהלי הסטודיו)."**
- The "גרסאות סקיצה" card and the hub's own lab link are hidden for these orders (`AlbumOrderDetail.jsx:1146, 1840-1843`: **"האלבום עוצב על ידי הזוג: קבצי הדפוס והקישור לבית הדפוס נמצאים בכרטיס "עוצב על ידי הזוג" ובגלריית התמונות."**). WhatsApp messages to the couple use the derived link (`:1034-1035, 1541-1547`); making a new portal link warns it breaks the gallery's order button (`:1495`).
- Everything else (mark paid, reject proof "דחיית אסמכתא", in_print/delivered/completed) is the existing module.
- Gallery ↔ event link: the hub gallery form field **"האירוע של הזוג (לא חובה)"**, hint **"כשהזוג שולח אלבום שעיצב, הוא מצטרף להזמנת האלבום הפתוחה של האירוע, בלי הזמנה שנייה."** (`HUB/pages/films/FilmsGalleryForm.jsx:461`; Worker/DB check same tenant, MIG/0139 trigger).

### 2.5 Reopen / accept a new page count
- Unlock: `POST /api/admin/galleries/:id/album/unlock` (photos module, write) → status back to `draft` (`albums.ts:122-131`; `index.ts:1509-1520`).
- Paid order + couple re-sent with another page count → print link paused `pages_changed`; card shows **"הזוג שלח את האלבום שוב אחרי התשלום עם {n} דפים (בהזמנה ששולמה: {m}). קישור בית הדפוס מושהה עד שתאשרו את מספר הדפים החדש."** + **"אישור {n} דפים"** (confirm **"לאשר {n} דפים להזמנה ששולמה? המחיר בהזמנה לא משתנה — הפרש, אם יש, מסדירים עם הזוג. קישור בית הדפוס יחזור לעבוד."**) → `POST …/album/confirm-pages` → `films_album_order_confirm_spreads` (MIG/0140:282-307). Price never changes automatically after payment.

### 2.6 Trash guards (P71)
- Moving a gallery with a designed album to the trash / purging: `albumGuard` (`FW/worker/galleries.ts:328-347`, SQL `films_album_guards` MIG/0135): open order → refused (**"לגלריה יש הזמנת אלבום פתוחה. אי אפשר להעביר אותה לסל המחזור או למחוק אותה עד שההזמנה נמסרה או הושלמה."**); sent album → needs a yes (**"הזוג כבר שלח את האלבום שעיצב בגלריה הזו. בסל המחזור הקישור יפסיק לעבוד ואחרי 30 יום העיצוב יימחק. לאשר?"**); paid/in print → never purged (**"לגלריה יש הזמנת אלבום ששולמה או בהדפסה, ולכן העיצוב נשמר ואי אפשר למחוק אותה לצמיתות."**). Hub: `HUB/pages/films/FilmsGalleries.jsx:209-259`.

### 2.7 "Convert to the print shop"
There is no conversion step: the studio either renders the files itself (§4.1, "הורדה לדפוס (300DPI)" / "קבצים לדפוס") or sends the print shop the private link (§4.2). The order's lab link of the Wedding Albums module (`print_access_links`) is **not** used for couple-designed orders.

### 2.8 The studio sketch editor (C) and the gallery — "opened from an album (order)"
- Entry: on the order page, button **"🎨 עורך סקיצה (בטא)"** inside "גרסאות סקיצה" (needs `photos` module; route `/AlbumOrders/:orderId/design`, `HUB/App.jsx:76, 360, 448`; `AlbumOrderDetail.jsx:1155-1159`). **Not shown for `couple_designer` orders.**
- First open (`Setup`, `HUB/pages/AlbumDesignEditor.jsx:226-330`): **"🎨 עורך סקיצה (בטא) — {names}"**, **"התמונות מגיעות מגלריית התמונות של האירוע (ונשארות שם — שום דבר לא מועתק), ואפשר להוסיף תמונות מהמחשב."**; finds the event's gallery (**"נמצאה גלריית התמונות של האירוע: {name} · {n} תמונות"** / **"לאירוע הזה עוד אין גלריית תמונות."**), select **"מאיזו גלריה לקחת תמונות"** (option **"בלי גלריה — רק תמונות מהמחשב"**), or create a gallery from a shared Drive/Dropbox/pCloud folder (**"או: גלריית תמונות לאירוע מתיקייה משותפת (Google Drive, Dropbox או pCloud — "כל מי שיש לו את הקישור"):"**, button **"טען"**), and **"כמה כפולות באלבום (כולל הפתיחה) — אפשר לשנות אחר כך"**.
- Photo bank through the films Worker (`HUB/lib/albumDesigner/source.js`; routes `FW/worker/index.ts:796-870`, `FW/worker/albumDesigner.ts`): `GET /api/admin/album-designer/galleries` (photo galleries, not trashed, with `eventId`), `GET …/galleries/:id/photos` (visible photos only: key, name, ar, t, set, folder, size + sets + a **thumbs token** for small previews), `GET …/galleries/:id/file/:key?s=l|full` (large/original through the signed-in session, never edge-cached), `POST …/galleries/:id/sizes` (pixel sizes from the first 64 KB of each original, for the DPI warning). Roles: owner/admin/studio_manager/album_manager (`DESIGNER_ROLES`). Read-only routes.
- The couple's editing of C from the portal reads the gallery via `POST /api/album-portal/design-bank { token }` (only while `album_designs.client_edit_enabled`; small previews only; rate limit 120/10 min per IP, 60 per order, ≤5 galleries) (`index.ts:879-902`; SQL `films_album_design_bank`, MIG/0173:150-188).
- Its document (`album_designs.doc`, MIG/0172) references gallery photos as asset ids `g:<galleryId>:<photoKey>` — never URLs (`HUB/lib/albumDesigner/doc.js:1-27`).
- Output: "📤 ייצוא" renders full-size spreads and creates a normal `album_versions` version of the order (B) — the same pipeline as a manual upload.

---

## 3. Data model

### 3.1 `films_albums` (MIG/0078, + 0139, + 0140) — one row per photo gallery
| column | type | notes |
|---|---|---|
| `gallery_id` | text PK → `films_galleries(id)` on delete cascade | one album per gallery |
| `tenant_id` | uuid → tenants | |
| `data` | jsonb | **the album document** (below); `rev` is never stored inside it |
| `status` | text `draft`/`submitted` | |
| `updated_at`, `submitted_at` | timestamptz | |
| `rev` | bigint default 1 | +1 on every UPDATE (trigger `films_albums_next_rev`) — optimistic concurrency |
| `print_data` | jsonb | **frozen copy as sent** (trigger `films_albums_print_copy`: on every write of a submitted album whose data changed) — what the print shop gets |
| `print_submitted_at` | timestamptz | |
RLS: SELECT for authenticated where `tenant_id = current_tenant_id()`; all writes service role only (the Worker); `apply_tenant_write_gate`. The hub never reads it directly.

**Album document** (`Album`, `FW/shared/album.ts:104-151`):
```
{ size: "80x30",
  spreads: [{ id, template: "t01".."t42" | "c_<id>",
              fills: [{ photo: "<8-hex key>" | "", zoom: 1..4, cx: 0..1, cy: 0..1 }],   // index = slot index
              texts: [{ id, text, x, y, size, font, color, weight, italic, spacing, align }] }],
  custom?: [{ id: "c_…", slots: [Rect], panels: [Rect], uses: 0, name? }],          // ≤80 sent, ≤60 kept
  status: "draft" | "submitted", updatedAt, submittedAt? }
```
Photo key = the gallery's 8-hex photo key (`PHOTO_KEY_RE`); the doc holds no URLs.

### 3.2 Other columns / tables
- `films_studio_settings.album_layouts jsonb default '[]'` — the studio's saved layouts (MIG/0078:24-25), cleaned by `cleanCustom`, ≤60.
- `films_galleries.print_token text` (unique, `^[A-Za-z0-9_-]{20,64}$`, MIG/0079) + `print_token_created_at` (MIG/0140; trigger `films_galleries_print_token_at`; cleanup `films_print_links_expire(30)`); `films_galleries.event_id` (MIG/0069, same-tenant trigger MIG/0139).
- `album_orders` additions (MIG/0080): `source text 'studio'|'couple_designer'`, `films_gallery_id text → films_galleries on delete set null` (unique where not null — one order per designed album), `designed_spread_count int 0..200`. Only the Worker (service role) may set these three (trigger in MIG/0087:189-195). `paid_at` (MIG/0082). `transfer_proof_rejected_at` (MIG/0138).
- `album_pricing_settings` (MIG/0138): one row per studio — four engraving prices + `included_spreads`; `album_products.included_spreads` per product; one active `extra_pages` add-on per studio (unique index).
- `notifications` type `album_designed_by_couple`.

### 3.3 RPCs (all `security definer`, service role only)
| function | migration | purpose |
|---|---|---|
| `films_album_put(tenant, gallery, data, rev, draft_only)` | 0139 | the only album write: under row lock, only onto `rev` (null = no check), never a draft onto a sent album; answers `{ok, rev}` or `{ok:false, reason: conflict|submitted|not_found, rev, data, status}` |
| `films_album_order_state(gallery)` | 0139 (last) | `{crm, extraPagePrice, includedSpreads, order:{id, workflowStatus, paymentStatus, tokenHash, revoked, spreads}}` |
| `films_album_order_from_design(gallery, spreads, token_hash)` | 0139 (last) | advisory lock per gallery; join the event's open studio order (unpaid, no versions, no gallery) or create `approved` order; re-send rules; bell notification |
| `films_album_order_confirm_spreads(gallery, spreads)` | 0140 | studio accepts a new page count after payment |
| `films_album_guards(tenant, ids[])` | 0135 | album + order status for trash/purge guards |
| `films_dashboard(tenant, films, photos)` | 0133 | includes `albumsSent` (10) |
| `films_print_links_expire(days)`, `films_close_lapsed_studios(grace)` | 0140 | cleanup |
| `films_album_design_bank(token_hash)` | 0173 | (C) the couple's portal reads the sketch's gallery |
Store layer: `FW/worker/store.ts:75-121, 307-413`; Supabase impl `FW/worker/store-supabase.ts:340-366, 504-527, 668-705`.

Migrations that belong to the **gallery album (A)**: 0078, 0079, 0080, 0087 (integrity), 0106 (safe date in from_design), 0133 (dashboard), 0135 (guards), 0139, 0140 (print copy/links), 0141 (tenant fill). **Wedding Albums module (B)**: 0031–0036, 0039–0040, 0043–0044, 0137, 0138, 0143, 0165. **Studio sketch editor (C)**: 0172, 0173, 0174.

---

## 4. Rendering / export (client-side canvas)

### 4.1 The print files (`FW/src/print/render.ts`, `PrintExport.tsx`)
- One JPEG per spread, **9449×3543 px at 300 DPI** (80×30 cm), quality 0.95, white background, drawn in the **browser** on a canvas from the **original** photos (`?s=full`; fallback `?s=l` ≈2048 px when the browser cannot decode the original, e.g. HEIC → counted as "lowRes"). Two originals at a time. Slot edges snapped to whole pixels; photo drawn with `placePhoto` (same math as the screen) and clipped to the slot; texts drawn after with the same geometry as CSS. JFIF density patched to 300 DPI (`setJpegDpi`, `FW/shared/print.ts:13-31`).
- Capability check: a test canvas of full size (`canRenderFullSize`) → else **"הדפדפן או המכשיר הזה לא יכול לבנות קובץ בגודל הזה. פתחו את הדף בכרום במחשב."**
- File names **"{couple name} {n}.jpg"** (`spreadFileName`, `print.ts:4-7`, e.g. "דניאל & סבינה 3.jpg").
- UI: page range **"דפים:"** (placeholder **"הכל (או למשל 1-5, 8)"**, `parsePageRange`), **"שמירה לתיקייה במחשב"** (File System Access API, Chrome) or **"הורדה קובץ אחר קובץ"**, **"עצירה"**, per-page rows (**"ממתין"**, **"מוריד תמונות מקוריות…"**, **"תמונות d/t"**, **"שומר…"**, ✓/✗), preview of the last spread, summary **"הסתיים: {ok} מתוך {n} דפים נשמרו{ בתיקייה שבחרת| בתיקיית ההורדות}."**; warnings **"שימו לב: הזוג עוד לא לחץ "סיימתי""**, **"ב-{n} תמונות הדפדפן לא הצליח לקרוא את המקור (למשל קובץ HEIC), ונעשה שימוש בגרסה מוקטנת. …"**; info **"כל דף נשמר כקובץ JPEG אחד של שני עמודים: 9449×3543 פיקסלים ב-300 DPI, מהתמונות המקוריות באיכות מלאה. …"**
- Studio page `/<studio>/<gallery>/print` (`StudioPrint.tsx`): opened from the hub with `?pt=`; `GET /api/watch/:id/print` refuses anyone but the studio (**"הדף הזה נפתח מתוך המערכת של הסטודיו (הורדה לדפוס)."**); renders the **current** album (even a draft; passes the download code, hidden photos, closed gallery). Heading **"הורדה לדפוס · {names}"**, empty **"לזוג עוד אין אלבום."**

### 4.2 The print-shop link (`/print/<token>`, `FW/src/print/PrintPage.tsx`; Worker `index.ts:1665-1802`; rules `FW/worker/printLink.ts`)
- Made in the hub card only after the couple sent the album; random 32-char token; valid **30 days** from creation/renewal (`PRINT_LINK_DAYS`), renewable, revocable (also by a read-only studio); works after the gallery closes; stops at once if the gallery is trashed, the studio suspended or loses `photos`.
- Serves **only `print_data`** (the album as sent) and only photos used in it (others 404); hidden-since photos still print (studio warned).
- Paused (409) with words (`PRINT_BLOCK_WORDS`): `not_sent` **"הזוג עוד לא שלח את האלבום. הקישור יעבוד אחרי השליחה."**, `album_open` **"האלבום נפתח מחדש לעריכה אצל הזוג. הקישור מושהה עד שהזוג ישלח אותו שוב."**, `pages_changed` **"הזוג שלח מספר דפים שונה מההזמנה ששולמה. הקישור מושהה עד שהסטודיו יאשר את מספר הדפים החדש."**; expired **"תוקף הקישור פג. בקשו מהסטודיו לחדש אותו."**; bad link **"הקישור לא בתוקף. בקשו קישור חדש מהסטודיו."**
- Page: studio name + **"הורדת אלבום לדפוס"** + the same `PrintExport` with intro **"הקבצים נבנים עכשיו במחשב שלכם מהתמונות המקוריות. זה לוקח כמה שניות לכל דף. השאירו את הדף פתוח עד הסוף."** — i.e. the **print shop's browser** renders the files.
- Worker keeps the album+block per gallery for 60 s (≤2 galleries) to serve the many photo requests.

### 4.3 Screen rendering
DOM/CSS (`SpreadView.tsx`): spread box with `aspect-ratio: 80/30`, slots/panels as % boxes, `<img>` positioned by `placePhoto`; previews `?s=l` for slots wider than 30% of the spread, else `?s=m`. No canvas on screen.

---

## 5. API summary (films Worker)
| method | path | who | what |
|---|---|---|---|
| GET | `/api/watch/:id/album` | couple link (or studio cookie) | `{album (+rev), ordering, orderingFailed?}`; 410 closed (not for studio) |
| PUT | `/api/watch/:id/album` | couple link / studio | save draft `{album, rev}` |
| POST | `/api/watch/:id/album/submit` | couple / studio | send; makes the order |
| GET | `/api/watch/:id/album/order` | couple | `{url}` of the hub portal |
| GET/POST | `/api/watch/:id/layouts` | couple read; studio save/remove | studio's saved layouts |
| GET | `/api/watch/:id/print` | studio only | album for the studio export |
| GET | `/api/admin/galleries/:id/album` | studio (photos) | `{album, summary, order{id,workflowStatus,paymentStatus,spreads,coupleLink}, print{sentSpreads,paused}, orderMissing?}` |
| POST | `/api/admin/galleries/:id/album/unlock` | studio write | reopen |
| POST | `/api/admin/galleries/:id/album/confirm-pages` | studio write | accept new page count |
| GET/POST/DELETE | `/api/admin/galleries/:id/print-link` | studio | view / make or `{renew:true}` / revoke |
| GET | `/api/print/:token`, `/api/print/:token/photo[/:ver]/:key` | public token | print shop |
| GET | `/api/admin/dashboard` | studio | incl. `albumsSent` |
| GET/POST | `/api/admin/album-designer/…`, `/api/album-portal/design-bank` | (C) | sketch editor bank |
`albumSummary()` = `{status, spreads, photos, empty, extraSpreads, extraCost, updatedAt, submittedAt}` (`albums.ts:156-160`).

---

## 6. Relation to the Wedding Albums module and to Avira's own album editor

### Same code
- **Wedding Albums module** (orders, catalog, portal purchase wizard, bank-transfer proof, lab link, statuses, roles): Studio Plan's hub is a copy of Avira's, **plus** fixes Avira does not have: `album_pricing_settings` + per-product `included_spreads` + one-RPC purchase `submit_album_purchase` (0138, P53 — Avira's `album-portal/index.ts:491` still hard-codes `PAGE_BASELINE = 30` and engraving prices 110/220/100/130), workflow guard + reopen (0137), print link expiry/proof privacy (0140), `paid_at` (0082), `transfer_proof_rejected_at`.
- **Studio sketch editor (C)**: Studio Plan's `HUB/lib/albumDesigner/*`, `HUB/components/albumDesigner/*`, `HUB/pages/AlbumDesignEditor.jsx` are ports of Avira's `src/lib/album*.js`, `src/components/albumEditor/*`, `src/pages/AlbumDesignEditor.jsx` (FEATURES §12לא–§12לג; migrations Avira 0079–0081 ↔ Studio Plan 0172–0174). Same 43 measured templates + generated ones, 38 px gutter, B&W filters, opening with Hebrew date, autosave 2 s + `doc_version`, revisions, auto-sketch, couple draft `client_doc`, enlargements.

### Different
- **Photo source of C**: Avira = public **Google Drive folder** read in the browser with `VITE_GOOGLE_API_KEY` (`src/lib/googleDrive.js`); Studio Plan = the event's **photo gallery** through the films Worker (no Google key in the hub), asset ids `g:<gallery>:<key>`, plus uploads to `album-files/<studio>/<order>/design-uploads/`. Avira keeps enlargements in a JSON column; Studio Plan in table `album_enlargements` (0174).
- **A vs C** are different products: A = couple-first, simple (42 measured layouts, 33 px gap, fractions 0..1, one opening text panel, 14 fonts, zoom/pan, split/remove slots, story auto-build by gallery sets), doc in `films_albums.data`, output goes to the order as a **page count only** (no `album_versions`), print files rendered on demand from the doc. C = studio-first, rich (Lightroom-style adjustments, heal brush, soft blend, branding, face-on-fold warning, 1–20 photo layouts), doc in `album_designs.doc`, output = uploaded spread files as an order version.
- The original films app (live for Avira today) has A **with its own order system** (D1 `orders`, KV catalog, `/order` wizard, 7 statuses `draft/awaiting_payment/receipt_sent/paid/printing/shipped/done`, labels "הזוג ממלא"…"הושלם", bank transfer + receipt, `extraSpreadPrice: 45` hard-coded). Studio Plan replaced that with the hub module. Layout JSON geometry is identical.

### What Avira already has (main app)
- Wedding Albums module (0031+), album portal with bank transfer + proof, lab link, catalog, album guide.
- Studio sketch editor C with Drive sources, couple editing, enlargements.
- **Not** in Avira's main app: photo galleries, the couple's gallery album designer (A), `films_albums`, `album_orders.source/films_gallery_id/designed_spread_count`, the derived portal token, order-from-design RPCs, gallery print link + frozen `print_data`, P53 pricing settings, P57 rev/conflict handling, gallery→event linkage, the dashboard album tiles. (A exists for Avira only inside the separate films app, wired to that app's own orders.)

### What a faithful rebuild in Avira needs (minimum)
1. `films_albums`-equivalent table (one JSON doc per gallery, `rev` trigger, `print_data` freeze trigger, `films_album_put` RPC) + studio saved layouts column.
2. Copy `shared/album.ts`, `album-templates.json`, `shared/print.ts`, `src/album/*`, `src/print/*` as they are (pure TS/React; they are already shared code in two systems).
3. Gallery photo list with `key`, `ar`, `set`, hearts, `base` preview URL (`?s=m|l|full`), visible/hidden flag.
4. `album_orders` columns `source`, `films_gallery_id`, `designed_spread_count` + `films_album_order_state` / `_from_design` / `_confirm_spreads`; the portal must price `couple_designer` orders by `designed_spread_count` and skip review (Avira's portal currently counts `album_spreads` of the current version vs 30).
5. Hub UI: gallery "האלבום של הזוג" card, `DesignedAlbumCard`, list badge, dashboard tiles, bell type, trash guards, print-link card.

---

## 7. Tests (Studio Plan)
- `FW/test/album.test.ts` (271 l.): 42 layouts + cover panel; 9449×3543@300; fold; cover-fit math; first draft (30 spreads, names, hearts in order, portraits to tall slots); studio price / no price (never 45); validation clamps; split/remove slot; bestTemplate; story build; split page; custom layouts kept/refused; P57 limits refused whole; registry never grows server-side.
- `FW/test/album-orders.test.ts` (272 l.): no-crm send; studio numbers; couple link only while the order keeps its token; P73 key + legacy token; send twice = once; trash guards (P71); P57 orderPending, unreadable order state, closed gallery resend, proof-pending resend charged, joining the event's order, stale rev 409, 61 pages / >512 KB refused, draft never reads the photo list.
- `FW/test/album-designer.test.ts` (245 l.): (C) bank routes, roles, hidden photos, pixel sizes, read-only studio, portal design-bank limits.
- `FW/test/print.test.ts` (25 l.): file names, DPI patch, page ranges. `FW/test/print-link.test.ts` (199 l.): link only after send, paused when reopened, pages_changed, 30-day expiry/renew/cleanup, read-only studio can revoke, lapsed studios.
- `FW/e2e/gallery.spec.ts`: `:778` designer (draft from hearts, text, layout, extra page 52 ₪, reload, submit → portal URL, locked, 409 after send, unlock, guests 403); `:875` two tabs; `:900` closed gallery → order; `:921` editor (set tabs, auto build, drag/move, insert/split, layouts, undo/redo, keys); `:1043` phone finger drag; `:1088` print export (9449×3543@300 verified, print-shop link, pause/resume, after close, revoke).
- DB tests: `tools/db-test/tests/album-designer.test.mjs`, `print-links.test.mjs`, `films-platform.test.mjs`.

---

## 8. Open questions / risks
1. **Two different "included pages" numbers**: the editor uses only the studio default (`album_pricing_settings.included_spreads`), but the purchase charges by the chosen product's `included_spreads` when set → the "+X ₪" the couple saw can differ from the charge.
2. **Price is a page count only**: the order stores `designed_spread_count`, not the design; after payment a re-send changes nothing financially ("הפרש, אם יש, מסדירים עם הזוג") — manual reconciliation.
3. **Rendering depends on the reader's browser** (print shop must use desktop Chrome; phones fail the full-size canvas check; HEIC originals silently fall back to ≈2048 px with only a warning). No server-side render or stored print files.
4. **No `beforeunload` guard**: the last <2 s of edits can be lost on tab close.
5. **One size only** (80×30); `baseSpreads`/`recommendedPhotos`/`maxSpreads` hard-coded per size.
6. **Studio edits the couple's draft through the couple's own route** (preview token cookie) — no audit of who changed what; saves from studio and couple use the same `rev` race rules.
7. **Studio-made portal link breaks the gallery's order button** (409) — the hub warns but allows it.
8. **Hidden photos**: removed from slots at send, but a photo hidden after sending still prints (by design D15) — the studio must reopen to remove it.
9. **Avira target gap**: Avira's portal hard-codes 30 pages and engraving prices and has no `couple_designer` path; porting A requires either porting P53 (`album_pricing_settings`, `submit_album_purchase`) or adapting to Avira's current portal. Decide which.
10. **Avira's photo galleries live in the separate films app** (Cloudflare D1/KV, its own orders). Decide: rebuild A inside Avira's Supabase app (needs galleries there first — covered by the other researchers), or connect Avira's existing films app to Avira's Wedding Albums module (D3(a) equivalent). Also: migrating existing albums/orders from the films app (D5 was deferred).
11. **Two editors for one album**: for `couple_designer` orders C's button is hidden and its export is refused (`export.js:57`); there is no path to "take the couple's gallery album into the studio editor" for touch-ups (the studio can only edit the couple's doc in A).
12. Enlargement prices from C still do not reach the purchase wizard (open point in Studio Plan, 0174).
