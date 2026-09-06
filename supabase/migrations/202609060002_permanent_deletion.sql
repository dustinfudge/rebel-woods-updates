begin;

create or replace function public.permanently_delete_horse(target_horse_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_is_active boolean;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can permanently delete a horse.';
  end if;

  select horse.is_active
  into target_is_active
  from public.horses horse
  where horse.id = target_horse_id
    and horse.organization_id = public.current_organization_id()
  for update;

  if not found then
    raise exception 'Horse not found.';
  end if;
  if target_is_active then
    raise exception 'Deactivate this horse before permanently deleting it.';
  end if;

  delete from public.staff_alerts
  where horse_id = target_horse_id;

  delete from public.horses
  where id = target_horse_id;
end;
$$;

create or replace function public.permanently_delete_person(target_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_is_active boolean;
  target_role public.app_role;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can permanently delete a person.';
  end if;
  if target_profile_id = auth.uid() then
    raise exception 'You cannot delete your own administrator account.';
  end if;

  select profile.role, profile.is_active
  into target_role, target_is_active
  from public.profiles profile
  where profile.id = target_profile_id
    and profile.organization_id = public.current_organization_id()
  for update;

  if not found then
    raise exception 'Person not found.';
  end if;
  if target_role = 'admin' then
    raise exception 'Administrator accounts cannot be permanently deleted.';
  end if;
  if target_is_active then
    raise exception 'Deactivate this person before permanently deleting them.';
  end if;

  update public.horse_access
  set granted_by = auth.uid()
  where granted_by = target_profile_id;

  update public.care_profiles
  set updated_by = auth.uid()
  where updated_by = target_profile_id;

  update public.horse_medications
  set created_by = auth.uid()
  where created_by = target_profile_id;

  update public.horse_medications
  set updated_by = auth.uid()
  where updated_by = target_profile_id;

  update public.messages
  set hidden_at = null, hidden_by = null
  where hidden_by = target_profile_id;

  update public.conversation_messages
  set hidden_at = null, hidden_by = null
  where hidden_by = target_profile_id;

  update public.staff_alerts
  set removed_by = auth.uid()
  where removed_by = target_profile_id;

  delete from public.conversation_media
  where uploaded_by = target_profile_id;

  delete from public.conversation_messages
  where sender_id = target_profile_id;

  delete from public.message_media
  where uploaded_by = target_profile_id;

  delete from public.messages
  where sender_id = target_profile_id;

  delete from public.update_media
  where uploaded_by = target_profile_id;

  delete from public.weekly_updates
  where author_id = target_profile_id;

  delete from public.care_change_log
  where changed_by = target_profile_id;

  update public.horse_conversations conversation
  set
    last_message_at = (
      select max(message.created_at)
      from public.conversation_messages message
      where message.conversation_id = conversation.id
    ),
    last_staff_communication_at = (
      select max(message.created_at)
      from public.conversation_messages message
      join public.profiles profile on profile.id = message.sender_id
      where message.conversation_id = conversation.id
        and profile.role in ('admin', 'stable_hand')
    ),
    updated_at = now()
  where conversation.organization_id = public.current_organization_id();

  delete from public.profiles
  where id = target_profile_id;
end;
$$;

revoke all on function public.permanently_delete_horse(uuid) from public;
revoke all on function public.permanently_delete_person(uuid) from public;
grant execute on function public.permanently_delete_horse(uuid) to authenticated;
grant execute on function public.permanently_delete_person(uuid) to authenticated;

commit;
