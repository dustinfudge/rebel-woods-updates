do $$
begin
  if not exists (select 1 from pg_type where typname = 'conversation_message_kind') then
    create type public.conversation_message_kind as enum ('message', 'historical_update');
  end if;
end;
$$;

create table public.horse_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  horse_id uuid not null unique references public.horses(id) on delete cascade,
  last_message_at timestamptz,
  last_staff_communication_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.horse_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  kind public.conversation_message_kind not null default 'message',
  body text not null default '' check (char_length(body) <= 4000),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  legacy_update_id uuid unique references public.weekly_updates(id) on delete set null,
  legacy_message_id uuid unique references public.messages(id) on delete set null,
  check ((hidden_at is null and hidden_by is null) or (hidden_at is not null and hidden_by is not null)),
  check (legacy_update_id is null or legacy_message_id is null)
);

create table public.conversation_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_bucket text not null check (storage_bucket in ('conversation-media', 'update-media', 'message-media')),
  storage_path text not null,
  media_type public.media_type not null,
  mime_type text not null,
  original_filename text not null,
  byte_size bigint not null check (byte_size between 1 and 157286400),
  duration_seconds numeric(6, 2),
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  legacy_update_media_id uuid unique references public.update_media(id) on delete set null,
  legacy_message_media_id uuid unique references public.message_media(id) on delete set null,
  unique (storage_bucket, storage_path),
  check ((media_type = 'photo' and duration_seconds is null) or (media_type = 'video' and duration_seconds between 0.01 and 60)),
  check (legacy_update_media_id is null or legacy_message_media_id is null)
);

create table public.conversation_message_reads (
  message_id uuid not null references public.conversation_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

alter table public.notifications
add column if not exists conversation_message_id uuid references public.conversation_messages(id) on delete cascade;

create index horse_conversations_organization_staff_activity_idx
on public.horse_conversations (organization_id, last_staff_communication_at desc nulls last, horse_id);

create index conversation_messages_conversation_created_idx
on public.conversation_messages (conversation_id, created_at, id);

create index conversation_messages_sender_created_idx
on public.conversation_messages (sender_id, created_at desc);

create index conversation_media_message_sort_idx
on public.conversation_media (message_id, sort_order, created_at, id);

create index conversation_media_uploaded_by_idx
on public.conversation_media (uploaded_by, created_at desc);

create index conversation_message_reads_profile_read_idx
on public.conversation_message_reads (profile_id, read_at desc);

create index notifications_conversation_message_idx
on public.notifications (conversation_message_id)
where conversation_message_id is not null;

create or replace function public.can_access_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.horse_conversations conversation
    where conversation.id = target_conversation_id
      and public.can_access_horse(conversation.horse_id)
  );
$$;

create or replace function public.can_access_conversation_message(target_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_messages message
    where message.id = target_message_id
      and public.can_access_conversation(message.conversation_id)
  );
$$;

alter table public.horse_conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_media enable row level security;
alter table public.conversation_message_reads enable row level security;

create policy horse_conversations_select_accessible
on public.horse_conversations for select
using (public.can_access_horse(horse_id));

create policy conversation_messages_select_accessible
on public.conversation_messages for select
using (public.can_access_conversation(conversation_id));

create policy conversation_messages_insert_participant
on public.conversation_messages for insert
with check (
  sender_id = auth.uid()
  and kind = 'message'
  and hidden_at is null
  and hidden_by is null
  and legacy_update_id is null
  and legacy_message_id is null
  and public.can_access_conversation(conversation_id)
);

create policy conversation_messages_hide_admin
on public.conversation_messages for update
using (public.is_admin() and public.can_access_conversation(conversation_id))
with check (public.is_admin() and public.can_access_conversation(conversation_id));

create policy conversation_media_select_accessible
on public.conversation_media for select
using (public.can_access_conversation_message(message_id));

create policy conversation_media_insert_participant
on public.conversation_media for insert
with check (
  uploaded_by = auth.uid()
  and storage_bucket = 'conversation-media'
  and legacy_update_media_id is null
  and legacy_message_media_id is null
  and public.can_access_conversation_message(message_id)
);

