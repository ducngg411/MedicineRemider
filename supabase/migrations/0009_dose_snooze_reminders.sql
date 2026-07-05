alter table dose_events
  add column if not exists snoozed_until timestamptz;

create index if not exists dose_events_snoozed_until_idx
on dose_events (snoozed_until)
where status = 'snoozed' and snoozed_until is not null;

alter table dose_notifications
  drop constraint if exists dose_notifications_kind_check;

alter table dose_notifications
  add constraint dose_notifications_kind_check
  check (kind in ('soon', 'due', 'late', 'missed', 'snoozed'));

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
  active_events as (
    select e.*
    from dose_events e
    join doses
      on doses.medication_id = e.medication_id
      and doses.scheduled_at = e.scheduled_at
  ),
  eligible as (
    select doses.*
    from doses
    where not exists (
      select 1
      from active_events e
      where e.medication_id = doses.medication_id
        and e.scheduled_at = doses.scheduled_at
        and e.status in ('taken', 'taken_late', 'skipped')
    )
  ),
  regular_eligible as (
    select eligible.*
    from eligible
    where not exists (
      select 1
      from active_events e
      where e.medication_id = eligible.medication_id
        and e.scheduled_at = eligible.scheduled_at
        and e.status = 'snoozed'
    )
  ),
  snoozed_eligible as (
    select
      eligible.household_id,
      eligible.medication_id,
      eligible.medication_name,
      eligible.patient_name,
      e.snoozed_until as scheduled_at
    from eligible
    join active_events e
      on e.medication_id = eligible.medication_id
      and e.scheduled_at = eligible.scheduled_at
      and e.status = 'snoozed'
      and e.snoozed_until is not null
  ),
  notification_candidates as (
    select *, 'soon'::text as kind
    from regular_eligible
    where scheduled_at - interval '15 minutes' between p_now - interval '2 minutes' and p_now + interval '1 minute'

    union all

    select *, 'due'::text as kind
    from regular_eligible
    where scheduled_at between p_now - interval '5 minutes' and p_now + interval '1 minute'

    union all

    select *, 'late'::text as kind
    from regular_eligible
    where scheduled_at + interval '30 minutes' between p_now - interval '2 minutes' and p_now + interval '1 minute'

    union all

    select *, 'missed'::text as kind
    from regular_eligible
    where scheduled_at + interval '4 hours' between p_now - interval '2 minutes' and p_now + interval '1 minute'

    union all

    select *, 'snoozed'::text as kind
    from snoozed_eligible
    where scheduled_at between p_now - interval '2 minutes' and p_now + interval '1 minute'
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
