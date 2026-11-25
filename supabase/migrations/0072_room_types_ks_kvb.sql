-- Two more room types confirmed by the owner 2026-11-19: KS = Krakatau Suite, KVB = Krakatau Beach View.
alter table public.room_types drop constraint if exists room_types_room_type_check;
alter table public.room_types add constraint room_types_room_type_check check (room_type in ('SRD', 'SS', 'KS', 'KV', 'KVB', 'BC'));
