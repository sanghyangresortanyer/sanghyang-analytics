-- F/O Journal Transaction (VHP Accounting -> F/O Journal Lists -> Booking Journal by Article):
-- dated Front Office revenue (lodging, extra bed, fees) and the room-package shares Front Office
-- books to outlets (breakfast to d'Bistro, welcome drink to Sunset Grill). Penjualan per Artikel
-- plus these lines equal F/O Turnover per day (checked 1-17 Nov 2026, difference 0).
-- Both go into weekly_sales_lines, told apart by source, so uploading one never replaces the other.
alter table public.weekly_sales_lines
  add column if not exists source text not null default 'pos';

alter table public.weekly_sales_lines
  drop constraint if exists weekly_sales_lines_source_check;
alter table public.weekly_sales_lines
  add constraint weekly_sales_lines_source_check check (source in ('pos', 'fo'));

alter table public.weekly_meetings
  add column if not exists fo_journal_filename text,
  add column if not exists fo_journal_exported_at timestamptz;
