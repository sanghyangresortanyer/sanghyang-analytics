-- Inventory HK per month: one stock tab per month in the sheet ("Nov 2026").
-- Items carry their month, movements their date, so stock can be rebuilt for
-- any day and the dashboard can follow the selected period.

create table if not exists public.sheet_hk_months (
  property_id uuid not null references public.properties(id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  sheet_name text not null,
  content_hash text not null,
  item_count integer not null,
  total_value numeric not null,
  warnings jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (property_id, period_month)
);

-- Rows pulled before this migration all come from the November 2026 tab ("Sheet1").
-- An empty hash makes the next pull rewrite them under the tab's real name.
insert into public.sheet_hk_months (property_id, period_month, sheet_name, content_hash, item_count, total_value)
select property_id, date '2026-11-01', 'Sheet1', '', count(*), coalesce(sum(stock_value), 0)
from public.sheet_hk_items
group by property_id
on conflict (property_id, period_month) do nothing;

alter table public.sheet_hk_items add column if not exists period_month date;
update public.sheet_hk_items set period_month = date '2026-11-01' where period_month is null;
alter table public.sheet_hk_items alter column period_month set not null;

alter table public.sheet_hk_movements add column if not exists period_month date;
alter table public.sheet_hk_movements add column if not exists movement_date date;
update public.sheet_hk_movements
set period_month = date '2026-11-01', movement_date = make_date(2026, 11, day)
where period_month is null;
alter table public.sheet_hk_movements alter column period_month set not null;
alter table public.sheet_hk_movements alter column movement_date set not null;

alter table public.sheet_hk_items
  drop constraint if exists sheet_hk_items_month_fk,
  add constraint sheet_hk_items_month_fk foreign key (property_id, period_month)
    references public.sheet_hk_months (property_id, period_month) on delete cascade;
alter table public.sheet_hk_movements
  drop constraint if exists sheet_hk_movements_month_fk,
  add constraint sheet_hk_movements_month_fk foreign key (property_id, period_month)
    references public.sheet_hk_months (property_id, period_month) on delete cascade;

create index if not exists idx_sheet_hk_items_month on public.sheet_hk_items (property_id, period_month);
create index if not exists idx_sheet_hk_movements_date on public.sheet_hk_movements (property_id, movement_date);

alter table public.sheet_hk_months enable row level security;
drop policy if exists sheet_hk_months_read on public.sheet_hk_months;
create policy sheet_hk_months_read on public.sheet_hk_months
  for select to authenticated using (property_id = auth_property_id());
grant select on public.sheet_hk_months to authenticated;
grant select, insert, update, delete on public.sheet_hk_months to service_role;

-- Replace the changed months of one property in one transaction and drop months
-- whose tab is gone from the sheet.
create or replace function public.apply_hk_months(
  p_property_id uuid,
  p_present date[],
  p_months jsonb,
  p_items jsonb,
  p_movements jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('sheet_sync:hk:' || p_property_id::text));

  delete from sheet_hk_months
  where property_id = p_property_id and not (period_month = any (p_present));

  delete from sheet_hk_months
  where property_id = p_property_id
    and period_month in (select (m ->> 'period_month')::date from jsonb_array_elements(p_months) as m);

  insert into sheet_hk_months (property_id, period_month, sheet_name, content_hash, item_count, total_value, warnings)
  select p_property_id, r.period_month, r.sheet_name, r.content_hash, r.item_count, r.total_value, r.warnings
  from jsonb_to_recordset(p_months) as r(
    period_month date, sheet_name text, content_hash text, item_count integer, total_value numeric, warnings jsonb
  );

  insert into sheet_hk_items (
    property_id, period_month, row_no, item_code, item_name, unit, content, stock_awal, total_in, total_out,
    stock_akhir, average_price, last_price, stock_value
  )
  select p_property_id, r.period_month, r.row_no, r.item_code, r.item_name, r.unit, r.content, r.stock_awal,
    r.total_in, r.total_out, r.stock_akhir, r.average_price, r.last_price, r.stock_value
  from jsonb_to_recordset(p_items) as r(
    period_month date, row_no integer, item_code text, item_name text, unit text, content numeric,
    stock_awal numeric, total_in numeric, total_out numeric, stock_akhir numeric, average_price numeric,
    last_price numeric, stock_value numeric
  );

  insert into sheet_hk_movements (property_id, period_month, movement_date, item_code, day, qty_in, qty_out, location)
  select p_property_id, r.period_month, r.movement_date, r.item_code, r.day, r.qty_in, r.qty_out, r.location
  from jsonb_to_recordset(p_movements) as r(
    period_month date, movement_date date, item_code text, day smallint, qty_in numeric, qty_out numeric, location text
  );
end;
$$;

revoke execute on function public.apply_hk_months(uuid, date[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_hk_months(uuid, date[], jsonb, jsonb, jsonb) to service_role;

-- The single-snapshot writer is replaced by apply_hk_months.
drop function if exists public.apply_hk_snapshot(uuid, jsonb, jsonb);
