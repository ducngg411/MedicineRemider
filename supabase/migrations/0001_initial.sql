create extension if not exists "pgcrypto";

create type dose_status as enum ('due', 'taken', 'skipped', 'snoozed', 'missed');
create type medication_source as enum ('manual', 'gemini', 'demo');
create type note_category as enum ('warning', 'care', 'recheck', 'other');

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nha minh',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  display_name text,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

create table medications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  patient_name text not null,
  name text not null,
  generic_name text,
  strength text,
  instructions text not null,
  form text,
  source medication_source not null default 'manual',
  start_date date not null,
  end_date date,
  schedule_times time[] not null default '{}',
  duration_days integer,
  quantity numeric,
  remaining numeric,
  doctor_notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  title text not null,
  clinic text,
  appointment_at timestamptz not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table doctor_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  note text not null,
  category note_category not null default 'other',
  pinned boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table dose_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete cascade,
  scheduled_at timestamptz not null,
  status dose_status not null default 'due',
  acted_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (medication_id, scheduled_at)
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'draft',
  raw_result jsonb,
  draft jsonb,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index medications_household_idx on medications (household_id);
create index dose_events_due_idx on dose_events (scheduled_at, status);
create index push_subscriptions_household_idx on push_subscriptions (household_id) where enabled;

create or replace function current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from profiles where id = auth.uid()
$$;

create or replace function ensure_user_profile()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_household uuid;
  created_household uuid;
begin
  select household_id into existing_household from profiles where id = auth.uid();
  if existing_household is not null then
    return existing_household;
  end if;

  insert into households (created_by)
  values (auth.uid())
  returning id into created_household;

  insert into profiles (id, household_id, display_name)
  values (auth.uid(), created_household, coalesce(auth.jwt() ->> 'email', 'Người dùng'));

  return created_household;
end;
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
    select
      m.household_id,
      m.id as medication_id,
      m.name as medication_name,
      m.patient_name,
      (((p_now at time zone 'Asia/Ho_Chi_Minh')::date + schedule_time) at time zone 'Asia/Ho_Chi_Minh') as scheduled_at
    from medications m
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

alter table households enable row level security;
alter table profiles enable row level security;
alter table medications enable row level security;
alter table appointments enable row level security;
alter table doctor_notes enable row level security;
alter table dose_events enable row level security;
alter table push_subscriptions enable row level security;
alter table extraction_jobs enable row level security;

create policy "household members read household"
on households for select
using (id = current_household_id());

create policy "users read own profile"
on profiles for select
using (id = auth.uid() or household_id = current_household_id());

create policy "users update own profile"
on profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "members manage medications"
on medications for all
using (household_id = current_household_id())
with check (household_id = current_household_id());

create policy "members manage appointments"
on appointments for all
using (household_id = current_household_id())
with check (household_id = current_household_id());

create policy "members manage doctor notes"
on doctor_notes for all
using (household_id = current_household_id())
with check (household_id = current_household_id());

create policy "members manage dose events"
on dose_events for all
using (household_id = current_household_id())
with check (household_id = current_household_id());

create policy "members manage push subscriptions"
on push_subscriptions for all
using (household_id = current_household_id() and user_id = auth.uid())
with check (household_id = current_household_id() and user_id = auth.uid());

create policy "members manage extraction jobs"
on extraction_jobs for all
using (household_id = current_household_id())
with check (household_id = current_household_id());
