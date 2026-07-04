alter table profiles
  add column if not exists display_name text;

create or replace function claim_reminder_notifications(p_now timestamptz default now())
returns table (
  notification_id uuid,
  notification_kind text,
  household_id uuid,
  medication_id uuid,
  medication_name text,
  patient_name text,
  scheduled_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with local_days as (
    select ((p_now at time zone 'Asia/Ho_Chi_Minh')::date - 1) as local_date
    union all
    select (p_now at time zone 'Asia/Ho_Chi_Minh')::date
  ),
  doses as (
    select
      m.household_id,
      m.id as medication_id,
      m.name as medication_name,
      coalesce(
        (
          select nullif(btrim(p.display_name), '')
          from profiles p
          where p.household_id = m.household_id
            and nullif(btrim(p.display_name), '') is not null
          order by p.id
          limit 1
        ),
        nullif(btrim(m.patient_name), ''),
        'Bạn'
      ) as patient_name,
      ((d.local_date + schedule_time) at time zone 'Asia/Ho_Chi_Minh') as scheduled_at
    from local_days d
    join medications m
      on m.start_date <= d.local_date
      and (m.end_date is null or m.end_date >= d.local_date)
    join treatment_courses c on c.id = m.course_id and c.status = 'active'
    cross join unnest(m.schedule_times) as schedule_time
  ),
  eligible as (
    select doses.*
    from doses
    where not exists (
      select 1
      from dose_events e
      where e.medication_id = doses.medication_id
        and e.scheduled_at = doses.scheduled_at
        and e.status in ('taken', 'taken_late', 'skipped')
    )
  ),
  notification_candidates as (
    select *, 'soon'::text as kind
    from eligible
    where scheduled_at - interval '15 minutes' between p_now - interval '2 minutes' and p_now + interval '1 minute'

    union all

    select *, 'due'::text as kind
    from eligible
    where scheduled_at between p_now - interval '5 minutes' and p_now + interval '1 minute'

    union all

    select *, 'late'::text as kind
    from eligible
    where scheduled_at + interval '30 minutes' between p_now - interval '2 minutes' and p_now + interval '1 minute'

    union all

    select *, 'missed'::text as kind
    from eligible
    where scheduled_at + interval '4 hours' between p_now - interval '2 minutes' and p_now + interval '1 minute'
  ),
  inserted_notifications as (
    insert into dose_notifications (household_id, medication_id, scheduled_at, kind)
    select household_id, medication_id, scheduled_at, kind
    from notification_candidates
    on conflict (medication_id, scheduled_at, kind) do nothing
    returning id, household_id, medication_id, scheduled_at, kind
  )
  select
    inserted_notifications.id,
    inserted_notifications.kind,
    inserted_notifications.household_id,
    inserted_notifications.medication_id,
    notification_candidates.medication_name,
    notification_candidates.patient_name,
    inserted_notifications.scheduled_at
  from inserted_notifications
  join notification_candidates
    on notification_candidates.household_id = inserted_notifications.household_id
    and notification_candidates.medication_id = inserted_notifications.medication_id
    and notification_candidates.scheduled_at = inserted_notifications.scheduled_at
    and notification_candidates.kind = inserted_notifications.kind;
$$;

drop function if exists claim_water_reminders(timestamptz);

create function claim_water_reminders(p_now timestamptz default now())
returns table (
  notification_id uuid,
  household_id uuid,
  user_id uuid,
  display_name text,
  scheduled_at timestamptz,
  daily_goal_ml numeric,
  amount_ml numeric
)
language sql
security definer
set search_path = public
as $$
  with configs as (
    select
      p.household_id,
      p.id as user_id,
      coalesce(nullif(btrim(p.display_name), ''), 'bạn') as display_name,
      greatest(1200, least(coalesce(nullif(p.water_reminder ->> 'dailyGoalMl', '')::numeric, 2000), 3500)) as daily_goal_ml,
      greatest(0, least(coalesce(nullif(split_part(coalesce(p.water_reminder ->> 'startTime', '08:00'), ':', 1), '')::int, 8), 23)) * 60
        + greatest(0, least(coalesce(nullif(split_part(coalesce(p.water_reminder ->> 'startTime', '08:00'), ':', 2), '')::int, 0), 59)) as start_minute,
      greatest(0, least(coalesce(nullif(split_part(coalesce(p.water_reminder ->> 'endTime', '21:00'), ':', 1), '')::int, 21), 23)) * 60
        + greatest(0, least(coalesce(nullif(split_part(coalesce(p.water_reminder ->> 'endTime', '21:00'), ':', 2), '')::int, 0), 59)) as end_minute,
      greatest(30, least(coalesce(nullif(p.water_reminder ->> 'intervalMinutes', '')::int, 120), 360)) as interval_minutes
    from profiles p
    where p.notification_enabled is true
      and coalesce((p.water_reminder ->> 'enabled')::boolean, false) is true
  ),
  reminder_times as (
    select
      configs.*,
      generated.reminder_minute,
      (floor((configs.end_minute - configs.start_minute) / configs.interval_minutes) + 1) as reminder_count
    from configs
    cross join lateral generate_series(configs.start_minute, configs.end_minute, configs.interval_minutes) as generated(reminder_minute)
    where configs.end_minute >= configs.start_minute
  ),
  candidates as (
    select
      household_id,
      user_id,
      display_name,
      daily_goal_ml,
      greatest(50, round((daily_goal_ml / greatest(reminder_count, 1)) / 50) * 50) as amount_ml,
      (((p_now at time zone 'Asia/Ho_Chi_Minh')::date + make_interval(mins => reminder_minute)) at time zone 'Asia/Ho_Chi_Minh') as scheduled_at
    from reminder_times
  ),
  inserted as (
    insert into water_notifications (household_id, user_id, scheduled_at)
    select household_id, user_id, scheduled_at
    from candidates
    where scheduled_at between p_now - interval '2 minutes' and p_now + interval '1 minute'
    on conflict (user_id, scheduled_at) do nothing
    returning id, household_id, user_id, scheduled_at
  )
  select
    inserted.id,
    inserted.household_id,
    inserted.user_id,
    candidates.display_name,
    inserted.scheduled_at,
    candidates.daily_goal_ml,
    candidates.amount_ml
  from inserted
  join candidates using (household_id, user_id, scheduled_at);
$$;
