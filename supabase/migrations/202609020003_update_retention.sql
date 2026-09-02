alter table public.organizations
add column if not exists update_retention_days integer not null default 180;

alter table public.organizations
drop constraint if exists organizations_update_retention_days_check;

alter table public.organizations
add constraint organizations_update_retention_days_check
check (update_retention_days between 30 and 730);

create index if not exists weekly_updates_retention_cleanup_idx
on public.weekly_updates (organization_id, published_at, id)
where published_at is not null;
