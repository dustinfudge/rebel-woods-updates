begin;

grant all privileges on table public.guest_waiver_versions to service_role;
grant all privileges on table public.guest_waiver_submissions to service_role;
grant all privileges on table public.guest_waiver_minors to service_role;
grant all privileges on table public.guest_waiver_rate_limits to service_role;

commit;