create policy conversation_media_delete_admin
on public.conversation_media for delete
using (public.is_admin() and public.can_access_conversation_message(message_id));

create policy conversation_message_reads_select_participants
on public.conversation_message_reads for select
using (public.can_access_conversation_message(message_id));

create policy conversation_message_reads_insert_self
on public.conversation_message_reads for insert
with check (profile_id = auth.uid() and public.can_access_conversation_message(message_id));

create policy conversation_message_reads_update_self
on public.conversation_message_reads for update
using (profile_id = auth.uid() and public.can_access_conversation_message(message_id))
with check (profile_id = auth.uid() and public.can_access_conversation_message(message_id));

grant select on public.horse_conversations to authenticated;
grant select, insert, update on public.conversation_messages to authenticated;
grant select, insert, delete on public.conversation_media to authenticated;
grant select, insert, update on public.conversation_message_reads to authenticated;

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
  if (select count(*) from public.horse_conversations) <> (select count(*) from public.horses) then
    raise exception 'Horse conversation backfill did not create exactly one conversation per horse.';
  end if;

  if (select count(*) from public.conversation_messages where legacy_update_id is not null)
    <> (select count(*) from public.weekly_updates where published_at is not null) then
    raise exception 'Published weekly update backfill count does not match.';
  end if;

  if (select count(*) from public.conversation_messages where legacy_message_id is not null)
    <> (select count(*) from public.messages) then
    raise exception 'Reply backfill count does not match.';
  end if;

  if (select count(*) from public.conversation_media where legacy_update_media_id is not null)
    <> (select count(*) from public.update_media) then
    raise exception 'Weekly update media backfill count does not match.';
  end if;

  if (select count(*) from public.conversation_media where legacy_message_media_id is not null)
    <> (select count(*) from public.message_media) then
    raise exception 'Reply media backfill count does not match.';
  end if;

  if (select count(*) from public.conversation_message_reads)
    <> (select count(*) from public.message_reads) then
    raise exception 'Read receipt backfill count does not match.';
  end if;
end;
$$;

create or replace function public.create_horse_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.horse_conversations (organization_id, horse_id)
  values (new.organization_id, new.id)
  on conflict (horse_id) do nothing;
  return new;
end;
$$;

drop trigger if exists horse_conversation_after_insert on public.horses;
create trigger horse_conversation_after_insert
after insert on public.horses
for each row execute function public.create_horse_conversation();

create or replace function public.record_conversation_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_role public.app_role;
begin
  select profile.role into sender_role
  from public.profiles profile
  where profile.id = new.sender_id;

  update public.horse_conversations
  set
    last_message_at = case
      when last_message_at is null or new.created_at > last_message_at then new.created_at
      else last_message_at
    end,
    last_staff_communication_at = case
      when sender_role in ('admin', 'stable_hand')
        and (last_staff_communication_at is null or new.created_at > last_staff_communication_at)
      then new.created_at
      else last_staff_communication_at
    end,
    updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

create trigger conversation_activity_after_insert
after insert on public.conversation_messages
for each row execute function public.record_conversation_activity();

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

create trigger conversation_message_notification_after_insert
after insert on public.conversation_messages
for each row execute function public.notify_conversation_message();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conversation-media',
  'conversation-media',
  false,
  157286400,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

create policy conversation_media_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'conversation-media'
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

create policy conversation_media_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'conversation-media'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

create policy conversation_media_objects_delete_admin
on storage.objects for delete to authenticated
using (
  bucket_id = 'conversation-media'
  and public.is_admin()
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

alter table public.conversation_messages replica identity full;
alter table public.conversation_media replica identity full;
alter table public.conversation_message_reads replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_messages'
  ) then
    alter publication supabase_realtime add table public.conversation_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_media'
  ) then
    alter publication supabase_realtime add table public.conversation_media;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_message_reads'
  ) then
    alter publication supabase_realtime add table public.conversation_message_reads;
  end if;
end;
$$;
