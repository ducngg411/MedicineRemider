# Deploy notes

## Frontend

Deploy the Vite app to Vercel or Netlify with these public variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_PUBLIC_VAPID_KEY=
VITE_ENABLE_DEMO=false
```

Static Vite output is served from Vercel's edge/CDN, so it does not sleep like a traditional always-on server.
Use `/health.json` as the production health-check URL if you want uptime monitoring.

Vercel Hobby Cron is not suitable for frequent keep-alive pings because Hobby cron jobs can only run once per day. If you still want external monitoring, point UptimeRobot/cron-job.org/etc. to:

```text
https://YOUR_DOMAIN/health.json
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
supabase functions deploy send-test-notification
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

## Google Auth

To avoid Supabase built-in email rate limits during login, enable Google OAuth:

1. In Supabase Dashboard, open `Authentication > Providers > Google`.
2. Copy the Supabase callback URL shown there. It looks like:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

3. In Google Cloud Console, create an OAuth Client ID for a Web application.
4. Add authorized JavaScript origin:

```text
https://medicine-remider.vercel.app
```

5. Add authorized redirect URI:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

6. Paste the Google Client ID and Client Secret into Supabase's Google provider settings and enable the provider.
7. In Supabase `Authentication > URL Configuration`, allow:

```text
https://medicine-remider.vercel.app
```

Supabase email magic links are still available as fallback, but they can hit `429 Too Many Requests` while testing because Supabase Auth rate-limits OTP email sends.

## One-command deploy helper

Build, push migrations, optionally reset remote app data, deploy Supabase functions, and optionally deploy Vercel:

```powershell
.\scripts\deploy-production.ps1 -ResetData -DeployFrontend
```

If you do not want to deploy frontend from the local CLI:

```powershell
.\scripts\deploy-production.ps1 -ResetData
```

## Reset remote app data

This keeps schema/migrations and `auth.users`, but clears public app data such as households, profiles, treatment courses, medicines, reminders, push subscriptions, and extraction jobs.

```powershell
.\scripts\reset-remote-data.ps1
```

For non-interactive deploy scripts:

```powershell
.\scripts\reset-remote-data.ps1 -Yes
```
