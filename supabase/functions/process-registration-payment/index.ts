import { createClient } from 'jsr:@supabase/supabase-js@2';
import { paymentEmailTemplate, sendSmtpMail } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Session',
};

const sponsorMeetsVerificationRules = (
  sponsorUser: { tu_email_verified?: boolean | null; tu_mobile_verified?: boolean | null }
) => sponsorUser.tu_email_verified === true || sponsorUser.tu_mobile_verified === true;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
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
      return new Response(
        JSON.stringify({ success: false, error: 'Missing admin session token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    const nowIso = new Date().toISOString();

    const { data: adminSession, error: adminError } = await supabase
      .from('tbl_admin_sessions')
      .select(`
        tas_admin_id,
        admin:tas_admin_id(
          tau_id,
          tau_email,
          tau_full_name,
          tau_role,
          tau_is_active
        )
      `)
      .eq('tas_session_token', adminSessionToken)
      .gt('tas_expires_at', nowIso)
      .maybeSingle();

    const adminUser = adminSession?.admin;

    if (adminError || !adminUser || !adminUser.tau_is_active) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid admin session' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { paymentId, manualVerified = false } = await req.json();

    if (!paymentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing payment ID' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: payment, error: paymentError } = await supabase
      .from('tbl_payments')
      .select(`
        *,
        user:tp_user_id(tu_id, tu_email),
        subscription:tp_subscription_id(
          tus_id,
          plan:tus_plan_id(tsp_price, tsp_type, tsp_parent_income)
        )
      `)
      .eq('tp_id', paymentId)
      .single();

    if (paymentError || !payment) {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (payment.tp_payment_status !== 'pending') {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment already processed' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let registrationPlan = payment.subscription?.plan ?? null;

    if (!registrationPlan || registrationPlan.tsp_type !== 'registration') {
      const { data: activeRegistrationPlan, error: planError } = await supabase
        .from('tbl_subscription_plans')
        .select('tsp_id, tsp_price, tsp_type, tsp_parent_income, tsp_duration_days')
        .eq('tsp_type', 'registration')
        .eq('tsp_is_active', true)
        .maybeSingle();

      if (planError || !activeRegistrationPlan) {
        return new Response(
          JSON.stringify({ success: false, error: 'Only registration payments can process referral earnings' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      registrationPlan = activeRegistrationPlan;
    }

    if (registrationPlan.tsp_type !== 'registration') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only registration payments can process referral earnings' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const paymentAmount = Number(payment.tp_amount ?? registrationPlan.tsp_price ?? 0);
    const txHash = String(payment.tp_transaction_id || '').trim();

    if (txHash) {
      const { data: duplicatePayment, error: duplicateError } = await supabase
        .from('tbl_payments')
        .select('tp_id, tp_user_id, tp_payment_status')
        .eq('tp_transaction_id', txHash)
        .neq('tp_id', paymentId)
        .maybeSingle();

      if (duplicateError) {
        throw duplicateError;
      }

      if (duplicatePayment?.tp_id) {
        return new Response(
          JSON.stringify({ success: false, error: 'Transaction hash is already linked to another payment' }),
          {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const amountReceived = Number(payment.tp_amount_received ?? 0);
      const hasSystemVerification = Boolean(payment.tp_block_number) && amountReceived >= paymentAmount;

      if (!hasSystemVerification && manualVerified !== true) {
        return new Response(
          JSON.stringify({ success: false, error: 'Please verify this blockchain transaction before approving it' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const parentIncomeSetting = Number(registrationPlan.tsp_parent_income ?? 0);
    const normalizedParentIncome = Number.isFinite(parentIncomeSetting) && parentIncomeSetting > 0
      ? parentIncomeSetting
      : 0;
    let parentIncomeApplied = 0;
    let adminNetAmount = paymentAmount;
    let sponsorUserId: string | null = null;
    let sponsorSponsorshipNumber: string | null = null;
    let isDefaultParent = false;

    const { data: userProfile } = await supabase
      .from('tbl_user_profiles')
      .select('tup_parent_account, tup_sponsorship_number, tup_username, tup_first_name, tup_last_name')
      .eq('tup_user_id', payment.tp_user_id)
      .maybeSingle();

    const parentAccount = userProfile?.tup_parent_account?.trim();
    const childSponsorshipNumber = userProfile?.tup_sponsorship_number?.trim();
    const childFirstName = userProfile?.tup_first_name?.trim();
    const childLastName = userProfile?.tup_last_name?.trim();
    const childUsername = userProfile?.tup_username?.trim();
    const childEmail = payment.user?.tu_email?.trim();
    const childDisplayName = (
      `${childFirstName || ''} ${childLastName || ''}`.trim() ||
      childUsername ||
      childEmail ||
      childSponsorshipNumber ||
      'unknown account'
    );
    const childCommissionLabel = childSponsorshipNumber
      ? `Sponsorship ${childSponsorshipNumber}`
      : childDisplayName;

    if (parentAccount) {
      const { data: sponsorProfile } = await supabase
        .from('tbl_user_profiles')
        .select('tup_user_id, tup_sponsorship_number, tup_username, tup_is_default_parent')
        .eq('tup_sponsorship_number', parentAccount)
        .maybeSingle();

      if (sponsorProfile) {
        sponsorUserId = sponsorProfile.tup_user_id;
        sponsorSponsorshipNumber = sponsorProfile.tup_sponsorship_number;
        isDefaultParent = sponsorProfile.tup_is_default_parent === true;

        const { data: sponsorUser } = await supabase
          .from('tbl_users')
          .select('tu_is_active, tu_registration_paid, tu_email_verified, tu_mobile_verified')
          .eq('tu_id', sponsorUserId)
          .maybeSingle();

        const sponsorIsVerified = sponsorUser ? sponsorMeetsVerificationRules(sponsorUser) : false;

        if (!sponsorUser?.tu_is_active || !sponsorUser?.tu_registration_paid || !sponsorIsVerified) {
          return new Response(
            JSON.stringify({ success: false, error: 'Parent A/C is not active/verified or registration-paid' }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

      }
    }

    let subscriptionId = payment.tp_subscription_id || null;

    if (subscriptionId) {
      const { error: updateSubscriptionError } = await supabase
        .from('tbl_user_subscriptions')
        .update({ tus_status: 'active' })
        .eq('tus_id', subscriptionId);

      if (updateSubscriptionError) {
        throw updateSubscriptionError;
      }
    } else {
      const rawDurationDays = Number(registrationPlan.tsp_duration_days);
      const startDate = new Date();
      const endDate =
        Number.isFinite(rawDurationDays) && rawDurationDays > 0
          ? new Date(startDate.getTime() + rawDurationDays * 24 * 60 * 60 * 1000)
          : new Date('9999-12-31T23:59:59.999Z');

      const { data: existingSubscription, error: existingSubscriptionError } = await supabase
        .from('tbl_user_subscriptions')
        .select('tus_id')
        .eq('tus_user_id', payment.tp_user_id)
        .eq('tus_plan_id', registrationPlan.tsp_id)
        .maybeSingle();

      if (existingSubscriptionError) {
        throw existingSubscriptionError;
      }

      if (existingSubscription?.tus_id) {
        subscriptionId = existingSubscription.tus_id;
        const { error: updateExistingSubscriptionError } = await supabase
          .from('tbl_user_subscriptions')
          .update({
            tus_status: 'active',
            tus_start_date: startDate.toISOString(),
            tus_end_date: endDate.toISOString(),
            tus_payment_amount: paymentAmount
          })
          .eq('tus_id', subscriptionId);

        if (updateExistingSubscriptionError) {
          throw updateExistingSubscriptionError;
        }
      } else {
        const { data: createdSubscription, error: createSubscriptionError } = await supabase
          .from('tbl_user_subscriptions')
          .insert({
            tus_user_id: payment.tp_user_id,
            tus_plan_id: registrationPlan.tsp_id,
            tus_status: 'active',
            tus_start_date: startDate.toISOString(),
            tus_end_date: endDate.toISOString(),
            tus_payment_amount: paymentAmount
          })
          .select('tus_id')
          .single();

        if (createSubscriptionError) {
          throw createSubscriptionError;
        }

        subscriptionId = createdSubscription?.tus_id || null;
      }
    }

    if (sponsorUserId && normalizedParentIncome > 0) {
      parentIncomeApplied = Math.min(normalizedParentIncome, paymentAmount);
      adminNetAmount = Math.max(0, paymentAmount - parentIncomeApplied);
    }

    const { error: updatePaymentError } = await supabase
      .from('tbl_payments')
      .update({
        tp_subscription_id: subscriptionId,
        tp_payment_status: 'completed',
        tp_verified_at: new Date().toISOString(),
        tp_processed_by_admin_id: adminUser.tau_id,
        tp_processed_by_admin_email: adminUser.tau_email,
        tp_processed_by_admin_name: adminUser.tau_full_name || null,
        tp_gateway_response: {
          ...(payment.tp_gateway_response || {}),
          gross_amount: paymentAmount,
          parent_income: parentIncomeApplied,
          admin_income: adminNetAmount,
          commission_amount: 0,
          commission_percentage: null,
          direct_account_number: null,
          is_default_parent: isDefaultParent,
          parent_account: parentAccount || null,
          parent_user_id: sponsorUserId || null,
          manual_admin_verified: txHash ? manualVerified === true : false,
          manual_admin_verified_at: txHash && manualVerified === true ? new Date().toISOString() : null
        }
      })
      .eq('tp_id', paymentId);

    if (updatePaymentError) {
      throw updatePaymentError;
    }

    await supabase
      .from('tbl_users')
      .update({
        tu_registration_paid: true,
        tu_registration_paid_at: new Date().toISOString()
      })
      .eq('tu_id', payment.tp_user_id);

    if (sponsorUserId) {
        const walletCache = new Map<
          string,
          { walletId: string; baseBalance: number; baseReservedBalance: number; totalBalanceInserted: number; totalReservedInserted: number }
        >();

        const hasActiveUpgrade = async (userId: string) => {
          const now = new Date();
          const { data: subs, error: subsError } = await supabase
            .from('tbl_user_subscriptions')
            .select('tus_end_date, tus_status, plan:tus_plan_id(tsp_type)')
            .eq('tus_user_id', userId)
            .eq('tus_status', 'active')
            .limit(50);

          if (subsError) {
            console.error('Failed to load user subscriptions:', subsError);
            return false;
          }

          return (subs || []).some((row: any) => {
            const planType = String(row?.plan?.tsp_type || '').toLowerCase();
            if (planType !== 'upgrade') return false;
            const endDateRaw = row?.tus_end_date ? new Date(String(row.tus_end_date)) : null;
            if (!endDateRaw) return true;
            return endDateRaw.getTime() > now.getTime();
          });
        };

        const ensureWalletForUser = async (userId: string) => {
          const cached = walletCache.get(userId);
          if (cached) return cached;

          const { data: existingWallet, error: existingError } = await supabase
            .from('tbl_wallets')
            .select('tw_id, tw_balance, tw_reserved_balance')
            .eq('tw_user_id', userId)
            .eq('tw_wallet_type', 'working')
            .maybeSingle();

          if (existingError) {
            console.error('Failed to load wallet:', existingError);
            return null;
          }

          let resolvedWalletId = existingWallet?.tw_id || null;
          let resolvedBalance = parseFloat(String(existingWallet?.tw_balance || 0));
          let resolvedReservedBalance = parseFloat(String((existingWallet as any)?.tw_reserved_balance || 0));

          if (!resolvedWalletId) {
            const { data: createdWallet, error: createError } = await supabase
              .from('tbl_wallets')
              .insert({
                tw_user_id: userId,
                tw_balance: 0,
                tw_reserved_balance: 0,
                tw_currency: 'USDT',
                tw_wallet_type: 'working'
              })
              .select()
              .single();

            if (createError) {
              console.error('Failed to create wallet:', createError);
              return null;
            }

            resolvedWalletId = createdWallet?.tw_id || null;
            resolvedBalance = 0;
            resolvedReservedBalance = 0;
          }

          if (!resolvedWalletId) return null;

          const entry = {
            walletId: resolvedWalletId,
            baseBalance: resolvedBalance,
            baseReservedBalance: resolvedReservedBalance,
            totalBalanceInserted: 0,
            totalReservedInserted: 0
          };
          walletCache.set(userId, entry);
          return entry;
        };

        const insertWalletTxIfMissing = async (
          userId: string,
          referenceType:
            | 'registration_parent_income'
            | 'registration_parent_income_reserved'
            | 'mlm_level_reward'
            | 'mlm_level_reward_reserved',
          amount: number,
          description: string,
          referenceId: string,
          bucket: 'available' | 'reserved' = 'available'
        ) => {
          if (amount <= 0) return 0;

          const walletInfo = await ensureWalletForUser(userId);
          if (!walletInfo) return 0;

          const { count, error: countError } = await supabase
            .from('tbl_wallet_transactions')
            .select('twt_id', { count: 'exact', head: true })
            .eq('twt_user_id', userId)
            .eq('twt_reference_id', referenceId)
            .eq('twt_reference_type', referenceType);

          if (countError) {
            console.error('Failed to check existing wallet transaction:', countError);
            return 0;
          }

          if (count && count > 0) {
            return 0;
          }

          const { error: insertError } = await supabase
            .from('tbl_wallet_transactions')
            .insert({
              twt_wallet_id: walletInfo.walletId,
              twt_user_id: userId,
              twt_transaction_type: 'credit',
              twt_amount: amount,
              twt_description: description,
              twt_status: 'completed',
              twt_reference_type: referenceType,
              twt_reference_id: referenceId
            });

          if (insertError?.code === '23505') {
            return 0;
          }

          if (insertError) {
            console.error('Failed to insert wallet transaction:', insertError);
            return 0;
          }

          if (bucket === 'reserved') {
            walletInfo.totalReservedInserted += amount;
          } else {
            walletInfo.totalBalanceInserted += amount;
          }
          return amount;
        };

        if (parentIncomeApplied > 0 && sponsorUserId) {
          const sponsorUpgraded = await hasActiveUpgrade(sponsorUserId);
          if (sponsorUpgraded) {
            await insertWalletTxIfMissing(
              sponsorUserId,
              'registration_parent_income',
              parentIncomeApplied,
              `Registration commission from ${childCommissionLabel}`,
              paymentId,
              'available'
            );
          } else {
            const availablePortion = Number((parentIncomeApplied * 0.5).toFixed(6));
            const reservedPortion = Number((parentIncomeApplied - availablePortion).toFixed(6));

            await insertWalletTxIfMissing(
              sponsorUserId,
              'registration_parent_income',
              availablePortion,
              `Registration commission from ${childCommissionLabel}`,
              paymentId,
              'available'
            );

            await insertWalletTxIfMissing(
              sponsorUserId,
              'registration_parent_income_reserved',
              reservedPortion,
              `Reserved from registration commission (for future upgrade) from ${childCommissionLabel}`,
              paymentId,
              'reserved'
            );
          }
        }

        if (childSponsorshipNumber) {
          const { data: milestonesData, error: milestonesError } = await supabase
            .from('tbl_mlm_reward_milestones')
            .select('tmm_id, tmm_title, tmm_level1_required, tmm_level2_required, tmm_level3_required, tmm_reward_amount, tmm_is_active')
            .eq('tmm_is_active', true)
            .order('tmm_level1_required', { ascending: true })
            .order('tmm_level2_required', { ascending: true })
            .order('tmm_level3_required', { ascending: true });

          if (milestonesError) {
            console.error('Failed to load MLM reward milestones:', milestonesError);
          }

          const milestones = (milestonesData && milestonesData.length > 0)
            ? milestonesData.map((row) => ({
              id: String(row.tmm_id),
              title: String(row.tmm_title),
              level1: Number(row.tmm_level1_required || 0),
              level2: Number(row.tmm_level2_required || 0),
              level3: Number(row.tmm_level3_required || 0),
              amount: Number(row.tmm_reward_amount || 0)
            }))
              .filter((milestone) => milestone.amount > 0)
            : [];

          if (milestones.length === 0) {
            console.warn('No active MLM reward milestones configured');
          }

          const { data: uplines, error: uplinesError } = await supabase
            .rpc('get_upline_sponsorships', {
              p_child_sponsorship: childSponsorshipNumber,
              p_max_levels: 3
            });

          if (uplinesError) {
            console.error('Failed to load upline sponsors:', uplinesError);
          } else if (milestones.length > 0) {
            for (const upline of uplines || []) {
              const sponsorshipNumber = String(upline.sponsorship_number || '').trim();
              const uplineUserId = String(upline.user_id || '').trim();
              if (!sponsorshipNumber || !uplineUserId) continue;

              const { data: countsRow, error: countsError } = await supabase
                .rpc('upsert_mlm_level_counts', { p_sponsorship_number: sponsorshipNumber })
                .maybeSingle();

              if (countsError) {
                console.error('Failed to update MLM level counts:', countsError);
                continue;
              }

              const level1Count = Number(countsRow?.level1_count || 0);
              const level2Count = Number(countsRow?.level2_count || 0);
              const level3Count = Number(countsRow?.level3_count || 0);

              for (const milestone of milestones) {
                if (
                  level1Count >= milestone.level1 &&
                  level2Count >= milestone.level2 &&
                  level3Count >= milestone.level3
                ) {
                  const uplineUpgraded = await hasActiveUpgrade(uplineUserId);
                  const availableReward = uplineUpgraded
                    ? milestone.amount
                    : Number((milestone.amount * 0.5).toFixed(6));
                  const reservedReward = Number((milestone.amount - availableReward).toFixed(6));

                  await insertWalletTxIfMissing(
                    uplineUserId,
                    'mlm_level_reward',
                    availableReward,
                    milestone.title,
                    milestone.id,
                    'available'
                  );

                  if (reservedReward > 0) {
                    await insertWalletTxIfMissing(
                      uplineUserId,
                      'mlm_level_reward_reserved',
                      reservedReward,
                      `Reserved from ${milestone.title} (for future upgrade)`,
                      milestone.id,
                      'reserved'
                    );
                  }
                }
              }
            }
          }
        }

        for (const [userId, walletInfo] of walletCache.entries()) {
          const totalInserted = walletInfo.totalBalanceInserted + walletInfo.totalReservedInserted;
          if (totalInserted <= 0) continue;
          const newBalance = walletInfo.baseBalance + totalInserted;
          const newReservedBalance = walletInfo.baseReservedBalance + walletInfo.totalReservedInserted;
          const { error: updateWalletError } = await supabase
            .from('tbl_wallets')
            .update({ tw_balance: newBalance, tw_reserved_balance: newReservedBalance })
            .eq('tw_id', walletInfo.walletId);

          if (updateWalletError) {
            console.error('Failed to update sponsor wallet:', updateWalletError);
          }
        }
    }

    await supabase
      .from('tbl_admin_activity_logs')
      .insert({
        taal_admin_id: adminUser.tau_id,
        taal_action: 'approve_registration_payment',
        taal_module: 'payment_management',
        taal_details: {
          payment_id: paymentId,
          user_email: payment.user.tu_email,
          amount: payment.tp_amount,
          commission_paid: 0,
          commission_percentage: null,
          parent_income: parentIncomeApplied,
          admin_income: adminNetAmount,
          direct_account_number: null,
          sponsor_user_id: sponsorUserId,
          sponsor_sponsorship_number: sponsorSponsorshipNumber,
          timestamp: new Date().toISOString(),
        },
      });

    if (childEmail) {
      try {
        await sendSmtpMail({
          to: childEmail,
          subject: 'Your ShopClix registration payment is confirmed',
          html: paymentEmailTemplate({
            name: childDisplayName,
            title: 'Registration payment confirmed',
            subtitle: 'Your registration payment has been approved and your account is active.',
            rows: [
              { label: 'Amount', value: `${paymentAmount} USDT` },
              { label: 'Transaction Hash', value: txHash || 'Manual verification' },
              { label: 'Status', value: 'Completed' },
            ],
          }),
          text: `Your ShopClix registration payment has been confirmed. Amount: ${paymentAmount} USDT. Transaction: ${txHash || 'Manual verification'}.`,
          fromName: 'ShopClix Payments',
        });
      } catch (emailError) {
        console.error('Failed to send manual registration payment confirmation email:', emailError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Payment processed successfully',
        commission_paid: 0,
        commission_percentage: null,
        direct_account_number: null,
        parent_income: parentIncomeApplied
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error processing registration payment:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});
