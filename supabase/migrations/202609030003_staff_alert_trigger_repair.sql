begin;

drop trigger if exists care_profiles_set_updated_at on public.care_profiles;

create trigger care_profiles_set_updated_at
before update on public.care_profiles
for each row execute function public.set_updated_at();

drop trigger if exists care_profile_audit_after_update on public.care_profiles;
drop trigger if exists care_profile_audit_after_write on public.care_profiles;

create trigger care_profile_audit_after_write
after insert or update on public.care_profiles
for each row execute function public.audit_care_profile_change();

drop trigger if exists medication_audit_after_insert_or_update on public.horse_medications;
drop trigger if exists medication_audit_after_write on public.horse_medications;

create trigger medication_audit_after_write
after insert or update or delete on public.horse_medications
for each row execute function public.audit_medication_change();

commit;
