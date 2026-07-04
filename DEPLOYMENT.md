# Deploy notes

## Frontend

Deploy the Vite app to Vercel or Netlify with these public variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_PUBLIC_VAPID_KEY=
VITE_ENABLE_DEMO=false
```

## Supabase

1. Create a Supabase Free project.
2. Run `supabase db push`.
3. Deploy functions:

```bash
supabase functions deploy extract-prescription
supabase functions deploy register-push-subscription
supabase functions deploy send-due-reminders
supabase functions deploy cleanup-temp-images
```

4. Set function secrets:

```bash
supabase secrets set GEMINI_API_KEY=
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase secrets set VAPID_PUBLIC_KEY=
supabase secrets set VAPID_PRIVATE_KEY=
supabase secrets set VAPID_SUBJECT=mailto:you@example.com
supabase secrets set CRON_SECRET=replace-with-a-long-random-string
```

5. Schedule cron jobs in SQL:

`send-due-reminders` handles both medicine reminders and water reminders. Keep it running every minute.

```sql
select cron.schedule(
  'send-due-reminders-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-due-reminders',
    headers := '{"Authorization":"Bearer replace-with-a-long-random-string"}'::jsonb
  );
  $$
);

select cron.schedule(
  'cleanup-temp-extractions-daily',
  '0 18 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/cleanup-temp-images',
    headers := '{"Authorization":"Bearer replace-with-a-long-random-string"}'::jsonb
  );
  $$
);
```

Với iPhone Web Push, người dùng cần mở site qua HTTPS, thêm PWA vào Màn hình chính, rồi bấm nút bật thông báo trong app.
