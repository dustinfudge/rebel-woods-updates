create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'stable_hand', 'owner');
create type public.horse_relationship as enum ('primary_owner', 'family');
create type public.media_type as enum ('photo', 'video');
create type public.medication_status as enum ('active', 'completed', 'discontinued');
create type public.notification_kind as enum ('weekly_update', 'reply', 'care_change', 'medication_change');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.app_role not null default 'owner',
  full_name text not null check (char_length(full_name) between 1 and 120),
  email text not null,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.herds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.horses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  photo_path text,
  field_id uuid references public.fields(id) on delete set null,
  herd_id uuid references public.herds(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.horse_access (
  horse_id uuid not null references public.horses(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  relationship public.horse_relationship not null default 'family',
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (horse_id, profile_id)
);

create table public.care_profiles (
  horse_id uuid primary key references public.horses(id) on delete cascade,
  am_feed text not null default '',
  pm_feed text not null default '',
  supplements text not null default '',
  special_requirements text not null default '',
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.horse_medications (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  dosage text not null check (char_length(dosage) between 1 and 300),
  instructions text not null check (char_length(instructions) between 1 and 2000),
  starts_on date not null,
  ends_on date,
  status public.medication_status not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create table public.weekly_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  horse_id uuid not null references public.horses(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  week_start date not null check (extract(isodow from week_start) = 1),
  body text not null check (char_length(body) between 1 and 4000),
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (horse_id, week_start)
);

create table public.update_media (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.weekly_updates(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  media_type public.media_type not null,
  mime_type text not null,
  original_filename text not null,
  byte_size bigint not null check (byte_size > 0),
  duration_seconds numeric(6, 2),
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  check ((media_type = 'photo' and duration_seconds is null) or (media_type = 'video' and duration_seconds between 0.01 and 60))
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.weekly_updates(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((hidden_at is null and hidden_by is null) or (hidden_at is not null and hidden_by is not null))
);

create table public.message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  mime_type text not null check (mime_type like 'image/%'),
  original_filename text not null,
  byte_size bigint not null check (byte_size between 1 and 15728640),
  created_at timestamptz not null default now()
);

create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

create table public.care_change_log (
  id uuid primary key default gen_random_uuid(),
  horse_id uuid not null references public.horses(id) on delete cascade,
  changed_by uuid not null references public.profiles(id),
  change_type text not null,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  horse_id uuid references public.horses(id) on delete cascade,
  update_id uuid references public.weekly_updates(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  push_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index profiles_organization_role_idx on public.profiles (organization_id, role) where is_active;
create index fields_organization_active_idx on public.fields (organization_id, is_active, name);
create index herds_organization_active_idx on public.herds (organization_id, is_active, name);
create index horses_organization_active_name_idx on public.horses (organization_id, is_active, name);
create index horses_field_id_idx on public.horses (field_id) where field_id is not null;
create index horses_herd_id_idx on public.horses (herd_id) where herd_id is not null;
create index horse_access_profile_horse_idx on public.horse_access (profile_id, horse_id);
create index horse_access_granted_by_idx on public.horse_access (granted_by);
create index horse_medications_horse_status_starts_idx on public.horse_medications (horse_id, status, starts_on desc);
create index horse_medications_created_by_idx on public.horse_medications (created_by);
create index horse_medications_updated_by_idx on public.horse_medications (updated_by);
create index weekly_updates_horse_week_idx on public.weekly_updates (horse_id, week_start desc);
create index weekly_updates_organization_week_idx on public.weekly_updates (organization_id, week_start desc);
create index weekly_updates_author_published_idx on public.weekly_updates (author_id, published_at desc);
create index update_media_update_sort_idx on public.update_media (update_id, sort_order, created_at);
create index update_media_uploaded_by_idx on public.update_media (uploaded_by);
create index messages_update_created_idx on public.messages (update_id, created_at, id);
create index messages_sender_created_idx on public.messages (sender_id, created_at desc);
create index messages_hidden_by_idx on public.messages (hidden_by) where hidden_by is not null;
create index message_media_message_created_idx on public.message_media (message_id, created_at);
create index message_media_uploaded_by_idx on public.message_media (uploaded_by);
create index message_reads_profile_read_idx on public.message_reads (profile_id, read_at desc);
create index care_change_log_horse_created_idx on public.care_change_log (horse_id, created_at desc);
create index care_change_log_changed_by_idx on public.care_change_log (changed_by, created_at desc);
create index notifications_user_unread_created_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index notifications_horse_created_idx on public.notifications (horse_id, created_at desc) where horse_id is not null;
create index notifications_update_idx on public.notifications (update_id) where update_id is not null;
create index notifications_message_idx on public.notifications (message_id) where message_id is not null;
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'stable_hand'), false);
$$;

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
      and (
        public.is_staff()
        or exists (
          select 1 from public.horse_access access
          where access.horse_id = horse.id and access.profile_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.can_access_update(target_update_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.weekly_updates weekly_update
    where weekly_update.id = target_update_id and public.can_access_horse(weekly_update.horse_id)
  );
$$;

create or replace function public.can_access_message(target_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.messages message
    where message.id = target_message_id and public.can_access_update(message.update_id)
  );
$$;

create or replace function public.can_view_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_profile_id = auth.uid()
    or (
      public.is_staff()
      and exists (
        select 1 from public.profiles target
        where target.id = target_profile_id and target.organization_id = public.current_organization_id()
      )
    )
    or exists (
      select 1
      from public.horse_access mine
      join public.horse_access theirs on theirs.horse_id = mine.horse_id
      where mine.profile_id = auth.uid() and theirs.profile_id = target_profile_id
    )
    or exists (
      select 1 from public.profiles target
      where target.id = target_profile_id
        and target.organization_id = public.current_organization_id()
        and target.role in ('admin', 'stable_hand')
    );
$$;

create or replace function public.try_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger horses_set_updated_at before update on public.horses for each row execute function public.set_updated_at();
create trigger medications_set_updated_at before update on public.horse_medications for each row execute function public.set_updated_at();
create trigger weekly_updates_set_updated_at before update on public.weekly_updates for each row execute function public.set_updated_at();
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions for each row execute function public.set_updated_at();

create or replace function public.audit_care_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  horse_name text;
  organization uuid;
begin
  select name, organization_id into horse_name, organization from public.horses where id = new.horse_id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (new.horse_id, auth.uid(), 'care_profile', to_jsonb(old), to_jsonb(new));

  insert into public.notifications (user_id, horse_id, kind, title, body)
  select access.profile_id, new.horse_id, 'care_change', horse_name || '''s care card changed', 'Open the care card to review the latest instructions.'
  from public.horse_access access
  where access.horse_id = new.horse_id;

  if old.special_requirements is distinct from new.special_requirements then
    insert into public.notifications (user_id, horse_id, kind, title, body)
    select profile.id, new.horse_id, 'care_change', horse_name || '''s special requirements changed', 'Review the updated special requirements before providing care.'
    from public.profiles profile
    where profile.organization_id = organization
      and profile.role in ('admin', 'stable_hand')
      and profile.is_active
      and profile.id <> auth.uid();
  end if;

  return new;
end;
$$;

create trigger care_profile_audit_after_update
after update on public.care_profiles
for each row execute function public.audit_care_profile_change();

create or replace function public.audit_horse_location_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.field_id is distinct from new.field_id or old.herd_id is distinct from new.herd_id then
    insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
    values (
      new.id,
      auth.uid(),
      'location',
      jsonb_build_object('field_id', old.field_id, 'herd_id', old.herd_id),
      jsonb_build_object('field_id', new.field_id, 'herd_id', new.herd_id)
    );

    insert into public.notifications (user_id, horse_id, kind, title, body)
    select access.profile_id, new.id, 'care_change', new.name || '''s location changed', 'Open the care card to see the current field and herd.'
    from public.horse_access access
    where access.horse_id = new.id;
  end if;
  return new;
end;
$$;

create trigger horse_location_audit_after_update
after update of field_id, herd_id on public.horses
for each row execute function public.audit_horse_location_change();

create or replace function public.audit_medication_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_horse_id uuid := coalesce(new.horse_id, old.horse_id);
  horse_name text;
  organization uuid;
  actor uuid := auth.uid();
begin
  select name, organization_id into horse_name, organization from public.horses where id = target_horse_id;

  insert into public.care_change_log (horse_id, changed_by, change_type, previous_values, new_values)
  values (
    target_horse_id,
    actor,
    'medication',
    case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end,
    to_jsonb(new)
  );

  insert into public.notifications (user_id, horse_id, kind, title, body)
  select recipient.id, target_horse_id, 'medication_change', horse_name || '''s medications changed', 'Review the medication section for current dosage and instructions.'
  from (
    select access.profile_id as id from public.horse_access access where access.horse_id = target_horse_id
    union
    select profile.id from public.profiles profile
    where profile.organization_id = organization and profile.role in ('admin', 'stable_hand') and profile.is_active
  ) recipient
  where recipient.id <> actor;

  return new;
end;
$$;

create trigger medication_audit_after_insert_or_update
after insert or update on public.horse_medications
for each row execute function public.audit_medication_change();

create or replace function public.notify_weekly_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare horse_name text;
begin
  select name into horse_name from public.horses where id = new.horse_id;
  insert into public.notifications (user_id, horse_id, update_id, kind, title, body)
  select access.profile_id, new.horse_id, new.id, 'weekly_update', horse_name || '''s weekly update is ready', left(new.body, 180)
  from public.horse_access access
  where access.horse_id = new.horse_id;
  return new;
end;
$$;

create trigger weekly_update_notification_after_insert
after insert on public.weekly_updates
for each row execute function public.notify_weekly_update();

create or replace function public.notify_new_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_horse_id uuid;
  target_organization_id uuid;
  horse_name text;
begin
  select weekly_update.horse_id, weekly_update.organization_id, horse.name
  into target_horse_id, target_organization_id, horse_name
  from public.weekly_updates weekly_update
  join public.horses horse on horse.id = weekly_update.horse_id
  where weekly_update.id = new.update_id;

  insert into public.notifications (user_id, horse_id, update_id, message_id, kind, title, body)
  select recipient.id, target_horse_id, new.update_id, new.id, 'reply', 'New reply about ' || horse_name, left(new.body, 180)
  from (
    select access.profile_id as id from public.horse_access access where access.horse_id = target_horse_id
    union
    select profile.id from public.profiles profile
    where profile.organization_id = target_organization_id and profile.role in ('admin', 'stable_hand') and profile.is_active
  ) recipient
  where recipient.id <> new.sender_id;
  return new;
end;
$$;

create trigger reply_notification_after_insert
after insert on public.messages
for each row execute function public.notify_new_reply();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.fields enable row level security;
alter table public.herds enable row level security;
alter table public.horses enable row level security;
alter table public.horse_access enable row level security;
alter table public.care_profiles enable row level security;
alter table public.horse_medications enable row level security;
alter table public.weekly_updates enable row level security;
alter table public.update_media enable row level security;
alter table public.messages enable row level security;
alter table public.message_media enable row level security;
alter table public.message_reads enable row level security;
alter table public.care_change_log enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

create policy organizations_select_own on public.organizations for select using (id = public.current_organization_id());
create policy organizations_update_admin on public.organizations for update using (id = public.current_organization_id() and public.is_admin()) with check (id = public.current_organization_id() and public.is_admin());

create policy profiles_select_visible on public.profiles for select using (public.can_view_profile(id));
create policy profiles_insert_admin on public.profiles for insert with check (organization_id = public.current_organization_id() and public.is_admin());
create policy profiles_update_admin on public.profiles for update using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());
create policy profiles_delete_admin on public.profiles for delete using (organization_id = public.current_organization_id() and public.is_admin() and id <> auth.uid());

create policy fields_select_own_organization on public.fields for select using (organization_id = public.current_organization_id());
create policy fields_manage_admin on public.fields for all using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());
create policy herds_select_own_organization on public.herds for select using (organization_id = public.current_organization_id());
create policy herds_manage_admin on public.herds for all using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());

create policy horses_select_accessible on public.horses for select using (public.can_access_horse(id));
create policy horses_insert_admin on public.horses for insert with check (organization_id = public.current_organization_id() and public.is_admin());
create policy horses_update_admin on public.horses for update using (organization_id = public.current_organization_id() and public.is_admin()) with check (organization_id = public.current_organization_id() and public.is_admin());
create policy horses_delete_admin on public.horses for delete using (organization_id = public.current_organization_id() and public.is_admin());

create policy horse_access_select_participants on public.horse_access for select using (profile_id = auth.uid() or public.is_staff());
create policy horse_access_manage_admin on public.horse_access for all using (public.is_admin() and public.can_access_horse(horse_id)) with check (public.is_admin() and public.can_access_horse(horse_id));

create policy care_profiles_select_accessible on public.care_profiles for select using (public.can_access_horse(horse_id));
create policy care_profiles_insert_admin on public.care_profiles for insert with check (public.is_admin() and public.can_access_horse(horse_id) and updated_by = auth.uid());
create policy care_profiles_update_admin on public.care_profiles for update using (public.is_admin() and public.can_access_horse(horse_id)) with check (public.is_admin() and public.can_access_horse(horse_id) and updated_by = auth.uid());

create policy medications_select_accessible on public.horse_medications for select using (public.can_access_horse(horse_id));
create policy medications_insert_admin on public.horse_medications for insert with check (public.is_admin() and public.can_access_horse(horse_id) and created_by = auth.uid() and updated_by = auth.uid());
create policy medications_update_admin on public.horse_medications for update using (public.is_admin() and public.can_access_horse(horse_id)) with check (public.is_admin() and public.can_access_horse(horse_id) and updated_by = auth.uid());

create policy weekly_updates_select_accessible on public.weekly_updates for select using (public.can_access_horse(horse_id));
create policy weekly_updates_insert_staff on public.weekly_updates for insert with check (public.is_staff() and public.can_access_horse(horse_id) and organization_id = public.current_organization_id() and author_id = auth.uid());
create policy weekly_updates_update_staff on public.weekly_updates for update using (public.is_staff() and public.can_access_horse(horse_id)) with check (public.is_staff() and public.can_access_horse(horse_id) and organization_id = public.current_organization_id());
create policy weekly_updates_delete_admin on public.weekly_updates for delete using (public.is_admin() and public.can_access_horse(horse_id));

create policy update_media_select_accessible on public.update_media for select using (public.can_access_update(update_id));
create policy update_media_insert_staff on public.update_media for insert with check (public.is_staff() and public.can_access_update(update_id) and uploaded_by = auth.uid());
create policy update_media_update_staff on public.update_media for update using (public.is_staff() and public.can_access_update(update_id)) with check (public.is_staff() and public.can_access_update(update_id));
create policy update_media_delete_staff on public.update_media for delete using (public.is_staff() and public.can_access_update(update_id));

create policy messages_select_accessible on public.messages for select using (public.can_access_update(update_id));
create policy messages_insert_participant on public.messages for insert with check (public.can_access_update(update_id) and sender_id = auth.uid() and hidden_at is null and hidden_by is null);
create policy messages_hide_admin on public.messages for update using (public.is_admin() and public.can_access_update(update_id)) with check (public.is_admin() and public.can_access_update(update_id));

create policy message_media_select_accessible on public.message_media for select using (public.can_access_message(message_id));
create policy message_media_insert_participant on public.message_media for insert with check (public.can_access_message(message_id) and uploaded_by = auth.uid());

create policy message_reads_select_participants on public.message_reads for select using (public.can_access_message(message_id));
create policy message_reads_insert_self on public.message_reads for insert with check (profile_id = auth.uid() and public.can_access_message(message_id));
create policy message_reads_update_self on public.message_reads for update using (profile_id = auth.uid() and public.can_access_message(message_id)) with check (profile_id = auth.uid() and public.can_access_message(message_id));

create policy care_change_log_select_accessible on public.care_change_log for select using (public.can_access_horse(horse_id));
create policy notifications_select_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_manage_own on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('update-media', 'update-media', false, 157286400, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime', 'video/webm']),
  ('message-media', 'message-media', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

create policy update_media_objects_select on storage.objects for select to authenticated
using (bucket_id = 'update-media' and public.can_access_horse(public.try_uuid((storage.foldername(name))[2])));
create policy update_media_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'update-media'
  and public.is_staff()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);
create policy update_media_objects_delete on storage.objects for delete to authenticated
using (bucket_id = 'update-media' and public.is_staff() and public.can_access_horse(public.try_uuid((storage.foldername(name))[2])));

create policy message_media_objects_select on storage.objects for select to authenticated
using (bucket_id = 'message-media' and public.can_access_horse(public.try_uuid((storage.foldername(name))[2])));
create policy message_media_objects_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);
create policy message_media_objects_delete_admin on storage.objects for delete to authenticated
using (bucket_id = 'message-media' and public.is_admin() and public.can_access_horse(public.try_uuid((storage.foldername(name))[2])));

alter table public.messages replica identity full;
alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.weekly_updates;
