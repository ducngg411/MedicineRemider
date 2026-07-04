begin;

truncate table
  public.water_notifications,
  public.dose_notifications,
  public.dose_events,
  public.extraction_jobs,
  public.push_subscriptions,
  public.doctor_notes,
  public.appointments,
  public.medications,
  public.treatment_courses,
  public.profiles,
  public.households
restart identity cascade;

commit;
