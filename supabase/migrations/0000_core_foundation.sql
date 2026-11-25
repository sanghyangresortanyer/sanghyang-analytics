-- Sanghyang Analytics — Core Foundation Schema (ADR-014)
-- Menyediakan ekstensi, bucket privat source-files, tabel properties & profiles,
-- fungsi RLS auth_property_id(), serta sinkronisasi profil otomatis saat akun auth dibuat.

create extension if not exists "pgcrypto";

-- Private bucket for original VHP exports (never public).
insert into storage.buckets (id, name, public)
values ('source-files', 'source-files', false)
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------------
-- properties / profiles
-- ---------------------------------------------------------------------------

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  timezone text not null default 'Asia/Jakarta',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  full_name text,
  role text not null default 'staff' check (role in ('admin', 'manager', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_property_id_idx on public.profiles (property_id);

-- ---------------------------------------------------------------------------
-- RLS helper & policies (initplan scalar subquery per Supabase RLS guidance)
-- ---------------------------------------------------------------------------

create or replace function public.auth_property_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select property_id from public.profiles where id = auth.uid();
$$;

alter table public.properties enable row level security;
alter table public.profiles enable row level security;

drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties
  for select using (id = (select public.auth_property_id()));

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and property_id = (select public.auth_property_id()));

grant select on public.properties to authenticated, service_role;
grant select, update on public.profiles to authenticated;
grant select on public.profiles to service_role;

-- ---------------------------------------------------------------------------
-- Owner-managed accounts trigger (attaches new auth.users row to the property)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_property_id uuid;
begin
  select id into v_property_id from public.properties order by created_at limit 1;
  if v_property_id is null then
    return new;
  end if;

  insert into public.profiles (id, property_id, role, active)
  values (new.id, v_property_id, 'staff', true)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Ensure at least one admin exists (idempotent no-op when an admin is already set).
update public.profiles set role = 'admin'
where id = (select id from public.profiles order by created_at limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');
