begin;

create or replace function public.format_staff_location_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  horse_name text;
  roster_name text;
  companion_names text;
  destination_field_name text;
  destination_field_id uuid;
  source_herd_id uuid;
  destination_herd_id uuid;
  roster_size integer;
begin
  if new.kind = 'herd_field' then
    roster_name := nullif(new.new_values ->> 'roster', '');

    if roster_name is null and new.herd_id is not null then
      roster_name := public.herd_roster_name(new.herd_id);
    end if;

    if roster_name is null and new.horse_id is not null then
      select horse.name into roster_name
      from public.horses horse
      where horse.id = new.horse_id;
    end if;

    roster_name := coalesce(roster_name, 'Herd');
    roster_size := coalesce(array_length(string_to_array(roster_name, ', '), 1), 1);
    destination_field_id := nullif(new.new_values ->> 'field_id', '')::uuid;
    destination_field_name := coalesce(
      nullif(new.new_values ->> 'field', ''),
      public.field_display_name(destination_field_id)
    );

    new.title := roster_name || ' changed fields';
    new.body := case
      when destination_field_id is null and roster_size = 1 then roster_name || ' is not assigned to a field.'
      when destination_field_id is null then roster_name || ' are not assigned to a field.'
      when roster_size = 1 then roster_name || ' goes into the ' || destination_field_name || '.'
      else roster_name || ' go into the ' || destination_field_name || '.'
    end;
  end if;

  if new.kind = 'herd_membership' and new.horse_id is not null then
    select horse.name into horse_name
    from public.horses horse
    where horse.id = new.horse_id;

    horse_name := coalesce(horse_name, split_part(new.title, ' changed herds', 1), 'Horse');
    source_herd_id := nullif(new.previous_values ->> 'herd_id', '')::uuid;
    destination_herd_id := coalesce(new.herd_id, nullif(new.new_values ->> 'herd_id', '')::uuid);

    select string_agg(horse.name, ', ' order by horse.name)
    into companion_names
    from public.horses horse
    where horse.herd_id = destination_herd_id
      and horse.id <> new.horse_id
      and horse.is_active;

    new.title := horse_name || ' changed herds';
    new.body := case
      when companion_names is null and source_herd_id is not null then horse_name || ' was moved out of the herd and is now solo.'
      when companion_names is null then horse_name || ' is now solo.'
      when source_herd_id is not null then horse_name || ' was moved out of the herd and is now with ' || companion_names || '.'
      else horse_name || ' is now with ' || companion_names || '.'
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists format_staff_location_alert_before_write on public.staff_alerts;

create trigger format_staff_location_alert_before_write
before insert or update of new_values, horse_id, herd_id, kind
on public.staff_alerts
for each row
when (new.kind in ('herd_membership', 'herd_field'))
execute function public.format_staff_location_alert();

update public.staff_alerts
set new_values = new_values
where kind in ('herd_membership', 'herd_field')
  and superseded_at is null
  and removed_at is null
  and created_at >= now() - interval '14 days';

commit;
