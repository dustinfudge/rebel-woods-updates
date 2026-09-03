begin;

create type public.staff_alert_kind as enum (
  'horse_added',
  'horse_removed',
  'herd_membership',
  'herd_field',
  'care',
  'medication',
  'custom'
);

create type public.staff_alert_priority as enum ('normal', 'urgent');

create table public.staff_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  horse_id uuid references public.horses(id) on delete set null,
  herd_id uuid references public.herds(id) on delete set null,
  kind public.staff_alert_kind not null,
  priority public.staff_alert_priority not null default 'normal',
  category_key text not null check (char_length(category_key) between 1 and 240),
  title text not null check (char_length(title) between 1 and 240),
  body text not null check (char_length(body) between 1 and 8000),
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  superseded_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((removed_at is null and removed_by is null) or (removed_at is not null and removed_by is not null))
);

create table public.staff_alert_acknowledgements (
  alert_id uuid not null references public.staff_alerts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (alert_id, profile_id)
);

create index staff_alerts_organization_overview_idx
on public.staff_alerts (organization_id, priority desc, created_at desc)
where superseded_at is null and removed_at is null;

create index staff_alerts_organization_history_idx
on public.staff_alerts (organization_id, created_at desc);

create index staff_alerts_category_latest_idx
on public.staff_alerts (organization_id, category_key, created_at desc);

create index staff_alerts_horse_created_idx
on public.staff_alerts (horse_id, created_at desc)
where horse_id is not null;

create index staff_alerts_herd_created_idx
on public.staff_alerts (herd_id, created_at desc)
where herd_id is not null;

create index staff_alerts_changed_by_created_idx
on public.staff_alerts (changed_by, created_at desc)
where changed_by is not null;

create index staff_alert_acknowledgements_profile_created_idx
on public.staff_alert_acknowledgements (profile_id, acknowledged_at desc);

create index staff_alert_acknowledgements_organization_created_idx
on public.staff_alert_acknowledgements (organization_id, acknowledged_at desc);

alter table public.staff_alerts enable row level security;
alter table public.staff_alert_acknowledgements enable row level security;

create policy staff_alerts_select_staff
on public.staff_alerts for select
using (public.is_staff() and organization_id = public.current_organization_id());

create policy staff_alert_acknowledgements_select_staff
on public.staff_alert_acknowledgements for select
using (public.is_staff() and organization_id = public.current_organization_id());

create policy staff_alert_acknowledgements_insert_self
on public.staff_alert_acknowledgements for insert
with check (
  public.is_staff()
  and profile_id = auth.uid()
  and organization_id = public.current_organization_id()
  and exists (
    select 1
    from public.staff_alerts alert
    where alert.id = alert_id
      and alert.organization_id = staff_alert_acknowledgements.organization_id
  )
);

grant select on public.staff_alerts to authenticated;
grant select, insert on public.staff_alert_acknowledgements to authenticated;

create or replace function public.staff_alert_value(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(btrim(value), ''), 'Not entered');
$$;

