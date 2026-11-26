-- More stock sheets besides HK (owner, 26 Nov 2026): Main Store, Engineering and the beverage
-- store ("LH" tab of the Beverages sheet). They share the HK layout, so the HK tables gain a
-- `store` column instead of three new sets of tables. Existing rows are HK.
-- Every statement converges when the file is run again after a failure (if exists / if not exists / or replace).

-- A sheet sync holding these tables would make the ALTERs wait while every later query queues behind them; give up instead.
set local lock_timeout = '5s';

alter table public.sheet_sync_state drop constraint if exists sheet_sync_state_source_check;
alter table public.sheet_sync_state
  add constraint sheet_sync_state_source_check check (source in ('hk', 'dml', 'main', 'eng', 'bev'));

alter table public.sheet_hk_months add column if not exists store text not null default 'hk';
alter table public.sheet_hk_items add column if not exists store text not null default 'hk';
alter table public.sheet_hk_movements add column if not exists store text not null default 'hk';

alter table public.sheet_hk_months drop constraint if exists sheet_hk_months_store_check;
alter table public.sheet_hk_months add constraint sheet_hk_months_store_check check (store in ('hk', 'main', 'eng', 'bev'));

-- A month is now one month of one store.
alter table public.sheet_hk_items drop constraint if exists sheet_hk_items_month_fk;
alter table public.sheet_hk_movements drop constraint if exists sheet_hk_movements_month_fk;
alter table public.sheet_hk_months drop constraint if exists sheet_hk_months_pkey;
alter table public.sheet_hk_months add constraint sheet_hk_months_pkey primary key (property_id, store, period_month);
alter table public.sheet_hk_items
  add constraint sheet_hk_items_month_fk foreign key (property_id, store, period_month)
    references public.sheet_hk_months (property_id, store, period_month) on delete cascade;
alter table public.sheet_hk_movements
  add constraint sheet_hk_movements_month_fk foreign key (property_id, store, period_month)
    references public.sheet_hk_months (property_id, store, period_month) on delete cascade;

drop index if exists public.idx_sheet_hk_items_month;
drop index if exists public.idx_sheet_hk_movements_date;
create index if not exists idx_sheet_hk_items_store_month on public.sheet_hk_items (property_id, store, period_month);
create index if not exists idx_sheet_hk_movements_store_date on public.sheet_hk_movements (property_id, store, movement_date);

-- Replace the changed months of one store and drop that store's months whose tab is gone.
create or replace function public.apply_store_months(
  p_property_id uuid,
  p_store text,
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
  perform pg_advisory_xact_lock(hashtext('sheet_sync:' || p_store || ':' || p_property_id::text));

  delete from sheet_hk_months
  where property_id = p_property_id and store = p_store and not (period_month = any (p_present));

  delete from sheet_hk_months
  where property_id = p_property_id and store = p_store
    and period_month in (select (m ->> 'period_month')::date from jsonb_array_elements(p_months) as m);

  insert into sheet_hk_months (property_id, store, period_month, sheet_name, content_hash, item_count, total_value, warnings)
  select p_property_id, p_store, r.period_month, r.sheet_name, r.content_hash, r.item_count, r.total_value, r.warnings
  from jsonb_to_recordset(p_months) as r(
    period_month date, sheet_name text, content_hash text, item_count integer, total_value numeric, warnings jsonb
  );

  insert into sheet_hk_items (
    property_id, store, period_month, row_no, item_code, item_name, unit, content, stock_awal, total_in, total_out,
    stock_akhir, average_price, last_price, stock_value
  )
  select p_property_id, p_store, r.period_month, r.row_no, r.item_code, r.item_name, r.unit, r.content, r.stock_awal,
    r.total_in, r.total_out, r.stock_akhir, r.average_price, r.last_price, r.stock_value
  from jsonb_to_recordset(p_items) as r(
    period_month date, row_no integer, item_code text, item_name text, unit text, content numeric,
    stock_awal numeric, total_in numeric, total_out numeric, stock_akhir numeric, average_price numeric,
    last_price numeric, stock_value numeric
  );

  insert into sheet_hk_movements (property_id, store, period_month, movement_date, item_code, day, qty_in, qty_out, location)
  select p_property_id, p_store, r.period_month, r.movement_date, r.item_code, r.day, r.qty_in, r.qty_out, r.location
  from jsonb_to_recordset(p_movements) as r(
    period_month date, movement_date date, item_code text, day smallint, qty_in numeric, qty_out numeric, location text
  );
end;
$$;

revoke execute on function public.apply_store_months(uuid, text, date[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_store_months(uuid, text, date[], jsonb, jsonb, jsonb) to service_role;

-- The code running before this release still calls apply_hk_months: keep it, limited to HK.
create or replace function public.apply_hk_months(
  p_property_id uuid,
  p_present date[],
  p_months jsonb,
  p_items jsonb,
  p_movements jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  select public.apply_store_months(p_property_id, 'hk', p_present, p_months, p_items, p_movements);
$$;

revoke execute on function public.apply_hk_months(uuid, date[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_hk_months(uuid, date[], jsonb, jsonb, jsonb) to service_role;
