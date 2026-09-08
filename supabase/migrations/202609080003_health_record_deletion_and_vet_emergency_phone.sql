begin;

alter table public.horses
  add column if not exists veterinarian_emergency_phone text not null default ''
    check (char_length(veterinarian_emergency_phone) <= 50);

drop policy if exists horse_health_records_delete_admin on public.horse_health_records;
create policy horse_health_records_delete_admin
on public.horse_health_records for delete
using (public.is_admin() and public.can_access_horse(horse_id));

grant delete on public.horse_health_records to authenticated;

commit;
