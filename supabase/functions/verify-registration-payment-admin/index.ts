import { createClient } from 'jsr:@supabase/supabase-js@2';
import { logAdminAction } from '../_shared/adminSession.ts';
import { ethers } from 'npm:ethers@6.10.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Admin-Session',
};

const TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const DEFAULT_MAINNET_RPC = 'https://bsc-dataseed1.binance.org/';
const DEFAULT_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';

const MIN_CONFIRMATIONS_DEFAULT = 1;

const normalizeAddress = (address?: string | null) =>
  (address || '').trim().toLowerCase();

const parseSetting = (raw: any) => {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const isLocalSupabaseUrl = (supabaseUrl: string) =>
  supabaseUrl.includes('localhost') || supabaseUrl.includes('127.0.0.1') || supabaseUrl.includes('0.0.0.0');

const sponsorMeetsVerificationRules = (
  sponsorUser: { tu_email_verified?: boolean | null; tu_mobile_verified?: boolean | null }
) => sponsorUser.tu_email_verified === true || sponsorUser.tu_mobile_verified === true;

const ensurePaymentWalletDefault = async (
  supabase: any,
  userId: string,
  walletAddress: string,
  chainId: number
) => {
  const walletAddressLower = normalizeAddress(walletAddress);
  if (!walletAddressLower) return;

  try {
    const now = new Date().toISOString();

    await supabase
      .from('tbl_user_wallet_connections')
      .update({
        tuwc_is_active: false,
        tuwc_is_default: false,
        tuwc_updated_at: now,
      })
      .eq('tuwc_user_id', userId)
      .or('tuwc_is_active.eq.true,tuwc_is_default.eq.true');

    const { data: existingWallet, error: existingWalletError } = await supabase
      .from('tbl_user_wallet_connections')
      .select('tuwc_id')
      .eq('tuwc_user_id', userId)
      .ilike('tuwc_wallet_address', walletAddressLower)
      .maybeSingle();

    if (existingWalletError) throw existingWalletError;

    if (existingWallet?.tuwc_id) {
      const { error: updateError } = await supabase
        .from('tbl_user_wallet_connections')
        .update({
          tuwc_wallet_address: walletAddressLower,
          tuwc_wallet_name: 'Payment Wallet',
          tuwc_wallet_type: 'web3',
          tuwc_chain_id: chainId,
          tuwc_is_active: true,
          tuwc_is_default: true,
          tuwc_last_connected_at: now,
          tuwc_updated_at: now,
        })
        .eq('tuwc_id', existingWallet.tuwc_id)
        .eq('tuwc_user_id', userId);

      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await supabase
      .from('tbl_user_wallet_connections')
      .insert({
        tuwc_user_id: userId,
        tuwc_wallet_address: walletAddressLower,
        tuwc_wallet_name: 'Payment Wallet',
        tuwc_wallet_type: 'web3',
        tuwc_chain_id: chainId,
        tuwc_is_active: true,
        tuwc_is_default: true,
        tuwc_last_connected_at: now,
      });

    if (insertError) throw insertError;
  } catch (error) {
    console.error('Failed to set registration payment wallet as default (admin):', error);
  }
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
      return new Response(JSON.stringify({ success: false, error: 'Invalid admin session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { paymentId } = await req.json();

    if (!paymentId) {
      return new Response(JSON.stringify({ success: false, error: 'Missing payment ID' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: payment, error: paymentError } = await supabase
      .from('tbl_payments')
      .select(`
        *,
        user:tp_user_id(tu_id, tu_email, tu_registration_paid),
        subscription:tp_subscription_id(
          tus_id,
          tus_status,
          plan:tus_plan_id(tsp_id, tsp_price, tsp_type, tsp_parent_income, tsp_duration_days)
        )
      `)
      .eq('tp_id', paymentId)
      .single();

    if (paymentError || !payment) {
      return new Response(JSON.stringify({ success: false, error: 'Payment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payment.tp_payment_status === 'completed') {
      return new Response(JSON.stringify({ success: false, error: 'Payment already processed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const txHash = String(payment.tp_transaction_id || '').trim();
    if (!txHash) {
      return new Response(JSON.stringify({ success: false, error: 'Missing transaction hash on payment' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid transaction hash format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = payment.tp_user_id;

    const { data: existingTxPayment } = await supabase
      .from('tbl_payments')
      .select('tp_id, tp_user_id')
      .eq('tp_transaction_id', txHash)
      .maybeSingle();

    if (existingTxPayment && existingTxPayment.tp_id !== paymentId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Transaction hash already linked to another payment'
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: settingsRows, error: settingsError } = await supabase
      .from('tbl_system_settings')
      .select('tss_setting_key, tss_setting_value')
      .in('tss_setting_key', ['admin_payment_wallet', 'payment_mode', 'usdt_address', 'wallet_unique_per_customer']);

    if (settingsError) {
      throw settingsError;
    }

    const settingsMap: Record<string, any> = {};
    for (const row of settingsRows || []) {
      settingsMap[row.tss_setting_key] = parseSetting(row.tss_setting_value);
    }

    const adminWallet = String(settingsMap.admin_payment_wallet || '').trim();
    const usdtAddress = String(settingsMap.usdt_address || '').trim();
    const paymentMode = settingsMap.payment_mode;
    const walletUniqueSetting = settingsMap.wallet_unique_per_customer;

    if (!ethers.isAddress(adminWallet)) {
      return new Response(JSON.stringify({ success: false, error: 'Admin payment wallet not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ethers.isAddress(usdtAddress)) {
      return new Response(JSON.stringify({ success: false, error: 'USDT contract address not configured' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isMainnet = paymentMode === true || paymentMode === '1' || paymentMode === 1 || paymentMode === 'true';
    const rpcUrl = isMainnet
      ? (Deno.env.get('BSC_MAINNET_RPC_URL') || DEFAULT_MAINNET_RPC)
      : (Deno.env.get('BSC_TESTNET_RPC_URL') || DEFAULT_TESTNET_RPC);

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return new Response(JSON.stringify({ success: false, error: 'Transaction not found on network' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const txFrom = normalizeAddress(tx.from);
    const txTo = normalizeAddress(tx.to);
    const expectedTokenAddress = normalizeAddress(usdtAddress);

    const enforceUniqueWallet = walletUniqueSetting === undefined || walletUniqueSetting === null
      ? !isLocalSupabaseUrl(supabaseUrl)
      : Boolean(walletUniqueSetting);

    if (enforceUniqueWallet && txFrom) {
      const { data: existingOtherUserWallet } = await supabase
        .from('tbl_user_wallet_connections')
        .select('tuwc_id')
        .ilike('tuwc_wallet_address', txFrom)
        .neq('tuwc_user_id', userId)
        .limit(1)
        .maybeSingle();

      if (existingOtherUserWallet?.tuwc_id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'This wallet address is already linked to another customer.'
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (txTo !== expectedTokenAddress) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Transaction does not target the USDT contract'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let registrationPlan = payment.subscription?.plan ?? null;

    if (!registrationPlan || registrationPlan.tsp_type !== 'registration') {
      const { data: planRow, error: planError } = await supabase
        .from('tbl_subscription_plans')
        .select('*')
        .eq('tsp_type', 'registration')
        .eq('tsp_is_active', true)
        .maybeSingle();

      if (planError || !planRow) {
        return new Response(JSON.stringify({ success: false, error: 'No active registration plan found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      registrationPlan = planRow;
    }

    const expectedAmount = Number(registrationPlan.tsp_price || payment.tp_amount || 0);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid registration plan amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parentIncomeSetting = Number(registrationPlan.tsp_parent_income || 0);
    const normalizedParentIncome = Number.isFinite(parentIncomeSetting) && parentIncomeSetting > 0
      ? parentIncomeSetting
      : 0;

    if (payment.tp_wallet_address) {
      const storedWallet = normalizeAddress(payment.tp_wallet_address);
      if (storedWallet && storedWallet !== txFrom) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Wallet mismatch. Transaction does not match recorded wallet.'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      const { data: walletConnection } = await supabase
        .from('tbl_user_wallet_connections')
        .select('tuwc_wallet_address')
        .eq('tuwc_user_id', userId)
        .eq('tuwc_is_active', true)
        .maybeSingle();

      if (!walletConnection?.tuwc_wallet_address) {
        return new Response(JSON.stringify({
          success: false,
          error: 'No active wallet found for user'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const normalized = normalizeAddress(walletConnection.tuwc_wallet_address);
      if (normalized && normalized !== txFrom) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Wallet mismatch. Transaction does not match user wallet.'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return new Response(JSON.stringify({
        success: true,
        status: 'pending',
        message: 'Transaction pending confirmation'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (receipt.status !== 1) {
      await supabase
        .from('tbl_payments')
        .update({
          tp_payment_status: 'failed',
          tp_error_message: 'Transaction failed on-chain',
          tp_block_number: receipt.blockNumber
        })
        .eq('tp_id', paymentId);

      return new Response(JSON.stringify({
        success: false,
        status: 'failed',
        error: 'Transaction failed on-chain'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const latestBlock = await provider.getBlockNumber();
    const confirmations = Math.max(0, latestBlock - receipt.blockNumber + 1);
    const minConfirmations = Number(Deno.env.get('MIN_REG_PAYMENT_CONFIRMATIONS') || MIN_CONFIRMATIONS_DEFAULT);

    if (confirmations < minConfirmations) {
      return new Response(JSON.stringify({
        success: true,
        status: 'pending',
        message: `Waiting for confirmations (${confirmations}/${minConfirmations})`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const iface = new ethers.Interface(TRANSFER_ABI);
    const adminWalletNormalized = normalizeAddress(adminWallet);

    const { data: userProfile } = await supabase
      .from('tbl_user_profiles')
      .select('tup_parent_account, tup_sponsorship_number, tup_username, tup_first_name, tup_last_name')
      .eq('tup_user_id', userId)
      .maybeSingle();

    const { data: userRow } = await supabase
      .from('tbl_users')
      .select('tu_email')
      .eq('tu_id', userId)
      .maybeSingle();

    const parentAccount = userProfile?.tup_parent_account?.trim();
    const childSponsorshipNumber = userProfile?.tup_sponsorship_number?.trim();
    const childFirstName = userProfile?.tup_first_name?.trim();
    const childLastName = userProfile?.tup_last_name?.trim();
    const childUsername = userProfile?.tup_username?.trim();
    const childEmail = userRow?.tu_email?.trim();
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
    let sponsorUserId: string | null = null;
    let sponsorSponsorshipNumber: string | null = null;
    let isDefaultParent = false;

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
          await supabase
            .from('tbl_payments')
            .update({
              tp_payment_status: 'pending',
              tp_error_message: 'Parent A/C is not active/verified or registration-paid'
            })
            .eq('tp_id', paymentId);

          return new Response(JSON.stringify({
            success: false,
            status: 'failed',
            error: 'Parent A/C is not active/verified or registration-paid'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    let adminReceived = 0n;

    for (const log of receipt.logs) {
      if (normalizeAddress(log.address) !== expectedTokenAddress) continue;
      try {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const from = normalizeAddress(parsed.args.from);
        const to = normalizeAddress(parsed.args.to);
        const value = parsed.args.value as bigint;

        if (from !== txFrom) continue;
        if (to === adminWalletNormalized) {
          adminReceived += value;
        }
      } catch {
        // ignore non-matching logs
      }
    }

    const usdtContract = new ethers.Contract(usdtAddress, [
      'function decimals() view returns (uint8)'
    ], provider);

    const decimals = await usdtContract.decimals();
    const expectedUnits = ethers.parseUnits(expectedAmount.toString(), decimals);
    const totalReceived = adminReceived;

    if (adminReceived < expectedUnits) {
      await supabase
        .from('tbl_payments')
        .update({
          tp_payment_status: 'failed',
          tp_error_message: 'Received amount lower than expected',
          tp_block_number: receipt.blockNumber,
          tp_amount_received: Number(ethers.formatUnits(totalReceived, decimals))
        })
        .eq('tp_id', paymentId);

      return new Response(JSON.stringify({
        success: false,
        status: 'failed',
        error: 'Received amount lower than expected'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawDurationDays = registrationPlan.tsp_duration_days;
    const durationDays = Number(rawDurationDays);
    const startDate = new Date();
    const endDate =
      Number.isFinite(durationDays) && durationDays > 0
        ? new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000)
        : new Date('9999-12-31T23:59:59.999Z'); // lifetime

    const { data: existingSubscription } = await supabase
      .from('tbl_user_subscriptions')
      .select('tus_id, tus_status')
      .eq('tus_user_id', userId)
      .eq('tus_plan_id', registrationPlan.tsp_id)
      .maybeSingle();

    let subscriptionId = existingSubscription?.tus_id || null;

    if (existingSubscription) {
      await supabase
        .from('tbl_user_subscriptions')
        .update({
          tus_status: 'active',
          tus_start_date: startDate.toISOString(),
          tus_end_date: endDate.toISOString(),
          tus_payment_amount: expectedAmount
        })
        .eq('tus_id', existingSubscription.tus_id);
    } else {
      const { data: newSubscription } = await supabase
        .from('tbl_user_subscriptions')
        .insert({
          tus_user_id: userId,
          tus_plan_id: registrationPlan.tsp_id,
          tus_status: 'active',
          tus_start_date: startDate.toISOString(),
          tus_end_date: endDate.toISOString(),
          tus_payment_amount: expectedAmount
        })
        .select()
        .single();

      subscriptionId = newSubscription?.tus_id || null;
    }

    // Parent A/C income + MLM level rewards
    const paymentAmount = expectedAmount;
    const parentIncomeApplied = sponsorUserId && normalizedParentIncome > 0
      ? Math.min(normalizedParentIncome, expectedAmount)
      : 0;
    let adminNetAmount = expectedAmount;

    if (parentIncomeApplied > 0) {
      adminNetAmount = Math.max(0, paymentAmount - parentIncomeApplied);
    }

    await supabase
      .from('tbl_payments')
      .update({
        tp_subscription_id: subscriptionId,
        tp_amount: expectedAmount,
        tp_currency: 'USDT',
        tp_payment_method: 'blockchain',
        tp_payment_status: 'completed',
        tp_transaction_id: txHash,
        tp_wallet_address: txFrom,
        tp_to_address: adminWalletNormalized,
        tp_expected_amount: expectedAmount,
        tp_amount_received: Number(ethers.formatUnits(totalReceived, decimals)),
        tp_network: isMainnet ? 'BSC Mainnet' : 'BSC Testnet',
        tp_chain_id: isMainnet ? 56 : 97,
        tp_block_number: receipt.blockNumber,
        tp_confirmations: confirmations,
        tp_verified_at: new Date().toISOString(),
        tp_processed_by_admin_id: adminUser.tau_id,
        tp_processed_by_admin_email: adminUser.tau_email,
        tp_processed_by_admin_name: adminUser.tau_full_name || null,
        tp_gateway_response: {
          blockchain: isMainnet ? 'BSC Mainnet' : 'BSC Testnet',
          usdt_contract: usdtAddress,
          admin_wallet: adminWallet,
          transaction_hash: txHash,
          wallet_address: txFrom,
          block_number: receipt.blockNumber,
          confirmations,
          status: 'success',
          gross_amount: paymentAmount,
          parent_income: parentIncomeApplied,
          admin_income: adminNetAmount,
          commission_amount: 0,
          commission_percentage: null,
          direct_account_number: null,
          is_default_parent: isDefaultParent,
          parent_account: parentAccount || null,
          parent_user_id: sponsorUserId || null
        }
      })
      .eq('tp_id', paymentId);

    await supabase
      .from('tbl_users')
      .update({
        tu_registration_paid: true,
        tu_registration_paid_at: new Date().toISOString()
      })
      .eq('tu_id', userId);

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
          const refId = String(paymentId || sponsorUserId);

          if (sponsorUpgraded) {
            await insertWalletTxIfMissing(
              sponsorUserId,
              'registration_parent_income',
              parentIncomeApplied,
              `Registration commission from ${childCommissionLabel}`,
              refId,
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
              refId,
              'available'
            );

            await insertWalletTxIfMissing(
              sponsorUserId,
              'registration_parent_income_reserved',
              reservedPortion,
              `Reserved from registration commission (for future upgrade) from ${childCommissionLabel}`,
              refId,
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
            console.error('Failed to update wallet balance:', updateWalletError, userId);
          }
        }
    }

    await logAdminAction(supabase, adminUser.tau_id, 'verify_registration_payment', 'payments', {
      payment_id: paymentId,
      tx_hash: txHash,
      amount: expectedAmount,
      confirmations
    });

    await ensurePaymentWalletDefault(supabase, userId, txFrom, isMainnet ? 56 : 97);

    return new Response(JSON.stringify({
      success: true,
      status: 'success',
      txHash,
      amount: expectedAmount,
      network: isMainnet ? 'BSC Mainnet' : 'BSC Testnet',
      confirmations
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error verifying registration payment (admin):', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
