-- Grant table privileges for VRP weekly comparison tables to authenticated and service_role.
grant select, insert, update, delete on public.weekly_meetings to authenticated, service_role;
grant select, insert, update, delete on public.weekly_outlet_metrics to authenticated, service_role;
grant select, insert, update, delete on public.weekly_purchase_suppliers to authenticated, service_role;
grant select, insert, update, delete on public.weekly_purchase_items to authenticated, service_role;
grant select, insert, update, delete on public.weekly_inventory_items to authenticated, service_role;
