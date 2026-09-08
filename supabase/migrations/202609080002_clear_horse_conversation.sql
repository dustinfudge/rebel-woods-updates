begin;

create or replace function public.permanently_clear_horse_conversation(target_horse_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_conversation_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can permanently clear a conversation.';
  end if;

  select conversation.id
  into target_conversation_id
  from public.horse_conversations conversation
  join public.horses horse on horse.id = conversation.horse_id
  where horse.id = target_horse_id
    and horse.organization_id = public.current_organization_id()
  for update of conversation;

  if not found then
    raise exception 'Horse conversation not found.';
  end if;

  delete from public.conversation_messages
  where conversation_id = target_conversation_id;

  update public.horse_conversations
  set
    last_message_at = null,
    last_staff_communication_at = null,
    updated_at = now()
  where id = target_conversation_id;
end;
$$;

revoke all on function public.permanently_clear_horse_conversation(uuid) from public;
revoke all on function public.permanently_clear_horse_conversation(uuid) from anon;
grant execute on function public.permanently_clear_horse_conversation(uuid) to authenticated;
grant execute on function public.permanently_clear_horse_conversation(uuid) to service_role;

commit;
