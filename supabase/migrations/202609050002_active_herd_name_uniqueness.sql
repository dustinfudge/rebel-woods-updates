begin;

alter table public.herds
drop constraint if exists herds_organization_id_name_key;

create unique index if not exists herds_organization_active_name_key
on public.herds (organization_id, name)
where is_active;

commit;
