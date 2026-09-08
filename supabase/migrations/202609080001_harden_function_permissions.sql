begin;

alter function public.try_uuid(text) set search_path = public;
alter function public.set_updated_at() set search_path = public;

revoke execute on all functions in schema public from public;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from authenticated;

grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.can_access_horse(uuid) to authenticated;
grant execute on function public.can_access_update(uuid) to authenticated;
grant execute on function public.can_access_message(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
grant execute on function public.can_access_conversation(uuid) to authenticated;
grant execute on function public.can_access_conversation_message(uuid) to authenticated;

grant execute on function public.acknowledge_staff_alert(uuid) to authenticated;
grant execute on function public.create_custom_staff_alert(text) to authenticated;
grant execute on function public.archive_staff_alert(uuid) to authenticated;
grant execute on function public.delete_archived_staff_alert(uuid) to authenticated;
grant execute on function public.move_horse_to_field(uuid, uuid) to authenticated;
grant execute on function public.move_horse_to_herd(uuid, uuid) to authenticated;
grant execute on function public.create_herd_for_horse(uuid) to authenticated;
grant execute on function public.move_herd_to_field(uuid, uuid) to authenticated;
grant execute on function public.permanently_delete_horse(uuid) to authenticated;
grant execute on function public.permanently_delete_person(uuid) to authenticated;

grant execute on all functions in schema public to service_role;

alter default privileges in schema public
revoke execute on functions from public;

alter default privileges in schema public
grant execute on functions to service_role;

commit;
