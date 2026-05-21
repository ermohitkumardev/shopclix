import { createClient } from 'jsr:@supabase/supabase-js@2';
import { logAdminAction } from '../_shared/adminSession.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Session',
};

const getAdminBySession = async (supabase: ReturnType<typeof createClient>, token: string) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('tbl_admin_sessions')
    .select(
      `
      tas_admin_id,
      admin:tas_admin_id(
        tau_id,
        tau_email,
        tau_role,
        tau_is_active
      )
    `
    )
    .eq('tas_session_token', token)
    .gt('tas_expires_at', nowIso)
    .maybeSingle();

  if (error || !data?.admin || !data.admin.tau_is_active) return null;
  return data.admin;
};

const normalizeSettingValue = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return value;
};

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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const adminSessionToken = req.headers.get('X-Admin-Session');
    if (!adminSessionToken) {
      return new Response(JSON.stringify({ success: false, error: 'Missing admin session token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = await getAdminBySession(supabase, adminSessionToken);
    if (!admin) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid admin session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { updates } = await req.json();
    if (!Array.isArray(updates) || updates.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Missing updates' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appliedUpdates = [];

    for (const update of updates) {
      const { key, value, description } = update || {};
      if (!key) continue;
      const settingKey = String(key);
      const { error } = await supabase
        .from('tbl_system_settings')
        .upsert(
          {
            tss_setting_key: settingKey,
            tss_setting_value: normalizeSettingValue(value),
            tss_description: description || `${settingKey.replace(/_/g, ' ')} setting`
          },
          { onConflict: 'tss_setting_key' }
        );

      if (error) {
        throw error;
      }

      appliedUpdates.push(settingKey);
    }

    await logAdminAction(supabase, admin.tau_id, 'upsert_settings', 'settings', {
      updated: appliedUpdates.length,
      keys: appliedUpdates
    });

    return new Response(JSON.stringify({ success: true, data: { updated: appliedUpdates.length } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
