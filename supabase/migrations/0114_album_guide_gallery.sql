-- The album guide for the two ways couples choose (Avira, 2026-11-06, the owner's request): couples with a Pixieset
-- gallery choose there (Favorites → Share → Send To Photographer); couples with the studio's own gallery press ❤ and
-- "סיימנו לבחור". One page, two versions of only "איך בוחרים" and "סיימתם לבחור" (the owner's choice) — the price
-- list, covers, sketches, cancellation and FAQ stay one. /album-guide/<tenant>?v=gallery shows the gallery version;
-- the galleries' "שלח לזוג" links to it, work status "→ זוג" (Pixieset) keeps the plain link.
-- Only adds; the owner runs it.

alter table public.album_guide_content
  add column if not exists photo_selection_intro_gallery text check (photo_selection_intro_gallery is null or char_length(photo_selection_intro_gallery) <= 10000),
  add column if not exists submission_instructions_gallery text check (submission_instructions_gallery is null or char_length(submission_instructions_gallery) <= 10000),
  -- "מה קורה לאחר ההזמנה?" — the same for both versions (the owner's choice).
  add column if not exists after_order_text text check (after_order_text is null or char_length(after_order_text) <= 10000);

-- It used to be written at the end of "סיימתם לבחור" (the Pixieset steps): from the line that says
-- "מה קורה לאחר ההזמנה" it moves to its own field, word for word, and the steps stay where they were.
update public.album_guide_content g
   set submission_instructions = rtrim(m.parts[1], E' \n\r\t'),
       after_order_text = m.parts[2]
  from (
    select id, regexp_match(submission_instructions, '^(.*?)\n([^\n]*מה קורה לאחר ההזמנה.*)$') as parts
      from public.album_guide_content
     where after_order_text is null
  ) m
 where g.id = m.id and m.parts is not null;

-- The galleries' "שלח לזוג" message for Avira: the owner's Pixieset message, adapted to the studio's own gallery
-- (approved by the owner 2026-11-06). Only when the studio has no message of its own yet — later changes are made in
-- "המלל לזוג" on the galleries page or Settings ← תבניות הודעה.
insert into public.app_settings (tenant_id, key, value)
select '708d9428-f1df-4b8f-86c5-4ef84a161f2b', 'template_gallery_link', $msg$היושש {{names}} 😊
התמונות שלכם מוכנות! 🤩 הנה הלינק לגלריה שלכם, לצפייה, הורדה ובחירת תמונות לאלבום:
{{link}}
⚠️ שימו לב - חשוב מאוד ‼️ הגלריה פתוחה עד {{expires}} בלבד.
בבקשה הורידו את התמונות בהקדם ושמרו אותן במחשב, בדיסק קשיח או בענן שלכם.
הלינק משמש כשירות לאספקת החומרים בלבד (איננו אחראים על אובדן החומרים לאחר שסופקו/פג תוקף הלינק).

איך מורידים למחשב? ⬇️
למעלה לוחצים על "הורדה" 📥
בוחרים "כל הגלריה" (או סט מסוים), בלי מייל ובלי הרשמה.

👥 רוצים לשתף את האורחים? למעלה בגלריה יש כפתור "שתפו עם האורחים", והם יקבלו קישור משלהם לצפייה והורדה.

תהנו מלא! צוות AVIRA צלמים
נשמח ממש שתתייגו אותנו כשאתם מעלים 📸 @Avira_weddings

🔗 {{album_guide_link}}
מדריך הזמנת אלבומים

📚 ניתן להזמין אלבומים מודפסים בתוספת תשלום
אם תרצו להפיק אלבומים מהאירוע שלכם – הכנו עבורכם תהליך פשוט ונוח 👇
✨ איך מזמינים?

1️⃣ היכנסו לגלריה שלכם ובחרו את התמונות שתרצו באלבום באמצעות סימון ❤️ על כל תמונה.

2️⃣ בפעם הראשונה הגלריה תשאל "מי בוחר?" (למשל הכלה, החתן או אמא) 👰🤵
כל הלבבות של כולם נכנסים לאלבום.

3️⃣ יש לבחור עד 150 תמונות 📸 (למעלה בגלריה רואים כמה בחרתם)

4️⃣ לאחר שסיימתם לבחור, לחצו על "סיימנו לבחור" ✅ ואשרו.
הבחירה מגיעה אלינו ישירות, אין צורך לשלוח פרטים או מייל.

5️⃣ אחרי השליחה הבחירה ננעלת 🔒
רוצים לשנות משהו? כתבו לנו בוואטסאפ ונפתח אותה מחדש.

לאחר קבלת הבחירה שלכם נתחיל לעבוד על סקיצת האלבום ונשלח לכם אותה לאישור 🖼️

לאחר אישור הסקיצה תבחרו כריכה סופית ותמלאו פרטי משלוח מלאים 🚚

בסיום התהליך יתבצע התשלום הסופי ישירות לגרפיקאית 💳
(הפרטים יוצגו בקישור שתקבלו)

‼️ הערות חשובות ‼️

📝 הכנת סקיצה:
במידה ונשלחה הזמנה והגרפיקאית כבר התחילה לעבוד על הסקיצה, ולאחר מכן החלטתם שלא להמשיך מכל סיבה שהיא – יחול חיוב של 300₪ עבור עבודת הגרפיקה.

💰 תוקף מחירים:
מחירי האלבומים עשויים להשתנות מעונה לעונה בהתאם למחירי בית הדפוס.

המחיר שנמסר לכם תקף ל-60 יום מקבלת קישור הגלריה ⏳
לאחר מכן ייתכן שינוי מחיר בהתאם למחירון המעודכן.$msg$
 where exists (select 1 from public.tenants where id = '708d9428-f1df-4b8f-86c5-4ef84a161f2b')
   and not exists (select 1 from public.app_settings where tenant_id = '708d9428-f1df-4b8f-86c5-4ef84a161f2b' and key = 'template_gallery_link');
