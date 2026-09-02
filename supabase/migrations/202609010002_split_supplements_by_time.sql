alter table public.care_profiles
  rename column supplements to supplements_am;

alter table public.care_profiles
  add column supplements_pm text not null default '';
