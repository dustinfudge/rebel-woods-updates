begin;

create or replace function public.create_herd_for_horse(target_horse_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  moving_horse public.horses%rowtype;
  new_herd_id uuid := gen_random_uuid();
begin
  if not public.is_admin() then
    raise exception 'Only an active administrator can create a herd.';
  end if;

  select horse.*
  into moving_horse
  from public.horses horse
  where horse.id = target_horse_id
    and horse.organization_id = public.current_organization_id()
    and horse.is_active;

  if not found then
    raise exception 'The horse could not be found.';
  end if;

  insert into public.herds (id, organization_id, name, field_id)
  values (
    new_herd_id,
    moving_horse.organization_id,
    'group-' || new_herd_id::text,
    moving_horse.field_id
  );

  perform public.move_horse_to_herd(moving_horse.id, new_herd_id);

  return new_herd_id;
end;
$$;

grant execute on function public.create_herd_for_horse(uuid) to authenticated;

commit;
