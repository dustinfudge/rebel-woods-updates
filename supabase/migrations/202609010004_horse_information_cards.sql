alter table public.profiles
  add column phone text not null default ''
  check (char_length(phone) <= 50);

alter table public.horses
  add column horse_type text not null default ''
    check (char_length(horse_type) <= 160),
  add column birth_year smallint
    check (birth_year between 1900 and 2200),
  add column veterinarian_name text not null default ''
    check (char_length(veterinarian_name) <= 160),
  add column veterinarian_phone text not null default ''
    check (char_length(veterinarian_phone) <= 50),
  add column farrier_name text not null default ''
    check (char_length(farrier_name) <= 160),
  add column farrier_phone text not null default ''
    check (char_length(farrier_phone) <= 50),
  add column deworming_schedule text not null default '',
  add column vaccine_schedule text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'horse-thumbnails',
  'horse-thumbnails',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy horse_thumbnails_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'horse-thumbnails'
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

create policy horse_thumbnails_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'horse-thumbnails'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

create policy horse_thumbnails_objects_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'horse-thumbnails'
  and public.is_admin()
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
)
with check (
  bucket_id = 'horse-thumbnails'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);

create policy horse_thumbnails_objects_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'horse-thumbnails'
  and public.is_admin()
  and public.can_access_horse(public.try_uuid((storage.foldername(name))[2]))
);
