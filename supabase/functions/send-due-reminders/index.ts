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

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const { data: reminderNotifications, error: reminderError } = await supabase.rpc('claim_reminder_notifications');
  if (reminderError) return Response.json({ error: reminderError.message }, { status: 500 });
  const { data: waterNotifications, error: waterError } = await supabase.rpc('claim_water_reminders');
  if (waterError) return Response.json({ error: waterError.message }, { status: 500 });

  let sent = 0;
  const failures: Array<{ endpoint: string; error: string }> = [];

  for (const reminder of reminderNotifications ?? []) {
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, subscription')
      .eq('household_id', reminder.household_id)
      .eq('enabled', true);

    if (subscriptionError) {
      failures.push({ endpoint: 'query', error: subscriptionError.message });
      continue;
    }

    await Promise.all(
      (subscriptions ?? []).map(async (row) => {
        try {
          await webpush.sendNotification(
            row.subscription,
            JSON.stringify({
              ...buildNotificationPayload(reminder),
              tag: `dose-${reminder.notification_id}`,
              url: '/',
            }),
          );
          sent += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown push error';
          failures.push({ endpoint: row.endpoint, error: message });

          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').update({ enabled: false }).eq('endpoint', row.endpoint);
          }
        }
      }),
    );
  }

  for (const reminder of waterNotifications ?? []) {
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from('push_subscriptions')
      .select('endpoint, subscription')
      .eq('user_id', reminder.user_id)
      .eq('enabled', true);

    if (subscriptionError) {
      failures.push({ endpoint: 'query', error: subscriptionError.message });
      continue;
    }

    await Promise.all(
      (subscriptions ?? []).map(async (row) => {
        try {
          await webpush.sendNotification(
            row.subscription,
            JSON.stringify({
              ...buildWaterNotificationPayload(reminder),
              tag: `water-${reminder.notification_id}`,
              url: '/',
            }),
          );
          sent += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown push error';
          failures.push({ endpoint: row.endpoint, error: message });

          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from('push_subscriptions').update({ enabled: false }).eq('endpoint', row.endpoint);
          }
        }
      }),
    );
  }

  return Response.json({
    claimed: (reminderNotifications?.length ?? 0) + (waterNotifications?.length ?? 0),
    medicineClaimed: reminderNotifications?.length ?? 0,
    waterClaimed: waterNotifications?.length ?? 0,
    sent,
    failures,
  });
});

function buildNotificationPayload(reminder: {
  notification_kind: 'soon' | 'due' | 'late' | 'missed';
  patient_name: string;
  medication_name: string;
  scheduled_at: string;
}) {
  const time = formatTimeVN(reminder.scheduled_at);
  const namePrefix = getNamePrefix(reminder.patient_name);
  const medicine = reminder.medication_name;

  if (reminder.notification_kind === 'soon') {
    return {
      title: 'S\u1eafp \u0111\u1ebfn gi\u1edd u\u1ed1ng thu\u1ed1c',
      body: `${namePrefix}s\u1eafp \u0111\u1ebfn gi\u1edd u\u1ed1ng ${medicine} l\u00fac ${time}.`,
    };
  }

  if (reminder.notification_kind === 'late') {
    return {
      title: 'Thu\u1ed1c \u0111ang tr\u1ec5',
      body: `${namePrefix}${medicine} \u0111\u00e3 tr\u1ec5 kho\u1ea3ng 30 ph\u00fat.`,
    };
  }

  if (reminder.notification_kind === 'missed') {
    return {
      title: 'C\u00f3 li\u1ec1u b\u1ecb b\u1ecf l\u1ee1',
      body: `${namePrefix}${medicine} \u0111\u00e3 qu\u00e1 gi\u1edd. M\u1edf app \u0111\u1ec3 x\u1eed l\u00fd.`,
    };
  }

  return {
    title: '\u0110\u1ebfn gi\u1edd u\u1ed1ng thu\u1ed1c',
    body: `${namePrefix}\u0111\u1ebfn gi\u1edd u\u1ed1ng ${medicine} l\u00fac ${time}.`,
  };
}

function buildWaterNotificationPayload(reminder: {
  display_name?: string;
  scheduled_at: string;
  amount_ml: number;
}) {
  const amount = Math.round(Number(reminder.amount_ml) || 250);
  const namePrefix = getNamePrefix(reminder.display_name);
  const messages = [
    `${namePrefix}u\u1ed1ng ch\u00fat n\u01b0\u1edbc nha. Kho\u1ea3ng ${amount}ml l\u00e0 \u0111\u1eb9p.`,
    `${namePrefix}ngh\u1ec9 30 gi\u00e2y u\u1ed1ng n\u01b0\u1edbc \u0111i n\u00e8.`,
    `${namePrefix}l\u00e0m v\u00e0i ng\u1ee5m n\u01b0\u1edbc cho t\u1ec9nh t\u00e1o n\u00e0o.`,
    `${namePrefix}refill nh\u1eb9 t\u00ed n\u01b0\u1edbc nha.`,
    `${namePrefix}u\u1ed1ng n\u01b0\u1edbc c\u00e1i r\u1ed3i l\u00e0m ti\u1ebfp.`,
  ];
  const hour = new Date(reminder.scheduled_at).getHours();

  return {
    title: 'Nh\u1eafc u\u1ed1ng n\u01b0\u1edbc',
    body: messages[Math.abs(hour) % messages.length],
  };
}

function getNamePrefix(value?: string) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.toLowerCase() === 'b\u1ea1n') return '';
  return `${name} \u01a1i, `;
}

function formatTimeVN(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value));
}
