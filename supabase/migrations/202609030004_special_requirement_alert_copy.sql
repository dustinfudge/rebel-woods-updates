begin;

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
      case
        when nullif(btrim(new.special_requirements), '') is null then 'Special requirements were cleared.'
        else 'Current requirement: "' || public.staff_alert_value(new.special_requirements) || '".'
      end,
      jsonb_build_object('label', 'Special requirements', 'value', old.special_requirements),
      jsonb_build_object('label', 'Special requirements', 'value', new.special_requirements),
      actor
    );
  end if;

  return new;
end;
$$;

update public.staff_alerts
set body = case
  when nullif(btrim(coalesce(new_values ->> 'value', '')), '') is null then 'Special requirements were cleared.'
  else 'Current requirement: "' || public.staff_alert_value(new_values ->> 'value') || '".'
end
where category_key like 'horse:%:care:special_requirements';

commit;
