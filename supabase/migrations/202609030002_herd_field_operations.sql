begin;

alter table public.herds
add column field_id uuid references public.fields(id) on delete set null;

create index herds_field_active_idx
on public.herds (field_id, is_active)
where field_id is not null;

do $$
declare
  split_herds text;
begin
  select string_agg(herd.name, ', ' order by herd.name)
  into split_herds
  from public.herds herd
  where exists (
    select 1
    from public.horses horse
    where horse.herd_id = herd.id
      and horse.is_active
      and horse.field_id is not null
    group by horse.herd_id
    having count(distinct horse.field_id) > 1
  );

  if split_herds is not null then
    raise exception 'These herds currently contain horses in multiple fields: %. Put each herd in one field before rerunning this migration.', split_herds;
  end if;
end;
$$;

update public.herds herd
set field_id = membership.field_id
from (
  select
    horse.herd_id,
    (array_agg(horse.field_id order by horse.field_id) filter (where horse.field_id is not null))[1] as field_id
  from public.horses horse
  where horse.herd_id is not null
    and horse.is_active
  group by horse.herd_id
) membership
where membership.herd_id = herd.id;

alter table public.horses disable trigger horse_location_audit_after_update;

update public.horses horse
set field_id = herd.field_id
from public.herds herd
where horse.herd_id = herd.id
  and horse.field_id is distinct from herd.field_id;

alter table public.horses enable trigger horse_location_audit_after_update;

create or replace function public.herd_roster_name(target_herd_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    string_agg(horse.name, ', ' order by horse.name),
    'Empty herd'
  )
  from public.horses horse
  where horse.herd_id = target_herd_id
    and horse.is_active;
$$;

create or replace function public.field_display_name(target_field_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select field.name from public.fields field where field.id = target_field_id),
    'No field assigned'
  );
$$;

revoke all on function public.herd_roster_name(uuid) from public;
revoke all on function public.field_display_name(uuid) from public;

create or replace function public.audit_horse_location_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  old_roster text;
  new_roster text;
