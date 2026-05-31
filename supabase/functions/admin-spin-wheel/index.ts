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

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getCampaign = async (supabase: ReturnType<typeof createClient>) => {
  const { data: existing, error } = await supabase
    .from('tbl_spin_wheel_campaigns')
    .select('*')
    .order('tswc_created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return existing;
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
      return jsonResponse({ success: false, error: 'Missing admin session token' }, 401);
    }

    const admin = await getAdminBySession(supabase, adminSessionToken);
    if (!admin) {
      return jsonResponse({ success: false, error: 'Invalid admin session' }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'get');

    if (action === 'get') {
      const campaign = await getCampaign(supabase);
      const campaignId = campaign?.tswc_id;

      const [{ data: assignments, error: assignmentsError }, { data: spins, error: spinsError }] = await Promise.all([
        campaignId
          ? supabase
              .from('tbl_spin_wheel_assignments')
              .select(
                `
                tswa_id,
                tswa_campaign_id,
                tswa_user_id,
                tswa_prize_amount,
                tswa_created_at,
                tbl_users:tswa_user_id (
                  tu_email,
                  tbl_user_profiles (
                    tup_first_name,
                    tup_last_name
                  )
                )
              `
              )
              .eq('tswa_campaign_id', campaignId)
              .order('tswa_created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
        campaignId
          ? supabase
              .from('tbl_spin_wheel_spins')
              .select(
                `
                tsws_id,
                tsws_user_id,
                tsws_prize_amount,
                tsws_outcome,
                tsws_created_at,
                tbl_users:tsws_user_id (
                  tu_email,
                  tbl_user_profiles (
                    tup_first_name,
                    tup_last_name
                  )
                )
              `
              )
              .eq('tsws_campaign_id', campaignId)
              .order('tsws_created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (assignmentsError) throw assignmentsError;
      if (spinsError) throw spinsError;

      return jsonResponse({ success: true, data: { campaign, assignments: assignments || [], spins: spins || [] } });
    }

    if (action === 'save_campaign') {
      const name = String(body.name || 'Launch Spin Wheel').trim() || 'Launch Spin Wheel';
      const isEnabled = Boolean(body.isEnabled);
      const startAt = body.startAt ? new Date(String(body.startAt)).toISOString() : null;
      const endAt = body.endAt ? new Date(String(body.endAt)).toISOString() : null;

      if (startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) {
        return jsonResponse({ success: false, error: 'End date must be after start date.' }, 400);
      }

      const current = await getCampaign(supabase);
      const payload = {
        tswc_name: name,
        tswc_is_enabled: isEnabled,
        tswc_start_at: startAt,
        tswc_end_at: endAt,
        tswc_updated_at: new Date().toISOString(),
      };

      const query = current?.tswc_id
        ? supabase
            .from('tbl_spin_wheel_campaigns')
            .update(payload)
            .eq('tswc_id', current.tswc_id)
            .select('*')
            .single()
        : supabase
            .from('tbl_spin_wheel_campaigns')
            .insert({ ...payload, tswc_created_by: admin.tau_id })
            .select('*')
            .single();

      const { data, error } = await query;
      if (error) throw error;

      await logAdminAction(supabase, admin.tau_id, 'spin_wheel_campaign_save', 'settings', {
        campaign_id: data.tswc_id,
        is_enabled: data.tswc_is_enabled,
      });

      return jsonResponse({ success: true, data });
    }

    if (action === 'assign_prize') {
      const campaign = await getCampaign(supabase);
      if (!campaign?.tswc_id) {
        return jsonResponse({ success: false, error: 'Create the spin wheel campaign settings first.' }, 400);
      }

      const userId = String(body.userId || '').trim();
      const prizeAmount = Number(body.prizeAmount || 0);
      if (!userId) return jsonResponse({ success: false, error: 'Customer is required.' }, 400);
      if (!Number.isFinite(prizeAmount) || prizeAmount < 0) {
        return jsonResponse({ success: false, error: 'Prize amount must be zero or greater.' }, 400);
      }

      const { data, error } = await supabase
        .from('tbl_spin_wheel_assignments')
        .upsert(
          {
            tswa_campaign_id: campaign.tswc_id,
            tswa_user_id: userId,
            tswa_prize_amount: prizeAmount,
            tswa_assigned_by: admin.tau_id,
            tswa_updated_at: new Date().toISOString(),
          },
          { onConflict: 'tswa_campaign_id,tswa_user_id' }
        )
        .select('*')
        .single();

      if (error) throw error;

      await logAdminAction(supabase, admin.tau_id, 'spin_wheel_prize_assign', 'settings', {
        campaign_id: campaign.tswc_id,
        user_id: userId,
        prize_amount: prizeAmount,
      });

      return jsonResponse({ success: true, data });
    }

    if (action === 'delete_assignment') {
      const assignmentId = String(body.assignmentId || '').trim();
      if (!assignmentId) return jsonResponse({ success: false, error: 'Assignment ID is required.' }, 400);

      const { error } = await supabase
        .from('tbl_spin_wheel_assignments')
        .delete()
        .eq('tswa_id', assignmentId);

      if (error) throw error;

      await logAdminAction(supabase, admin.tau_id, 'spin_wheel_prize_delete', 'settings', {
        assignment_id: assignmentId,
      });

      return jsonResponse({ success: true, data: { assignmentId } });
    }

    return jsonResponse({ success: false, error: 'Unknown action.' }, 400);
  } catch (error: any) {
    return jsonResponse({ success: false, error: error?.message || 'Failed' }, 500);
  }
});
