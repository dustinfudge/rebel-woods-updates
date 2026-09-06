begin;

create or replace function public.can_access_horse(target_horse_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.horses horse
    where horse.id = target_horse_id
      and horse.organization_id = public.current_organization_id()
      and (horse.is_active or public.is_admin())
      and (
        public.is_staff()
        or exists (
          select 1
          from public.horse_access access
          where access.horse_id = horse.id
            and access.profile_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.notify_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_horse_id uuid;
  target_organization_id uuid;
  horse_name text;
  sender_name text;
begin
  if new.legacy_update_id is not null or new.legacy_message_id is not null then
    return new;
  end if;

  select conversation.horse_id, conversation.organization_id, horse.name
  into target_horse_id, target_organization_id, horse_name
  from public.horse_conversations conversation
  join public.horses horse on horse.id = conversation.horse_id
  where conversation.id = new.conversation_id;

  select profile.full_name into sender_name
  from public.profiles profile
  where profile.id = new.sender_id;

  insert into public.notifications (user_id, horse_id, conversation_message_id, kind, title, body)
  select
    recipient.id,
    target_horse_id,
    new.id,
    'reply',
    'New message about ' || horse_name,
    coalesce(nullif(left(new.body, 180), ''), sender_name || ' shared a photo or video.')
  from (
    select access.profile_id as id
    from public.horse_access access
    join public.profiles profile on profile.id = access.profile_id
    where access.horse_id = target_horse_id
      and profile.is_active
    union
    select profile.id
    from public.profiles profile
    where profile.organization_id = target_organization_id
      and profile.role in ('admin', 'stable_hand')
      and profile.is_active
  ) recipient
  where recipient.id <> new.sender_id;

  return new;
end;
$$;

create or replace function public.remove_inactive_profile_push_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.is_active and not new.is_active then
    if new.id = auth.uid() then
      raise exception 'You cannot deactivate your own administrator account.';
    end if;

    delete from public.push_subscriptions
    where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_remove_inactive_push_subscriptions on public.profiles;
create trigger profiles_remove_inactive_push_subscriptions
after update of is_active on public.profiles
for each row
execute function public.remove_inactive_profile_push_subscriptions();

commit;
