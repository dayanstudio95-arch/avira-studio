-- Album orders (2026-10-29, the owner's request) — additive only:
--  * portal_last_opened_at: stamped by album-portal on every getOrder (the couple opening
--    their link), shown in the orders list as "הזוג צפה לאחרונה". Nothing before this
--    migration was recorded, so it starts empty.
--  * review_reminder_sent_at: the last "תזכורת" sent from the orders list.
--  * shipping_city / shipping_street: the purchase form asks for them separately from now
--    on (the print shop's form wants them apart). shipping_address keeps the joined text
--    for everything that already reads it; older orders are split for display only
--    (src/lib/albumPrintDetails.js splitAddress) — no existing row is changed here.
alter table album_orders
  add column if not exists portal_last_opened_at timestamptz,
  add column if not exists review_reminder_sent_at timestamptz,
  add column if not exists shipping_city text,
  add column if not exists shipping_street text;
