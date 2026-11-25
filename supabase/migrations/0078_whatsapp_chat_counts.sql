-- New WhatsApp chats counted by CS per date range (owner, 2026-11-22), shown next to Google Ads.
-- One row per range; saving the same range again replaces the numbers.
create table if not exists public.whatsapp_chat_counts (
  property_id uuid not null references public.properties(id) on delete cascade,
  date_from date not null,
  date_to date not null check (date_to >= date_from),
  chats_total int not null check (chats_total >= 0),
  chats_from_ads int check (chats_from_ads >= 0 and chats_from_ads <= chats_total),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (property_id, date_from, date_to)
);

alter table public.whatsapp_chat_counts enable row level security;

drop policy if exists whatsapp_chat_counts_read on public.whatsapp_chat_counts;
create policy whatsapp_chat_counts_read on public.whatsapp_chat_counts for select to authenticated using (property_id = public.auth_property_id());
drop policy if exists whatsapp_chat_counts_write on public.whatsapp_chat_counts;
create policy whatsapp_chat_counts_write on public.whatsapp_chat_counts for all to authenticated
  using (property_id = public.auth_property_id())
  with check (property_id = public.auth_property_id());

grant select, insert, update, delete on public.whatsapp_chat_counts to authenticated, service_role;
