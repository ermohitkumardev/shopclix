import { createClient } from 'jsr:@supabase/supabase-js@2';
import { logAdminAction, requireAdminSession } from '../_shared/adminSession.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Session',
};

const isUuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables');
    }

    // Service-role client for admin operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const admin = await requireAdminSession(adminClient, req.headers.get('X-Admin-Session'));
    const body = await req.json();
    const userId = String(body?.userId || body?.customerId || body?.customer_id || '').trim();

    if (!isUuid(userId)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid customer ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: customer, error: customerError } = await adminClient
      .from('tbl_users')
      .select('tu_id, tu_email, tu_user_type, tu_is_active')
      .eq('tu_id', userId)
      .eq('tu_user_type', 'customer')
      .maybeSingle();

    if (customerError) throw customerError;

    if (!customer) {
      return new Response(JSON.stringify({ success: false, error: 'Customer not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!customer.tu_is_active) {
      return new Response(JSON.stringify({ success: false, error: 'Customer account is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 1: Generate magic link server-side to get the hashed_token
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.tu_email,
    });

    if (linkError) throw linkError;

    const generatedUserId = linkData?.user?.id;
    const tokenHash = linkData?.properties?.hashed_token;

    if (!tokenHash || generatedUserId !== customer.tu_id) {
      throw new Error('Unable to generate customer sign-in token');
    }

    // Step 2: Verify the token server-side using an anon client with implicit flow.
    // This avoids the PKCE requirement that would fail on the browser side since
    // there is no matching code verifier for a server-generated token.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'implicit',
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });

    const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });

    if (verifyError) throw verifyError;

    const session = verifyData?.session;
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Failed to create customer session');
    }

    await logAdminAction(adminClient, admin.tau_id, 'impersonate_customer', 'customers', {
      customer_id: customer.tu_id,
      customer_email: customer.tu_email,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          customerId: customer.tu_id,
          customerEmail: customer.tu_email,
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          expiresIn: session.expires_in,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    const message = error?.message || 'Failed to create customer login session';
    const status = message.includes('admin session') ? 401 : 500;

    return new Response(JSON.stringify({ success: false, error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
