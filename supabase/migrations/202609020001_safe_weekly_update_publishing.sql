alter table public.weekly_updates
alter column published_at drop not null;

alter table public.weekly_updates
alter column published_at drop default;

create or replace function public.can_access_update(target_update_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.weekly_updates weekly_update
    where weekly_update.id = target_update_id
      and public.can_access_horse(weekly_update.horse_id)
      and (public.is_staff() or weekly_update.published_at is not null)
  );
$$;

drop policy if exists weekly_updates_select_accessible on public.weekly_updates;

create policy weekly_updates_select_accessible
on public.weekly_updates
for select
using (
  public.can_access_horse(horse_id)
  and (public.is_staff() or published_at is not null)
);

create or replace function public.notify_weekly_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  horse_name text;
begin
  if new.published_at is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.published_at is not null then
    return new;
  end if;

  select name into horse_name from public.horses where id = new.horse_id;

  insert into public.notifications (user_id, horse_id, update_id, kind, title, body)
  select access.profile_id, new.horse_id, new.id, 'weekly_update', horse_name || '''s weekly update is ready', left(new.body, 180)
  from public.horse_access access
  where access.horse_id = new.horse_id;

  return new;
end;
$$;

drop trigger if exists weekly_update_notification_after_insert on public.weekly_updates;
drop trigger if exists weekly_update_notification_after_publish on public.weekly_updates;

create trigger weekly_update_notification_after_publish
after insert or update of published_at on public.weekly_updates
for each row execute function public.notify_weekly_update();

create or replace function public.renotify_weekly_update(target_update_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_update public.weekly_updates%rowtype;
  horse_name text;
begin
  if not public.is_staff() or not public.can_access_update(target_update_id) then
    raise exception 'Weekly update access denied';
  end if;

  select * into target_update
  from public.weekly_updates
  where id = target_update_id and published_at is not null;

  if not found then
    raise exception 'Published weekly update not found';
  end if;

  select name into horse_name from public.horses where id = target_update.horse_id;

  insert into public.notifications (user_id, horse_id, update_id, kind, title, body)
  select access.profile_id, target_update.horse_id, target_update.id, 'weekly_update', horse_name || '''s weekly update was updated', left(target_update.body, 180)
  from public.horse_access access
  where access.horse_id = target_update.horse_id;
end;
$$;

grant execute on function public.renotify_weekly_update(uuid) to authenticated;
