alter table profiles
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists notification_enabled boolean not null default false,
  add column if not exists water_reminder jsonb not null default '{
    "enabled": false,
    "autoCalculateGoal": false,
    "dailyGoalMl": 2000,
    "startTime": "08:00",
    "endTime": "21:00",
    "intervalMinutes": 120
  }'::jsonb;

create table if not exists water_notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, scheduled_at)
);

create index if not exists water_notifications_due_idx
on water_notifications (scheduled_at);

alter table water_notifications enable row level security;

drop policy if exists "users read own water notifications" on water_notifications;
create policy "users read own water notifications"
on water_notifications for select
using (user_id = auth.uid() or household_id = current_household_id());

create or replace function claim_water_reminders(p_now timestamptz default now())
returns table (
  notification_id uuid,
  household_id uuid,
  user_id uuid,
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
    inserted.scheduled_at,
    candidates.daily_goal_ml,
    candidates.amount_ml
  from inserted
  join candidates using (household_id, user_id, scheduled_at);
$$;
