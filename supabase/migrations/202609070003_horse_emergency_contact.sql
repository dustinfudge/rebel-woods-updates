begin;

alter table public.horses
  add column if not exists emergency_contact_name text not null default '',
  add column if not exists emergency_contact_phone text not null default '';

alter table public.horses
  drop constraint if exists horses_emergency_contact_name_length,
  add constraint horses_emergency_contact_name_length check (char_length(emergency_contact_name) <= 160),
  drop constraint if exists horses_emergency_contact_phone_length,
  add constraint horses_emergency_contact_phone_length check (char_length(emergency_contact_phone) <= 50);

commit;