begin
  if current_setting('app.suppress_staff_location_alerts', true) = 'on' then
    return new;
  end if;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (
    new.id,
    actor,
    'location',
    jsonb_build_object('field_id', old.field_id, 'herd_id', old.herd_id),
    jsonb_build_object('field_id', new.field_id, 'herd_id', new.herd_id)
  );

  if old.herd_id is distinct from new.herd_id then
    old_roster := case when old.herd_id is null then 'Not in a herd' else public.herd_roster_name(old.herd_id) end;
    new_roster := case when new.herd_id is null then 'Not in a herd' else public.herd_roster_name(new.herd_id) end;
    perform public.record_staff_alert(
      new.organization_id,
      new.id,
      new.herd_id,
      'herd_membership',
      'normal',
      'horse:' || new.id::text || ':herd',
      new.name || ' changed herds',
      new.name || ' moved from ' || old_roster || ' to ' || new_roster || '.',
      jsonb_build_object('herd_id', old.herd_id, 'roster', old_roster),
      jsonb_build_object('herd_id', new.herd_id, 'roster', new_roster),
      actor
    );
  end if;

  if old.field_id is distinct from new.field_id then
    perform public.record_staff_alert(
      new.organization_id,
      new.id,
      new.herd_id,
      'herd_field',
      'normal',
      'horse:' || new.id::text || ':field',
      new.name || '''s field changed',
      'Moved from ' || public.field_display_name(old.field_id) || ' to ' || public.field_display_name(new.field_id) || '.',
      jsonb_build_object('field_id', old.field_id, 'field', public.field_display_name(old.field_id)),
      jsonb_build_object('field_id', new.field_id, 'field', public.field_display_name(new.field_id)),
      actor
    );
  end if;

  return new;
end;
$$;

create or replace function public.move_horse_to_herd(target_horse_id uuid, target_herd_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  moving_horse public.horses%rowtype;
  source_roster text;
  destination_roster text;
  destination_field_id uuid;
  destination_field_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can change herd membership.';
  end if;

  select horse.*
  into moving_horse
  from public.horses horse
  where horse.id = target_horse_id
    and horse.organization_id = public.current_organization_id()
    and horse.is_active;

  if not found then
    raise exception 'The horse could not be found.';
  end if;

  if moving_horse.herd_id is not distinct from target_herd_id then
    return;
  end if;

  if target_herd_id is not null then
    select herd.field_id
    into destination_field_id
    from public.herds herd
    where herd.id = target_herd_id
      and herd.organization_id = moving_horse.organization_id
      and herd.is_active;

    if not found then
      raise exception 'The destination herd could not be found.';
    end if;
  else
    destination_field_id := moving_horse.field_id;
  end if;

  source_roster := case
    when moving_horse.herd_id is null then 'Not in a herd'
    else public.herd_roster_name(moving_horse.herd_id)
  end;

  perform set_config('app.suppress_staff_location_alerts', 'on', true);

  update public.horses
  set herd_id = target_herd_id,
      field_id = destination_field_id
  where id = moving_horse.id;

  if moving_horse.herd_id is not null
    and moving_horse.herd_id is distinct from target_herd_id
    and not exists (
      select 1
      from public.horses horse
      where horse.herd_id = moving_horse.herd_id
        and horse.is_active
    )
  then
    update public.herds set is_active = false where id = moving_horse.herd_id;
  end if;

  destination_roster := case
    when target_herd_id is null then 'Not in a herd'
    else public.herd_roster_name(target_herd_id)
  end;
  destination_field_name := public.field_display_name(destination_field_id);

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (
    moving_horse.id,
    auth.uid(),
    'herd_membership',
    jsonb_build_object('herd_id', moving_horse.herd_id, 'roster', source_roster, 'field_id', moving_horse.field_id, 'field', public.field_display_name(moving_horse.field_id)),
    jsonb_build_object('herd_id', target_herd_id, 'roster', destination_roster, 'field_id', destination_field_id, 'field', destination_field_name)
  );

  perform public.record_staff_alert(
    moving_horse.organization_id,
    moving_horse.id,
    target_herd_id,
    'herd_membership',
    'normal',
    'horse:' || moving_horse.id::text || ':herd',
    moving_horse.name || ' changed herds',
    moving_horse.name || ' moved from ' || source_roster || ' to ' || destination_roster || '. The current field is ' || destination_field_name || '.',
    jsonb_build_object('herd_id', moving_horse.herd_id, 'roster', source_roster, 'field_id', moving_horse.field_id, 'field', public.field_display_name(moving_horse.field_id)),
    jsonb_build_object('herd_id', target_herd_id, 'roster', destination_roster, 'field_id', destination_field_id, 'field', destination_field_name),
    auth.uid()
  );
end;
$$;

create or replace function public.move_herd_to_field(target_herd_id uuid, target_field_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_herd public.herds%rowtype;
  roster_name text;
  previous_field_name text;
  next_field_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can move a herd.';
  end if;

  select herd.*
  into target_herd
  from public.herds herd
  where herd.id = target_herd_id
    and herd.organization_id = public.current_organization_id()
    and herd.is_active;

  if not found then
    raise exception 'The herd could not be found.';
  end if;

  if target_field_id is not null and not exists (
    select 1
    from public.fields field
    where field.id = target_field_id
      and field.organization_id = target_herd.organization_id
      and field.is_active
  ) then
    raise exception 'The destination field could not be found.';
  end if;

  if target_herd.field_id is not distinct from target_field_id then
    return;
  end if;

  roster_name := public.herd_roster_name(target_herd.id);
  previous_field_name := public.field_display_name(target_herd.field_id);
  next_field_name := public.field_display_name(target_field_id);

  perform set_config('app.suppress_staff_location_alerts', 'on', true);

  update public.herds set field_id = target_field_id where id = target_herd.id;
  update public.horses set field_id = target_field_id where herd_id = target_herd.id and is_active;

  perform public.record_staff_alert(
    target_herd.organization_id,
    null,
    target_herd.id,
    'herd_field',
    'normal',
    'herd:' || target_herd.id::text || ':field',
    roster_name || ' changed fields',
    'The entire herd moved from ' || previous_field_name || ' to ' || next_field_name || '.',
    jsonb_build_object('herd_id', target_herd.id, 'roster', roster_name, 'field_id', target_herd.field_id, 'field', previous_field_name),
    jsonb_build_object('herd_id', target_herd.id, 'roster', roster_name, 'field_id', target_field_id, 'field', next_field_name),
    auth.uid()
  );
end;
$$;

create or replace function public.move_horse_to_field(target_horse_id uuid, target_field_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  moving_horse public.horses%rowtype;
  source_roster text;
  source_member_count integer;
  new_herd_id uuid := gen_random_uuid();
  next_field_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can change a horse''s field.';
  end if;

  select horse.*
  into moving_horse
  from public.horses horse
  where horse.id = target_horse_id
    and horse.organization_id = public.current_organization_id()
    and horse.is_active;

  if not found then
    raise exception 'The horse could not be found.';
  end if;

  if target_field_id is not null and not exists (
    select 1
    from public.fields field
    where field.id = target_field_id
      and field.organization_id = moving_horse.organization_id
      and field.is_active
  ) then
    raise exception 'The destination field could not be found.';
  end if;

  if moving_horse.field_id is not distinct from target_field_id then
    return;
  end if;

  select count(*)::integer
  into source_member_count
  from public.horses horse
  where horse.herd_id = moving_horse.herd_id
    and horse.is_active;

  if moving_horse.herd_id is not null and source_member_count = 1 then
    perform public.move_herd_to_field(moving_horse.herd_id, target_field_id);
    return;
  end if;

  source_roster := case
    when moving_horse.herd_id is null then 'Not in a herd'
    else public.herd_roster_name(moving_horse.herd_id)
  end;
  next_field_name := public.field_display_name(target_field_id);

  insert into public.herds (id, organization_id, name, field_id)
  values (new_herd_id, moving_horse.organization_id, 'group-' || new_herd_id::text, target_field_id);

  perform set_config('app.suppress_staff_location_alerts', 'on', true);

  update public.horses
  set herd_id = new_herd_id,
      field_id = target_field_id
  where id = moving_horse.id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (
    moving_horse.id,
    auth.uid(),
    'individual_field_move',
    jsonb_build_object('herd_id', moving_horse.herd_id, 'roster', source_roster, 'field_id', moving_horse.field_id, 'field', public.field_display_name(moving_horse.field_id)),
    jsonb_build_object('herd_id', new_herd_id, 'roster', moving_horse.name, 'field_id', target_field_id, 'field', next_field_name)
  );

  perform public.record_staff_alert(
    moving_horse.organization_id,
    moving_horse.id,
    new_herd_id,
    'herd_field',
    'normal',
    'horse:' || moving_horse.id::text || ':field',
    moving_horse.name || ' moved into a one-horse herd',
    moving_horse.name || ' left ' || source_roster || ' and formed a one-horse herd in ' || next_field_name || '.',
    jsonb_build_object('herd_id', moving_horse.herd_id, 'roster', source_roster, 'field_id', moving_horse.field_id, 'field', public.field_display_name(moving_horse.field_id)),
    jsonb_build_object('herd_id', new_herd_id, 'roster', moving_horse.name, 'field_id', target_field_id, 'field', next_field_name),
    auth.uid()
  );
end;
$$;

grant execute on function public.move_horse_to_herd(uuid, uuid) to authenticated;
grant execute on function public.move_herd_to_field(uuid, uuid) to authenticated;
grant execute on function public.move_horse_to_field(uuid, uuid) to authenticated;

commit;
