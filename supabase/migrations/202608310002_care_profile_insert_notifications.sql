create or replace function public.audit_care_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  horse_name text;
  organization uuid;
  previous_values jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  special_requirements_changed boolean :=
    case
      when tg_op = 'INSERT' then new.special_requirements <> ''
      else old.special_requirements is distinct from new.special_requirements
    end;
begin
  select name, organization_id into horse_name, organization from public.horses where id = new.horse_id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (new.horse_id, coalesce(auth.uid(), new.updated_by), 'care_profile', previous_values, to_jsonb(new));

  insert into public.notifications (user_id, horse_id, kind, title, body)
  select access.profile_id, new.horse_id, 'care_change', horse_name || '''s care card changed', 'Open the care card to review the latest instructions.'
  from public.horse_access access
  where access.horse_id = new.horse_id;

  if special_requirements_changed then
    insert into public.notifications (user_id, horse_id, kind, title, body)
    select profile.id, new.horse_id, 'care_change', horse_name || '''s special requirements changed', 'Review the updated special requirements before providing care.'
    from public.profiles profile
    where profile.organization_id = organization
      and profile.role in ('admin', 'stable_hand')
      and profile.is_active
      and profile.id <> coalesce(auth.uid(), new.updated_by);
  end if;

  return new;
end;
$$;

drop trigger if exists care_profile_audit_after_update on public.care_profiles;
drop trigger if exists care_profile_audit_after_write on public.care_profiles;

create trigger care_profile_audit_after_write
after insert or update on public.care_profiles
for each row execute function public.audit_care_profile_change();
