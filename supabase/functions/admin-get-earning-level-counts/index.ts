import { createClient } from 'jsr:@supabase/supabase-js@2';

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

    const body = await req.json().catch(() => ({}));
    const recompute = body?.recompute === true;
    if (recompute) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Full recompute must run as a controlled database maintenance job, not from the admin UI.',
        }),
        {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const searchTerm = typeof body?.searchTerm === 'string' ? body.searchTerm.trim() : '';
    const offset = Math.max(0, Number.isFinite(Number(body?.offset)) ? Math.floor(Number(body.offset)) : 0);
    const limitRaw = Number.isFinite(Number(body?.limit)) ? Math.floor(Number(body.limit)) : 25;
    const limit = Math.min(100, Math.max(1, limitRaw));
    const extraLevelRaw = body?.extraLevel;
    const extraLevel = Number.isFinite(Number(extraLevelRaw)) ? Number(extraLevelRaw) : null;
    const requestedExtraLevel = extraLevel && extraLevel >= 1 && extraLevel <= 50 ? extraLevel : null;
    const dummyFilterRaw = String(body?.dummyFilter ?? body?.accountScope ?? 'all').trim().toLowerCase();
    const dummyFilter = ['all', 'real', 'dummy'].includes(dummyFilterRaw) ? dummyFilterRaw : 'all';

    let query = supabase
      .from('tbl_mlm_level_counts')
      .select('*, tbl_users!inner(tu_is_dummy)', { count: 'exact' })
      .order('tmlc_level1_count', { ascending: false })
      .order('tmlc_updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (dummyFilter === 'real') query = query.eq('tbl_users.tu_is_dummy', false);
    if (dummyFilter === 'dummy') query = query.eq('tbl_users.tu_is_dummy', true);

    if (searchTerm) {
      query = query.ilike('tmlc_sponsorship_number', `%${searchTerm}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const totalCount = count || 0;
    const rows = (data || []) as any[];

    // Attach user display names (from profiles) to show in admin list.
    const userIdsForNames = rows
      .map((row) => String(row?.tmlc_user_id || '').trim())
      .filter(Boolean);

    const userNameById = new Map<string, string>();
    if (userIdsForNames.length > 0) {
      try {
        const { data: profiles, error: profilesError } = await supabase
          .from('tbl_user_profiles')
          .select('tup_user_id, tup_first_name, tup_last_name, tup_username')
          .in('tup_user_id', userIdsForNames)
          .limit(10000);

        if (!profilesError) {
          for (const p of profiles || []) {
            const id = String((p as any)?.tup_user_id || '').trim();
            if (!id) continue;
            const first = String((p as any)?.tup_first_name || '').trim();
            const last = String((p as any)?.tup_last_name || '').trim();
            const username = String((p as any)?.tup_username || '').trim();
            const fullName = `${first} ${last}`.trim();
            const display = fullName || username || '—';
            userNameById.set(id, display);
          }
        }
      } catch {
        // If profile access fails for any reason, keep names empty.
      }
    }

    // Eligibility helpers for Award button:
    // - show only when sponsor meets at least one active milestone
    // - and at least one eligible milestone has not been paid to this sponsor yet
    type Milestone = {
      id: string;
      level1: number;
      level2: number;
      level3: number;
      amount: number;
    };

    let milestones: Milestone[] = [];
    let milestonesAvailable = true;
    try {
      const { data: milestonesData, error: milestonesError } = await supabase
        .from('tbl_mlm_reward_milestones')
        .select('tmm_id, tmm_level1_required, tmm_level2_required, tmm_level3_required, tmm_reward_amount, tmm_is_active')
        .eq('tmm_is_active', true);

      if (milestonesError) {
        const message = String((milestonesError as any)?.message || '').toLowerCase();
        if (message.includes('schema cache') || message.includes('could not find') || message.includes('relation')) {
          milestonesAvailable = false;
        } else {
          throw milestonesError;
        }
      } else {
        milestones = ((milestonesData || []) as any[])
          .map((row) => ({
            id: String(row?.tmm_id || '').trim(),
            level1: Number(row?.tmm_level1_required || 0),
            level2: Number(row?.tmm_level2_required || 0),
            level3: Number(row?.tmm_level3_required || 0),
            amount: Number(row?.tmm_reward_amount || 0),
          }))
          .filter((m) => m.id && m.amount > 0);
      }
    } catch {
      // Be conservative: if we can't read milestones, hide Award button.
      milestonesAvailable = false;
      milestones = [];
    }

    const userIds = rows
      .map((row) => String(row?.tmlc_user_id || '').trim())
      .filter(Boolean);

    let rewardCheckOk = true;
    const rewardedUserIds = new Set<string>();
    const paidMilestoneIdsByUser = new Map<string, Set<string>>();
    if (userIds.length > 0) {
      try {
        const { data: rewardTx, error: rewardTxError } = await supabase
          .from('tbl_wallet_transactions')
          .select('twt_user_id, twt_reference_id')
          .in('twt_user_id', userIds)
          .eq('twt_reference_type', 'mlm_level_reward')
          .limit(10000);

        if (rewardTxError) {
          rewardCheckOk = false;
        } else {
          for (const item of rewardTx || []) {
            const id = String((item as any)?.twt_user_id || '').trim();
            const milestoneId = String((item as any)?.twt_reference_id || '').trim();
            if (!id) continue;
            rewardedUserIds.add(id);
            if (!milestoneId) continue;
            const existing = paidMilestoneIdsByUser.get(id) ?? new Set<string>();
            existing.add(milestoneId);
            paidMilestoneIdsByUser.set(id, existing);
          }
        }
      } catch {
        rewardCheckOk = false;
      }
    }

    let extraCountsMap = new Map<string, number>();
    let extraCountsAvailable = true;
    if (requestedExtraLevel && requestedExtraLevel > 3 && rows.length > 0) {
      const sponsorships = rows
        .map((row) => String(row?.tmlc_sponsorship_number || '').trim())
        .filter(Boolean);

      if (sponsorships.length > 0) {
        const { data: extraCounts, error: extraCountsError } = await supabase.rpc(
          'get_mlm_level_counts_for_sponsors_at_level',
          { p_level: requestedExtraLevel, p_sponsorship_numbers: sponsorships }
        );
        if (extraCountsError) {
          const message = String((extraCountsError as any)?.message || '').toLowerCase();
          // If the DB migration wasn't applied yet (or PostgREST schema cache hasn't refreshed),
          // don't fail the whole endpoint; return base counts and let the UI show a warning.
          if (message.includes('schema cache') || message.includes('could not find the function')) {
            extraCountsAvailable = false;
          } else {
            throw extraCountsError;
          }
        }
        for (const item of extraCounts || []) {
          const key = String((item as any)?.sponsorship_number || '').trim().toLowerCase();
          if (!key) continue;
          extraCountsMap.set(key, Number((item as any)?.level_count || 0));
        }
      }
    }

    const withTotal = rows.map((row: any) => {
      const { tbl_users: _user, ...restRow } = row || {};
      const sponsorship = String(row?.tmlc_sponsorship_number || '').trim();
      const sponsorshipKey = sponsorship.toLowerCase();
      const extraLevelCount = requestedExtraLevel
        ? (requestedExtraLevel === 1
          ? Number(row?.tmlc_level1_count || 0)
          : requestedExtraLevel === 2
            ? Number(row?.tmlc_level2_count || 0)
            : requestedExtraLevel === 3
              ? Number(row?.tmlc_level3_count || 0)
              : (extraCountsAvailable ? (extraCountsMap.get(sponsorshipKey) ?? 0) : null))
        : null;

      const level1 = Number(row?.tmlc_level1_count || 0);
      const level2 = Number(row?.tmlc_level2_count || 0);
      const level3 = Number(row?.tmlc_level3_count || 0);
      const userId = String(row?.tmlc_user_id || '').trim();
      const userName = userId ? (userNameById.get(userId) ?? '—') : '—';
      const hasAnyMlmReward = rewardCheckOk ? rewardedUserIds.has(userId) : true;
      const paidMilestoneIds = rewardCheckOk ? (paidMilestoneIdsByUser.get(userId) ?? new Set<string>()) : new Set<string>();
      const eligibleMilestones = milestonesAvailable
        ? milestones.filter((m) => level1 >= m.level1 && level2 >= m.level2 && level3 >= m.level3 && m.amount > 0)
        : [];
      const meetsAnyMilestone = milestonesAvailable
        ? eligibleMilestones.length > 0
        : false;
      const unpaidEligibleMilestoneCount = rewardCheckOk
        ? eligibleMilestones.filter((m) => !paidMilestoneIds.has(m.id)).length
        : 0;

      return {
        ...restRow,
        total_count: totalCount,
        extra_level: requestedExtraLevel,
        extra_level_count: extraLevelCount,
        user_name: userName,
        meets_any_milestone: meetsAnyMilestone,
        has_any_mlm_reward: hasAnyMlmReward,
        eligible_milestone_count: eligibleMilestones.length,
        unpaid_eligible_milestone_count: unpaidEligibleMilestoneCount,
      };
    });

    return new Response(JSON.stringify({ success: true, data: withTotal }), {
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
