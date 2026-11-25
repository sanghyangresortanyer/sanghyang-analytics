-- Social media promo tracking & lift audit against VHP daily sales (owner, 2026-11-23).
-- Tracks marketing posts per outlet and item keyword to measure sales lift 7 days before vs 7 days after.
create table if not exists public.social_promo_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  post_date date not null,
  platform text not null check (platform in ('instagram', 'tiktok', 'facebook', 'other')),
  outlet_name text not null,
  promo_title text not null,
  menu_keyword text not null,
  post_url text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_social_promo_events_property_date on public.social_promo_events (property_id, post_date desc);

alter table public.social_promo_events enable row level security;

drop policy if exists social_promo_events_read on public.social_promo_events;
create policy social_promo_events_read on public.social_promo_events for select to authenticated using (property_id = public.auth_property_id());

drop policy if exists social_promo_events_write on public.social_promo_events;
create policy social_promo_events_write on public.social_promo_events for all to authenticated
  using (property_id = public.auth_property_id())
  with check (property_id = public.auth_property_id());

grant select, insert, update, delete on public.social_promo_events to authenticated, service_role;
