begin;

create table if not exists public.horse_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  phone text not null default '' check (char_length(phone) <= 50),
  created_at timestamptz not null default now(),
  unique (horse_id, name, phone)
);

create index if not exists horse_emergency_contacts_horse_created_idx
  on public.horse_emergency_contacts (horse_id, created_at, id);

insert into public.horse_emergency_contacts (horse_id, name, phone)
select
  horse.id,
  case when horse.emergency_contact_name = '' then 'Emergency Contact' else horse.emergency_contact_name end,
  horse.emergency_contact_phone
from public.horses horse
where horse.emergency_contact_name <> ''
   or horse.emergency_contact_phone <> ''
on conflict (horse_id, name, phone) do nothing;

alter table public.horse_emergency_contacts enable row level security;

drop policy if exists horse_emergency_contacts_select_accessible on public.horse_emergency_contacts;
create policy horse_emergency_contacts_select_accessible
on public.horse_emergency_contacts for select
using (public.can_access_horse(horse_id));

drop policy if exists horse_emergency_contacts_insert_admin on public.horse_emergency_contacts;
create policy horse_emergency_contacts_insert_admin
on public.horse_emergency_contacts for insert
with check (public.is_admin() and public.can_access_horse(horse_id));

drop policy if exists horse_emergency_contacts_update_admin on public.horse_emergency_contacts;
create policy horse_emergency_contacts_update_admin
on public.horse_emergency_contacts for update
using (public.is_admin() and public.can_access_horse(horse_id))
with check (public.is_admin() and public.can_access_horse(horse_id));

drop policy if exists horse_emergency_contacts_delete_admin on public.horse_emergency_contacts;
create policy horse_emergency_contacts_delete_admin
on public.horse_emergency_contacts for delete
using (public.is_admin() and public.can_access_horse(horse_id));

grant select, insert, update, delete on public.horse_emergency_contacts to authenticated;

commit;
