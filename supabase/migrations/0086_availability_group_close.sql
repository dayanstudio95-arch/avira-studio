-- "סגור" on an event in "תשובות זמינות" gets its own mark (2026-10-09, the owner's request).
--
-- "סגור" and a personal "לא צריך" both wrote decision_dismissed_at, so "פתח מחדש" could not
-- tell them apart: reopening brought back people the owner had already decided against,
-- and the button showed on events that were never closed. group_closed_at is written only
-- by "סגור", and "פתח מחדש" clears only rows that carry it. Rows closed before this column
-- existed keep the old behaviour (the screen falls back to it when no row has the mark).
alter table staff_availability_requests add column if not exists group_closed_at timestamptz;
