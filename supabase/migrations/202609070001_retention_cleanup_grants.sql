begin;

grant usage on schema public to service_role;

grant select
on table
  public.organizations,
  public.horse_conversations,
  public.conversation_media
to service_role;

grant select, delete
on table public.conversation_messages
to service_role;

commit;
