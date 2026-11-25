-- Owner 2026-11-22: a Turnover whose last day still has room revenue (100 Lodging) 0 was pulled
-- before VHP closed that day (night audit), even when pulled the day after. That day stays
-- "belum tutup" and the upload is replaced by the next pull of the same start.
alter table public.weekly_meetings
  add column if not exists revenue_open_day boolean not null default false;
