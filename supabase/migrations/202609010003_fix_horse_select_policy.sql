drop policy if exists horses_select_accessible on public.horses;

create policy horses_select_accessible
on public.horses
for select
using (
  organization_id = public.current_organization_id()
  and (
    public.is_staff()
    or exists (
      select 1
      from public.horse_access access
      where access.horse_id = horses.id
        and access.profile_id = auth.uid()
    )
  )
);
