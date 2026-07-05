update medications
set
  end_date = null,
  duration_days = null
where end_date is not null
  and end_date < start_date;

update medications
set duration_days = null
where duration_days is not null
  and duration_days <= 0;
