begin;

create table public.guest_waiver_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  version_label text not null check (char_length(version_label) between 1 and 80),
  template_storage_path text not null unique check (char_length(template_storage_path) between 1 and 500),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  template_sha256 text not null check (template_sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create unique index guest_waiver_versions_one_active_per_organization_idx
  on public.guest_waiver_versions (organization_id)
  where is_active;

create index guest_waiver_versions_organization_created_idx
  on public.guest_waiver_versions (organization_id, created_at desc);

create index guest_waiver_versions_created_by_idx
  on public.guest_waiver_versions (created_by);

create table public.guest_waiver_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  waiver_version_id uuid not null references public.guest_waiver_versions(id) on delete restrict,
  confirmation_number text not null unique check (char_length(confirmation_number) between 8 and 40),
  adult_name text not null check (char_length(adult_name) between 1 and 160),
  horse_name text not null check (char_length(horse_name) between 1 and 160),
  email text check (email is null or char_length(email) <= 320),
  typed_signature_name text not null check (char_length(typed_signature_name) between 1 and 160),
  pdf_storage_path text not null unique check (char_length(pdf_storage_path) between 1 and 500),
  email_copy_requested boolean not null default false,
  email_sent_at timestamptz,
  submitted_at timestamptz not null default now(),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text not null default '' check (char_length(user_agent) <= 500),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  check ((reviewed_at is null and reviewed_by is null) or (reviewed_at is not null and reviewed_by is not null)),
  check (not email_copy_requested or email is not null)
);

create index guest_waiver_submissions_organization_submitted_idx
  on public.guest_waiver_submissions (organization_id, submitted_at desc);

create index guest_waiver_submissions_organization_unreviewed_idx
  on public.guest_waiver_submissions (organization_id, submitted_at desc)
  where reviewed_at is null;

create index guest_waiver_submissions_version_idx
  on public.guest_waiver_submissions (waiver_version_id);

create index guest_waiver_submissions_reviewed_by_idx
  on public.guest_waiver_submissions (reviewed_by)
  where reviewed_by is not null;

create table public.guest_waiver_minors (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.guest_waiver_submissions(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 160),
  birth_date date not null,
  sort_order smallint not null check (sort_order between 0 and 19),
  unique (submission_id, sort_order)
);

create index guest_waiver_minors_submission_order_idx
  on public.guest_waiver_minors (submission_id, sort_order);

create table public.guest_waiver_rate_limits (
  rate_key text primary key check (rate_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count smallint not null default 1 check (attempt_count between 1 and 100),
  updated_at timestamptz not null default now()
);

alter table public.guest_waiver_versions enable row level security;
alter table public.guest_waiver_submissions enable row level security;
alter table public.guest_waiver_minors enable row level security;
alter table public.guest_waiver_rate_limits enable row level security;

create policy guest_waiver_versions_select_admin
on public.guest_waiver_versions for select to authenticated
using (organization_id = public.current_organization_id() and public.is_admin());

create policy guest_waiver_submissions_select_admin
on public.guest_waiver_submissions for select to authenticated
using (organization_id = public.current_organization_id() and public.is_admin());

create policy guest_waiver_submissions_update_admin
on public.guest_waiver_submissions for update to authenticated
using (organization_id = public.current_organization_id() and public.is_admin())
with check (
  organization_id = public.current_organization_id()
  and public.is_admin()
  and reviewed_by = auth.uid()
);

create policy guest_waiver_minors_select_admin
on public.guest_waiver_minors for select to authenticated
using (
  exists (
    select 1
    from public.guest_waiver_submissions submission
    where submission.id = guest_waiver_minors.submission_id
      and submission.organization_id = public.current_organization_id()
      and public.is_admin()
  )
);

grant select on public.guest_waiver_versions to authenticated;
grant select on public.guest_waiver_submissions to authenticated;
grant update (reviewed_at, reviewed_by) on public.guest_waiver_submissions to authenticated;
grant select on public.guest_waiver_minors to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('waiver-templates', 'waiver-templates', true, 10485760, array['application/pdf']),
  ('guest-waivers', 'guest-waivers', false, 15728640, array['application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy waiver_template_objects_insert_admin
on storage.objects for insert to authenticated
with check (
  bucket_id = 'waiver-templates'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);

create policy waiver_template_objects_delete_admin
on storage.objects for delete to authenticated
using (
  bucket_id = 'waiver-templates'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);

create policy guest_waiver_objects_select_admin
on storage.objects for select to authenticated
using (
  bucket_id = 'guest-waivers'
  and public.is_admin()
  and (storage.foldername(name))[1] = public.current_organization_id()::text
);

create or replace function public.activate_guest_waiver_version(
  waiver_title text,
  waiver_version_label text,
  waiver_template_storage_path text,
  waiver_original_filename text,
  waiver_template_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  organization uuid := public.current_organization_id();
  version_id uuid;
begin
  if not public.is_admin() or organization is null then
    raise exception 'Only an active administrator can activate a guest waiver.';
  end if;
  if char_length(trim(waiver_title)) not between 1 and 160
    or char_length(trim(waiver_version_label)) not between 1 and 80
    or char_length(trim(waiver_original_filename)) not between 1 and 255
    or waiver_template_sha256 !~ '^[0-9a-f]{64}$'
    or waiver_template_storage_path not like organization::text || '/%'
  then
    raise exception 'The guest waiver details are invalid.';
  end if;

  update public.guest_waiver_versions
  set is_active = false
  where organization_id = organization and is_active;

  insert into public.guest_waiver_versions (
    organization_id,
    title,
    version_label,
    template_storage_path,
    original_filename,
    template_sha256,
    is_active,
    created_by
  )
  values (
    organization,
    trim(waiver_title),
    trim(waiver_version_label),
    waiver_template_storage_path,
    trim(waiver_original_filename),
    waiver_template_sha256,
    true,
    auth.uid()
  )
  returning id into version_id;

  return version_id;
end;
$$;

create or replace function public.get_active_guest_waiver(stable_slug text)
returns table (
  id uuid,
  title text,
  version_label text,
  template_storage_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    version.id,
    version.title,
    version.version_label,
    version.template_storage_path
  from public.guest_waiver_versions version
  join public.organizations organization on organization.id = version.organization_id
  where organization.slug = stable_slug
    and version.is_active
  limit 1;
$$;

revoke all on function public.activate_guest_waiver_version(text, text, text, text, text) from public;
grant execute on function public.activate_guest_waiver_version(text, text, text, text, text) to authenticated;

revoke all on function public.get_active_guest_waiver(text) from public;
grant execute on function public.get_active_guest_waiver(text) to anon, authenticated;

commit;
