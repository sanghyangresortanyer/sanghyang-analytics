-- CS fills chats that became a booking (closing) for any date range they choose; all new chats is
-- optional (owner, 24 Nov 2026). The table had no rows when this ran.
alter table public.whatsapp_chat_counts add column if not exists chats_closing int check (chats_closing >= 0);
alter table public.whatsapp_chat_counts alter column chats_total drop not null;
alter table public.whatsapp_chat_counts drop constraint if exists whatsapp_chat_counts_one_number;
alter table public.whatsapp_chat_counts add constraint whatsapp_chat_counts_one_number check (chats_closing is not null or chats_total is not null);
alter table public.whatsapp_chat_counts drop constraint if exists whatsapp_chat_counts_closing_le_total;
alter table public.whatsapp_chat_counts add constraint whatsapp_chat_counts_closing_le_total check (chats_closing is null or chats_total is null or chats_closing <= chats_total);
