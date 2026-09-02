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
    where access.horse_id = target_horse_id
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

insert into public.horse_conversations (organization_id, horse_id, created_at, updated_at)
select horse.organization_id, horse.id, horse.created_at, now()
from public.horses horse
on conflict (horse_id) do nothing;

insert into public.conversation_messages (
  conversation_id,
  sender_id,
  kind,
  body,
  created_at,
  edited_at,
  legacy_update_id
)
select
  conversation.id,
  weekly_update.author_id,
  'historical_update',
  weekly_update.body,
  weekly_update.published_at,
  case when weekly_update.updated_at > weekly_update.published_at then weekly_update.updated_at end,
  weekly_update.id
from public.weekly_updates weekly_update
join public.horse_conversations conversation on conversation.horse_id = weekly_update.horse_id
where weekly_update.published_at is not null
on conflict (legacy_update_id) do nothing;

insert into public.conversation_messages (
  conversation_id,
  sender_id,
  kind,
  body,
  hidden_at,
  hidden_by,
  created_at,
  legacy_message_id
)
select
  conversation.id,
  message.sender_id,
  'message',
  message.body,
  message.hidden_at,
  message.hidden_by,
  message.created_at,
  message.id
from public.messages message
join public.weekly_updates weekly_update on weekly_update.id = message.update_id
join public.horse_conversations conversation on conversation.horse_id = weekly_update.horse_id
on conflict (legacy_message_id) do nothing;

insert into public.conversation_media (
  message_id,
  uploaded_by,
  storage_bucket,
  storage_path,
  media_type,
  mime_type,
  original_filename,
  byte_size,
  duration_seconds,
  sort_order,
  created_at,
  legacy_update_media_id
)
select
  conversation_message.id,
  update_media.uploaded_by,
  'update-media',
  update_media.storage_path,
  update_media.media_type,
  update_media.mime_type,
  update_media.original_filename,
  update_media.byte_size,
  update_media.duration_seconds,
  update_media.sort_order,
  update_media.created_at,
  update_media.id
from public.update_media update_media
join public.conversation_messages conversation_message on conversation_message.legacy_update_id = update_media.update_id
on conflict (legacy_update_media_id) do nothing;

insert into public.conversation_media (
  message_id,
  uploaded_by,
  storage_bucket,
  storage_path,
  media_type,
  mime_type,
  original_filename,
  byte_size,
  sort_order,
  created_at,
  legacy_message_media_id
)
select
  conversation_message.id,
  message_media.uploaded_by,
  'message-media',
  message_media.storage_path,
  'photo',
  message_media.mime_type,
  message_media.original_filename,
  message_media.byte_size,
  0,
  message_media.created_at,
  message_media.id
from public.message_media message_media
join public.conversation_messages conversation_message on conversation_message.legacy_message_id = message_media.message_id
on conflict (legacy_message_media_id) do nothing;

insert into public.conversation_message_reads (message_id, profile_id, read_at)
select conversation_message.id, message_read.profile_id, message_read.read_at
from public.message_reads message_read
join public.conversation_messages conversation_message on conversation_message.legacy_message_id = message_read.message_id
on conflict (message_id, profile_id) do update set read_at = excluded.read_at;

with activity as (
  select
    message.conversation_id,
    max(message.created_at) as last_message_at,
    max(message.created_at) filter (where profile.role in ('admin', 'stable_hand')) as last_staff_communication_at
  from public.conversation_messages message
  join public.profiles profile on profile.id = message.sender_id
  group by message.conversation_id
)
update public.horse_conversations conversation
set
  last_message_at = activity.last_message_at,
  last_staff_communication_at = activity.last_staff_communication_at,
  updated_at = now()
from activity
where activity.conversation_id = conversation.id;

do $$
begin
  if exists (
    select 1
    from public.horses horse
    left join public.horse_conversations conversation on conversation.horse_id = horse.id
    where conversation.id is null
  ) then
    raise exception 'A horse is missing its conversation.';
  end if;

  if exists (
    select 1
    from public.weekly_updates weekly_update
    left join public.conversation_messages conversation_message on conversation_message.legacy_update_id = weekly_update.id
    where weekly_update.published_at is not null
      and conversation_message.id is null
  ) then
    raise exception 'A published weekly update is missing from its conversation.';
  end if;

  if exists (
    select 1
    from public.messages message
    left join public.conversation_messages conversation_message on conversation_message.legacy_message_id = message.id
    where conversation_message.id is null
  ) then
    raise exception 'A legacy reply is missing from its conversation.';
  end if;

  if exists (
    select 1
    from public.update_media update_media
    left join public.conversation_media conversation_media on conversation_media.legacy_update_media_id = update_media.id
    where conversation_media.id is null
  ) then
    raise exception 'A weekly update attachment is missing from its conversation.';
  end if;

  if exists (
    select 1
    from public.message_media message_media
    left join public.conversation_media conversation_media on conversation_media.legacy_message_media_id = message_media.id
    where conversation_media.id is null
  ) then
    raise exception 'A reply attachment is missing from its conversation.';
  end if;

  if exists (
    select 1
    from public.message_reads message_read
    join public.conversation_messages conversation_message on conversation_message.legacy_message_id = message_read.message_id
    left join public.conversation_message_reads conversation_read
      on conversation_read.message_id = conversation_message.id
      and conversation_read.profile_id = message_read.profile_id
    where conversation_read.message_id is null
  ) then
    raise exception 'A legacy read receipt is missing from its conversation.';
  end if;
end;
$$;
