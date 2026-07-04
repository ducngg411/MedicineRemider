create table if not exists dose_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete cascade,
  scheduled_at timestamptz not null,
  kind text not null check (kind in ('soon', 'due', 'late', 'missed')),
  created_at timestamptz not null default now(),
  unique (medication_id, scheduled_at, kind)
);

create index if not exists dose_notifications_household_idx on dose_notifications (household_id, created_at desc);
create index if not exists dose_notifications_lookup_idx on dose_notifications (medication_id, scheduled_at, kind);

alter table dose_notifications enable row level security;

create policy "members read dose notifications"
on dose_notifications for select
using (household_id = current_household_id());

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
      m.patient_name,
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

create or replace function claim_due_doses(p_now timestamptz default now())
returns table (
  event_id uuid,
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
  with due as (
    select *
    from claim_reminder_notifications(p_now)
    where notification_kind = 'due'
  ),
  inserted as (
    insert into dose_events (household_id, medication_id, scheduled_at, status)
    select household_id, medication_id, scheduled_at, 'due'
    from due
    on conflict (medication_id, scheduled_at) do nothing
    returning id, household_id, medication_id, scheduled_at
  )
  select
    inserted.id,
    inserted.household_id,
    inserted.medication_id,
    due.medication_name,
    due.patient_name,
    inserted.scheduled_at
  from inserted
  join due using (household_id, medication_id, scheduled_at);
$$;