create or replace function public.record_staff_alert(
  target_organization_id uuid,
  target_horse_id uuid,
  target_herd_id uuid,
  target_kind public.staff_alert_kind,
  target_priority public.staff_alert_priority,
  target_category_key text,
  target_title text,
  target_body text,
  target_previous_values jsonb,
  target_new_values jsonb,
  target_changed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  created_alert_id uuid;
begin
  update public.staff_alerts
  set superseded_at = now()
  where organization_id = target_organization_id
    and category_key = target_category_key
    and kind <> 'custom'
    and superseded_at is null
    and removed_at is null;

  insert into public.staff_alerts (
    organization_id,
    horse_id,
    herd_id,
    kind,
    priority,
    category_key,
    title,
    body,
    previous_values,
    new_values,
    changed_by
  )
  values (
    target_organization_id,
    target_horse_id,
    target_herd_id,
    target_kind,
    target_priority,
    left(target_category_key, 240),
    left(target_title, 240),
    left(target_body, 8000),
    coalesce(target_previous_values, '{}'::jsonb),
    coalesce(target_new_values, '{}'::jsonb),
    target_changed_by
  )
  returning id into created_alert_id;

  return created_alert_id;
end;
$$;

revoke all on function public.record_staff_alert(uuid, uuid, uuid, public.staff_alert_kind, public.staff_alert_priority, text, text, text, jsonb, jsonb, uuid) from public;

create or replace function public.create_custom_staff_alert(alert_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_organization uuid := public.current_organization_id();
  created_alert_id uuid := gen_random_uuid();
  normalized_message text := btrim(alert_message);
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can add staff alerts.';
  end if;

  if char_length(normalized_message) not between 1 and 8000 then
    raise exception 'A staff alert must contain between 1 and 8000 characters.';
  end if;

  insert into public.staff_alerts (
    id,
    organization_id,
    kind,
    priority,
    category_key,
    title,
    body,
    changed_by
  )
  values (
    created_alert_id,
    current_organization,
    'custom',
    'normal',
    'custom:' || created_alert_id::text,
    'Staff notice',
    normalized_message,
    auth.uid()
  );

  return created_alert_id;
end;
$$;

create or replace function public.remove_custom_staff_alert(target_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can remove staff alerts.';
  end if;

  update public.staff_alerts
  set removed_at = now(), removed_by = auth.uid()
  where id = target_alert_id
    and organization_id = public.current_organization_id()
    and kind = 'custom'
    and removed_at is null;

  if not found then
    raise exception 'The staff alert could not be removed.';
  end if;
end;
$$;

create or replace function public.acknowledge_staff_alert(target_alert_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  acknowledged_time timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Only active staff can acknowledge staff alerts.';
  end if;

  insert into public.staff_alert_acknowledgements (
    alert_id,
    profile_id,
    organization_id,
    acknowledged_at
  )
  select
    alert.id,
    auth.uid(),
    alert.organization_id,
    acknowledged_time
  from public.staff_alerts alert
  where alert.id = target_alert_id
    and alert.organization_id = public.current_organization_id()
  on conflict (alert_id, profile_id) do update
  set acknowledged_at = excluded.acknowledged_at
  returning acknowledged_at into acknowledged_time;

  if not found then
    raise exception 'The staff alert could not be acknowledged.';
  end if;

  return acknowledged_time;
end;
$$;

grant execute on function public.create_custom_staff_alert(text) to authenticated;
grant execute on function public.remove_custom_staff_alert(uuid) to authenticated;
grant execute on function public.acknowledge_staff_alert(uuid) to authenticated;

create or replace function public.audit_care_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  horse_name text;
  organization uuid;
  actor uuid := coalesce(auth.uid(), new.updated_by);
  previous_values jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
begin
  select horse.name, horse.organization_id
  into horse_name, organization
  from public.horses horse
  where horse.id = new.horse_id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (new.horse_id, actor, 'care_profile', previous_values, to_jsonb(new));

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.am_feed is distinct from new.am_feed then
    perform public.record_staff_alert(
      organization, new.horse_id, null, 'care', 'normal',
      'horse:' || new.horse_id::text || ':care:am_feed',
      horse_name || '''s AM feed changed',
      'Changed from "' || public.staff_alert_value(old.am_feed) || '" to "' || public.staff_alert_value(new.am_feed) || '".',
      jsonb_build_object('label', 'AM feed', 'value', old.am_feed),
      jsonb_build_object('label', 'AM feed', 'value', new.am_feed),
      actor
    );
  end if;

  if old.pm_feed is distinct from new.pm_feed then
    perform public.record_staff_alert(
      organization, new.horse_id, null, 'care', 'normal',
      'horse:' || new.horse_id::text || ':care:pm_feed',
      horse_name || '''s PM feed changed',
      'Changed from "' || public.staff_alert_value(old.pm_feed) || '" to "' || public.staff_alert_value(new.pm_feed) || '".',
      jsonb_build_object('label', 'PM feed', 'value', old.pm_feed),
      jsonb_build_object('label', 'PM feed', 'value', new.pm_feed),
      actor
    );
  end if;

  if old.supplements_am is distinct from new.supplements_am then
    perform public.record_staff_alert(
      organization, new.horse_id, null, 'care', 'normal',
      'horse:' || new.horse_id::text || ':care:supplements_am',
      horse_name || '''s AM supplements changed',
      'Changed from "' || public.staff_alert_value(old.supplements_am) || '" to "' || public.staff_alert_value(new.supplements_am) || '".',
      jsonb_build_object('label', 'AM supplements', 'value', old.supplements_am),
      jsonb_build_object('label', 'AM supplements', 'value', new.supplements_am),
      actor
    );
  end if;

  if old.supplements_pm is distinct from new.supplements_pm then
    perform public.record_staff_alert(
      organization, new.horse_id, null, 'care', 'normal',
      'horse:' || new.horse_id::text || ':care:supplements_pm',
      horse_name || '''s PM supplements changed',
      'Changed from "' || public.staff_alert_value(old.supplements_pm) || '" to "' || public.staff_alert_value(new.supplements_pm) || '".',
      jsonb_build_object('label', 'PM supplements', 'value', old.supplements_pm),
      jsonb_build_object('label', 'PM supplements', 'value', new.supplements_pm),
      actor
    );
  end if;

  if old.special_requirements is distinct from new.special_requirements then
    perform public.record_staff_alert(
      organization, new.horse_id, null, 'care', 'urgent',
      'horse:' || new.horse_id::text || ':care:special_requirements',
      horse_name || '''s special requirements changed',
      'Changed from "' || public.staff_alert_value(old.special_requirements) || '" to "' || public.staff_alert_value(new.special_requirements) || '".',
      jsonb_build_object('label', 'Special requirements', 'value', old.special_requirements),
      jsonb_build_object('label', 'Special requirements', 'value', new.special_requirements),
      actor
    );
  end if;

  return new;
end;
$$;

create or replace function public.audit_medication_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_horse_id uuid := coalesce(new.horse_id, old.horse_id);
  target_medication_id uuid := coalesce(new.id, old.id);
  horse_name text;
  medication_name text := coalesce(new.name, old.name);
  organization uuid;
  actor uuid := coalesce(auth.uid(), new.updated_by, old.updated_by);
  action_label text;
  change_description text;
  previous_values jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  next_values jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
begin
  select horse.name, horse.organization_id
  into horse_name, organization
  from public.horses horse
  where horse.id = target_horse_id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (target_horse_id, actor, 'medication', previous_values, next_values);

  action_label := case
    when tg_op = 'INSERT' then 'was added'
    when tg_op = 'DELETE' then 'was removed'
    when old.status is distinct from new.status then 'status changed to ' || new.status::text
    else 'was updated'
  end;

  change_description := case
    when tg_op = 'INSERT' then
      medication_name || ' ' || action_label || '. Dosage: "' || new.dosage || '". Instructions: "' || new.instructions || '". Schedule: ' || new.starts_on::text || ' through ' || coalesce(new.ends_on::text, 'ongoing') || '. Status: ' || new.status::text || '.'
    when tg_op = 'DELETE' then
      medication_name || ' ' || action_label || '. Previous dosage: "' || old.dosage || '". Previous instructions: "' || old.instructions || '". Previous schedule: ' || old.starts_on::text || ' through ' || coalesce(old.ends_on::text, 'ongoing') || '.'
    else
      medication_name || ' ' || action_label || '. Changed from dosage "' || old.dosage || '", instructions "' || old.instructions || '", schedule ' || old.starts_on::text || ' through ' || coalesce(old.ends_on::text, 'ongoing') || ', status ' || old.status::text || ' to dosage "' || new.dosage || '", instructions "' || new.instructions || '", schedule ' || new.starts_on::text || ' through ' || coalesce(new.ends_on::text, 'ongoing') || ', status ' || new.status::text || '.'
  end;

  perform public.record_staff_alert(
    organization,
    target_horse_id,
    null,
    'medication',
    'urgent',
    'horse:' || target_horse_id::text || ':medication:' || target_medication_id::text,
    horse_name || '''s medication changed',
    change_description,
    previous_values,
    next_values,
    actor
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.audit_horse_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    perform public.record_staff_alert(
      new.organization_id, new.id, new.herd_id, 'horse_added', 'normal',
      'horse:' || new.id::text || ':lifecycle',
      new.name || ' was added',
      'Review the new horse''s information and care card before providing care.',
      '{}'::jsonb,
      to_jsonb(new),
      actor
    );
  elsif old.is_active and not new.is_active then
    perform public.record_staff_alert(
      new.organization_id, new.id, new.herd_id, 'horse_removed', 'normal',
      'horse:' || new.id::text || ':lifecycle',
      new.name || ' was removed',
      'This horse is no longer active in the stable.',
      to_jsonb(old),
      to_jsonb(new),
      actor
    );
  end if;

  return new;
end;
$$;

drop trigger if exists staff_alert_horse_lifecycle_after_write on public.horses;
create trigger staff_alert_horse_lifecycle_after_write
after insert or update of is_active on public.horses
for each row execute function public.audit_horse_lifecycle();

alter table public.staff_alerts replica identity full;
alter table public.staff_alert_acknowledgements replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_alerts'
  ) then
    alter publication supabase_realtime add table public.staff_alerts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staff_alert_acknowledgements'
  ) then
    alter publication supabase_realtime add table public.staff_alert_acknowledgements;
  end if;
end;
$$;

commit;
