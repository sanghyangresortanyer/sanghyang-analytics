-- Live Google Sheets sync: Inventory HK snapshot and Daily Market List (DML) per sheet.
-- Rows are written only by the server (service_role) through the two functions
-- below; signed-in users read their own property's rows through RLS.

create table if not exists public.sheet_sync_state (
  property_id uuid not null references public.properties(id) on delete cascade,
  source text not null check (source in ('hk', 'dml')),
  status text not null check (status in ('ok', 'error')),
  content_hash text,
  last_checked_at timestamptz not null default now(),
  last_changed_at timestamptz,
  error text,
  warnings jsonb not null default '[]'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  primary key (property_id, source)
);

create table if not exists public.sheet_hk_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  row_no integer not null,
  item_code text not null,
  item_name text not null,
  unit text,
  content numeric,
  stock_awal numeric,
  total_in numeric,
  total_out numeric,
  stock_akhir numeric,
  average_price numeric,
  last_price numeric,
  stock_value numeric
);
create index if not exists idx_sheet_hk_items_property on public.sheet_hk_items (property_id);

create table if not exists public.sheet_hk_movements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  item_code text not null,
  day smallint not null check (day between 1 and 31),
  qty_in numeric,
  qty_out numeric,
  location text
);
create index if not exists idx_sheet_hk_movements_property on public.sheet_hk_movements (property_id);

create table if not exists public.sheet_dml_sheets (
  property_id uuid not null references public.properties(id) on delete cascade,
  sheet_name text not null,
  list_date date not null,
  content_hash text not null,
  total_request numeric not null,
  sheet_grand_total numeric,
  line_count integer not null,
  outlets jsonb not null,
  warnings jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (property_id, sheet_name)
);
create index if not exists idx_sheet_dml_sheets_date on public.sheet_dml_sheets (property_id, list_date desc);

create table if not exists public.sheet_dml_lines (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  sheet_name text not null,
  list_date date not null,
  row_no integer not null,
  outlet text not null,
  item_code text,
  item_name text not null,
  unit text,
  price numeric,
  soh numeric,
  qty_req numeric,
  total numeric,
  purchase_channel text,
  note text,
  foreign key (property_id, sheet_name) references public.sheet_dml_sheets (property_id, sheet_name) on delete cascade
);
create index if not exists idx_sheet_dml_lines_sheet on public.sheet_dml_lines (property_id, sheet_name);

alter table public.sheet_sync_state enable row level security;
alter table public.sheet_hk_items enable row level security;
alter table public.sheet_hk_movements enable row level security;
alter table public.sheet_dml_sheets enable row level security;
alter table public.sheet_dml_lines enable row level security;

drop policy if exists sheet_sync_state_read on public.sheet_sync_state;
create policy sheet_sync_state_read on public.sheet_sync_state
  for select to authenticated using (property_id = auth_property_id());
drop policy if exists sheet_hk_items_read on public.sheet_hk_items;
create policy sheet_hk_items_read on public.sheet_hk_items
  for select to authenticated using (property_id = auth_property_id());
drop policy if exists sheet_hk_movements_read on public.sheet_hk_movements;
create policy sheet_hk_movements_read on public.sheet_hk_movements
  for select to authenticated using (property_id = auth_property_id());
drop policy if exists sheet_dml_sheets_read on public.sheet_dml_sheets;
create policy sheet_dml_sheets_read on public.sheet_dml_sheets
  for select to authenticated using (property_id = auth_property_id());
drop policy if exists sheet_dml_lines_read on public.sheet_dml_lines;
create policy sheet_dml_lines_read on public.sheet_dml_lines
  for select to authenticated using (property_id = auth_property_id());

grant select on public.sheet_sync_state, public.sheet_hk_items, public.sheet_hk_movements,
  public.sheet_dml_sheets, public.sheet_dml_lines to authenticated;
grant select, insert, update, delete on public.sheet_sync_state, public.sheet_hk_items, public.sheet_hk_movements,
  public.sheet_dml_sheets, public.sheet_dml_lines to service_role;

-- Replace the HK snapshot of one property in one transaction.
create or replace function public.apply_hk_snapshot(p_property_id uuid, p_items jsonb, p_movements jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('sheet_sync:hk:' || p_property_id::text));

  delete from sheet_hk_movements where property_id = p_property_id;
  delete from sheet_hk_items where property_id = p_property_id;

  insert into sheet_hk_items (
    property_id, row_no, item_code, item_name, unit, content, stock_awal, total_in, total_out,
    stock_akhir, average_price, last_price, stock_value
  )
  select p_property_id, r.row_no, r.item_code, r.item_name, r.unit, r.content, r.stock_awal, r.total_in,
    r.total_out, r.stock_akhir, r.average_price, r.last_price, r.stock_value
  from jsonb_to_recordset(p_items) as r(
    row_no integer, item_code text, item_name text, unit text, content numeric, stock_awal numeric,
    total_in numeric, total_out numeric, stock_akhir numeric, average_price numeric, last_price numeric,
    stock_value numeric
  );

  insert into sheet_hk_movements (property_id, item_code, day, qty_in, qty_out, location)
  select p_property_id, r.item_code, r.day, r.qty_in, r.qty_out, r.location
  from jsonb_to_recordset(p_movements) as r(item_code text, day smallint, qty_in numeric, qty_out numeric, location text);
end;
$$;

-- Apply DML changes of one property in one transaction: drop sheets no longer in
-- the workbook, then replace the sheets whose content changed.
create or replace function public.apply_dml_sheets(
  p_property_id uuid,
  p_present text[],
  p_sheets jsonb,
  p_lines jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('sheet_sync:dml:' || p_property_id::text));

  delete from sheet_dml_sheets
  where property_id = p_property_id and not (sheet_name = any (p_present));

  delete from sheet_dml_sheets
  where property_id = p_property_id
    and sheet_name in (select s ->> 'sheet_name' from jsonb_array_elements(p_sheets) as s);

  insert into sheet_dml_sheets (
    property_id, sheet_name, list_date, content_hash, total_request, sheet_grand_total, line_count, outlets, warnings
  )
  select p_property_id, r.sheet_name, r.list_date, r.content_hash, r.total_request, r.sheet_grand_total,
    r.line_count, r.outlets, r.warnings
  from jsonb_to_recordset(p_sheets) as r(
    sheet_name text, list_date date, content_hash text, total_request numeric, sheet_grand_total numeric,
    line_count integer, outlets jsonb, warnings jsonb
  );

  insert into sheet_dml_lines (
    property_id, sheet_name, list_date, row_no, outlet, item_code, item_name, unit, price, soh, qty_req,
    total, purchase_channel, note
  )
  select p_property_id, r.sheet_name, r.list_date, r.row_no, r.outlet, r.item_code, r.item_name, r.unit,
    r.price, r.soh, r.qty_req, r.total, r.purchase_channel, r.note
  from jsonb_to_recordset(p_lines) as r(
    sheet_name text, list_date date, row_no integer, outlet text, item_code text, item_name text, unit text,
    price numeric, soh numeric, qty_req numeric, total numeric, purchase_channel text, note text
  );
end;
$$;

revoke execute on function public.apply_hk_snapshot(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_dml_sheets(uuid, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_hk_snapshot(uuid, jsonb, jsonb) to service_role;
grant execute on function public.apply_dml_sheets(uuid, text[], jsonb, jsonb) to service_role;
