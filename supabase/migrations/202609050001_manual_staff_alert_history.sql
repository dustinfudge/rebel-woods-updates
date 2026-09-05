begin;

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

update public.staff_alerts
set superseded_at = null
where superseded_at is not null
  and removed_at is null;

create or replace function public.archive_staff_alert(target_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can move staff alerts to history.';
  end if;

  update public.staff_alerts
  set removed_at = now(), removed_by = auth.uid()
  where id = target_alert_id
    and organization_id = public.current_organization_id()
    and removed_at is null;

  if not found then
    raise exception 'The staff alert could not be moved to history.';
  end if;
end;
$$;

create or replace function public.delete_archived_staff_alert(target_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can permanently delete staff alerts.';
  end if;

  delete from public.staff_alerts
  where id = target_alert_id
    and organization_id = public.current_organization_id()
    and (removed_at is not null or superseded_at is not null);

  if not found then
    raise exception 'Only an alert in history can be permanently deleted.';
  end if;
end;
$$;

revoke all on function public.archive_staff_alert(uuid) from public;
revoke all on function public.delete_archived_staff_alert(uuid) from public;
grant execute on function public.archive_staff_alert(uuid) to authenticated;
grant execute on function public.delete_archived_staff_alert(uuid) to authenticated;

revoke execute on function public.remove_custom_staff_alert(uuid) from authenticated;

commit;
