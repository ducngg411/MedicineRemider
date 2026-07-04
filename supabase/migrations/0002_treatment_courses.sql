create table if not exists treatment_courses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  started_at date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  ended_at date,
  status text not null default 'active' check (status in ('active', 'archived')),
  source text not null default 'mixed',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table medications add column if not exists course_id uuid references treatment_courses(id) on delete set null;
alter table appointments add column if not exists course_id uuid references treatment_courses(id) on delete set null;
alter table doctor_notes add column if not exists course_id uuid references treatment_courses(id) on delete set null;

create index if not exists treatment_courses_household_idx on treatment_courses (household_id, status, started_at desc);
create index if not exists medications_course_idx on medications (course_id);
create index if not exists appointments_course_idx on appointments (course_id);
create index if not exists doctor_notes_course_idx on doctor_notes (course_id);

insert into treatment_courses (household_id, name, started_at, status, source, created_at)
select
  h.id,
  'Đợt hiện tại',
  coalesce(min(m.start_date), (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  'active',
  'mixed',
  now()
from households h
left join medications m on m.household_id = h.id
where not exists (
  select 1 from treatment_courses existing where existing.household_id = h.id
)
group by h.id;

update medications m
set course_id = c.id
from treatment_courses c
where m.household_id = c.household_id
  and m.course_id is null
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = m.household_id
    order by c2.created_at asc
    limit 1
  );

update appointments a
set course_id = c.id
from treatment_courses c
where a.household_id = c.household_id
  and a.course_id is null
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = a.household_id
    order by c2.created_at asc
    limit 1
  );

update doctor_notes n
set course_id = c.id
from treatment_courses c
where n.household_id = c.household_id
  and n.course_id is null
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = n.household_id
    order by c2.created_at asc
    limit 1
  );

alter table treatment_courses enable row level security;

create policy "members manage treatment courses"
on treatment_courses for all
using (household_id = current_household_id())
with check (household_id = current_household_id());

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
    select
      m.household_id,
      m.id as medication_id,
      m.name as medication_name,
      m.patient_name,
      (((p_now at time zone 'Asia/Ho_Chi_Minh')::date + schedule_time) at time zone 'Asia/Ho_Chi_Minh') as scheduled_at
    from medications m
    join treatment_courses c on c.id = m.course_id and c.status = 'active'
    cross join unnest(m.schedule_times) as schedule_time
    where m.start_date <= (p_now at time zone 'Asia/Ho_Chi_Minh')::date
      and (m.end_date is null or m.end_date >= (p_now at time zone 'Asia/Ho_Chi_Minh')::date)
  ),
  inserted as (
    insert into dose_events (household_id, medication_id, scheduled_at, status)
    select household_id, medication_id, scheduled_at, 'due'
    from due
    where scheduled_at between p_now - interval '5 minutes' and p_now + interval '1 minute'
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
