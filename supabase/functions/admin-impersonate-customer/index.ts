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

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const admin = await requireAdminSession(supabase, req.headers.get('X-Admin-Session'));
    const body = await req.json();
    const userId = String(body?.userId || body?.customerId || body?.customer_id || '').trim();

    if (!isUuid(userId)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid customer ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: customer, error: customerError } = await supabase
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

    const origin = req.headers.get('origin') || Deno.env.get('PROJECT_URL') || '';
    const redirectTo = `${origin}/customer/impersonation-callback?mode=admin_impersonation`;

    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: customer.tu_email,
      options: { redirectTo },
    });

    if (linkError) throw linkError;

    const generatedUserId = linkData?.user?.id;
    const actionLink = linkData?.properties?.action_link;

    if (!actionLink || generatedUserId !== customer.tu_id) {
      throw new Error('Unable to generate customer sign-in link');
    }

    await logAdminAction(supabase, admin.tau_id, 'impersonate_customer', 'customers', {
      customer_id: customer.tu_id,
      customer_email: customer.tu_email,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          customerId: customer.tu_id,
          customerEmail: customer.tu_email,
          actionLink,
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
