update medications m
set course_id = c.id
from treatment_courses c
where m.course_id is null
  and m.household_id = c.household_id
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = m.household_id
    order by
      case when c2.status = 'active' then 0 else 1 end,
      c2.started_at desc,
      c2.created_at desc
    limit 1
  );

update appointments a
set course_id = c.id
from treatment_courses c
where a.course_id is null
  and a.household_id = c.household_id
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = a.household_id
    order by
      case when c2.status = 'active' then 0 else 1 end,
      c2.started_at desc,
      c2.created_at desc
    limit 1
  );

update doctor_notes n
set course_id = c.id
from treatment_courses c
where n.course_id is null
  and n.household_id = c.household_id
  and c.id = (
    select c2.id
    from treatment_courses c2
    where c2.household_id = n.household_id
    order by
      case when c2.status = 'active' then 0 else 1 end,
      c2.started_at desc,
      c2.created_at desc
    limit 1
  );
