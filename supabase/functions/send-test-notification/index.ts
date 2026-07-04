import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  if (!publicKey || !privateKey) {
    return Response.json({ error: 'Missing VAPID keys' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title : 'Test nh\u1eafc thu\u1ed1c';
  const message = typeof body.body === 'string'
    ? body.body
    : 'N\u1ebfu th\u1ea5y th\u00f4ng b\u00e1o n\u00e0y l\u00e0 push notification ch\u1ea1y ngon r\u1ed3i.';

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('endpoint, subscription')
    .eq('enabled', true);

  if (subscriptionError) {
    return Response.json({ error: subscriptionError.message }, { status: 500 });
  }

  let sent = 0;
  const failures: Array<{ endpoint: string; error: string }> = [];

  await Promise.all(
    (subscriptions ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title,
            body: message,
            tag: `test-${Date.now()}`,
            url: '/',
          }),
        );
        sent += 1;
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : 'Unknown push error';
        failures.push({ endpoint: row.endpoint, error: failureMessage });

        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').update({ enabled: false }).eq('endpoint', row.endpoint);
        }
      }
    }),
  );

  return Response.json({
    subscriptions: subscriptions?.length ?? 0,
    sent,
    failures,
  });
});
