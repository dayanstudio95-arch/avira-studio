-- Wedding Albums module — richer engraving selection, matching the real fields
-- the studio's old system exposes to couples (confirmed via reference screenshots
-- of the old portal, reconciled with the user): engraving *type* (colored vs.
-- blind/colorless embossing), engraving *scope* (main album only vs. the full
-- album set), and a second, independent text line (couples can engrave one or
-- two lines, e.g. "Dana & Mickey" on line 1 and a date on line 2).
--
-- `album_order_selections` is currently zero rows in production (verified live
-- before writing this migration), so plain `check` constraints are safe to add
-- with no backfill/validation risk.
--
-- Per CLAUDE.md's "snapshot every commercial selection" rule, these are plain
-- selection columns (not catalog rows), so no separate snapshot machinery is
-- needed here — same treatment as the existing `engraving_text` column.

alter table album_order_selections
  add column if not exists engraving_type text
    check (engraving_type is null or engraving_type in ('colored', 'blind')),
  add column if not exists engraving_scope text
    check (engraving_scope is null or engraving_scope in ('main_only', 'full_set')),
  add column if not exists engraving_text_line2 text
    check (engraving_text_line2 is null or char_length(engraving_text_line2) <= 30);

-- The existing `engraving_text` column (line 1) never had a length constraint;
-- add the same 30-char cap now for consistency with line 2 (matches the old
-- system's "עד 30 תווים לשורה" copy) — safe, table is empty.
alter table album_order_selections
  add constraint album_order_selections_engraving_text_check
    check (engraving_text is null or char_length(engraving_text) <= 30);
