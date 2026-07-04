import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) throw userError ?? new Error('Unauthenticated');

    const { data: householdId, error: householdError } = await supabase.rpc('ensure_user_profile');
    if (householdError) throw householdError;

    const body = await req.json();
    const endpoint = body.subscription?.endpoint;
    if (!endpoint) throw new Error('Missing push endpoint');

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        household_id: householdId,
        user_id: userResult.user.id,
        endpoint,
        subscription: body.subscription,
        user_agent: body.userAgent ?? null,
        enabled: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

    if (error) throw error;
    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: corsHeaders },
    );
  }
});
