begin;

alter table public.herds
drop constraint if exists herds_name_check;

alter table public.herds
add constraint herds_name_check check (char_length(name) between 1 and 2000);

create or replace function public.sync_herd_roster_name(target_herd_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  roster_name text;
begin
  if target_herd_id is null then
    return;
  end if;

  select string_agg(horse.name, ', ' order by horse.name)
  into roster_name
  from public.horses horse
  where horse.herd_id = target_herd_id
    and horse.is_active;

  update public.herds
  set name = coalesce(roster_name, name),
      is_active = roster_name is not null
  where id = target_herd_id;
end;
$$;

create or replace function public.sync_changed_horse_herds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_herd_roster_name(old.herd_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.sync_herd_roster_name(new.herd_id);
    return new;
  end if;

  if old.herd_id is distinct from new.herd_id then
    perform public.sync_herd_roster_name(old.herd_id);
  end if;

  perform public.sync_herd_roster_name(new.herd_id);
  return new;
end;
$$;

drop trigger if exists horse_herd_roster_after_write on public.horses;

create trigger horse_herd_roster_after_write
after insert or delete or update of herd_id, is_active, name on public.horses
for each row execute function public.sync_changed_horse_herds();

do $$
declare
  existing_herd record;
begin
  for existing_herd in select id from public.herds loop
    perform public.sync_herd_roster_name(existing_herd.id);
  end loop;
end;
$$;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array['horses', 'herds', 'fields', 'care_profiles', 'horse_medications'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = realtime_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    end if;
  end loop;
end;
$$;

commit;
