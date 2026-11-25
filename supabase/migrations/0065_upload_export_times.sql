-- When each VHP file of an upload was printed ("Date : 18/11/26 15:21:01" in the report header).
-- A day is only final once the report was printed after that day (VHP closes a day at night audit),
-- so a report printed on its own last day leaves that day marked "belum tutup".
-- revenue_source may now also be null for a purchase-only upload (no revenue file).
alter table public.weekly_meetings
  add column if not exists revenue_exported_at timestamptz,
  add column if not exists journal_exported_at timestamptz,
  add column if not exists purchase_exported_at timestamptz;
