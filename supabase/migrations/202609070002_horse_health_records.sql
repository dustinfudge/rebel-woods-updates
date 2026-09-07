begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'horse_health_record_kind' and typnamespace = 'public'::regnamespace) then
    create type public.horse_health_record_kind as enum ('vaccination', 'test', 'document');
  end if;
end
$$;

create table if not exists public.horse_health_records (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete cascade,
  record_kind public.horse_health_record_kind not null,
  item_name text not null check (char_length(item_name) between 1 and 160),
  recorded_on date not null,
  result_notes text not null default '' check (char_length(result_notes) <= 1000),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists horse_health_records_horse_latest_idx
  on public.horse_health_records (horse_id, record_kind, item_name, recorded_on desc, created_at desc);

create index if not exists horse_health_records_recorded_by_idx
  on public.horse_health_records (recorded_by);

alter table public.horse_health_records enable row level security;

drop policy if exists horse_health_records_select_accessible on public.horse_health_records;
create policy horse_health_records_select_accessible
on public.horse_health_records for select
using (public.can_access_horse(horse_id));

drop policy if exists horse_health_records_insert_admin on public.horse_health_records;
create policy horse_health_records_insert_admin
on public.horse_health_records for insert
with check (
  public.is_admin()
  and public.can_access_horse(horse_id)
  and recorded_by = auth.uid()
);

drop policy if exists horse_health_records_update_admin on public.horse_health_records;
create policy horse_health_records_update_admin
on public.horse_health_records for update
using (public.is_admin() and public.can_access_horse(horse_id))
with check (
  public.is_admin()
  and public.can_access_horse(horse_id)
  and recorded_by = auth.uid()
);

grant select, insert, update on public.horse_health_records to authenticated;

alter table public.horse_health_records replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'horse_health_records'
  ) then
    alter publication supabase_realtime add table public.horse_health_records;
  end if;
end
$$;

commit;
