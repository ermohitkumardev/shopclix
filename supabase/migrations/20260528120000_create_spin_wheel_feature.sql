/*
  # Spin wheel campaigns

  Admins can enable a dated spin-wheel campaign and pre-assign prize amounts.
  Customers can claim one spin in their lifetime. The active campaign window
  controls when the feature is visible, but it does not reset prior spins.
*/

CREATE TABLE IF NOT EXISTS public.tbl_spin_wheel_campaigns (
  tswc_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tswc_name text NOT NULL DEFAULT 'Launch Spin Wheel',
  tswc_is_enabled boolean NOT NULL DEFAULT false,
  tswc_start_at timestamptz,
  tswc_end_at timestamptz,
  tswc_created_by uuid REFERENCES public.tbl_admin_users(tau_id) ON DELETE SET NULL,
  tswc_created_at timestamptz NOT NULL DEFAULT now(),
  tswc_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tbl_spin_wheel_campaigns_date_check
    CHECK (tswc_end_at IS NULL OR tswc_start_at IS NULL OR tswc_end_at > tswc_start_at)
);

CREATE TABLE IF NOT EXISTS public.tbl_spin_wheel_assignments (
  tswa_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tswa_campaign_id uuid NOT NULL REFERENCES public.tbl_spin_wheel_campaigns(tswc_id) ON DELETE CASCADE,
  tswa_user_id uuid NOT NULL REFERENCES public.tbl_users(tu_id) ON DELETE CASCADE,
  tswa_prize_amount numeric(18,8) NOT NULL DEFAULT 0,
  tswa_assigned_by uuid REFERENCES public.tbl_admin_users(tau_id) ON DELETE SET NULL,
  tswa_created_at timestamptz NOT NULL DEFAULT now(),
  tswa_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tbl_spin_wheel_assignments_amount_check CHECK (tswa_prize_amount >= 0),
  CONSTRAINT tbl_spin_wheel_assignments_user_campaign_unique UNIQUE (tswa_campaign_id, tswa_user_id)
);

CREATE TABLE IF NOT EXISTS public.tbl_spin_wheel_spins (
  tsws_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tsws_campaign_id uuid NOT NULL REFERENCES public.tbl_spin_wheel_campaigns(tswc_id) ON DELETE RESTRICT,
  tsws_user_id uuid NOT NULL REFERENCES public.tbl_users(tu_id) ON DELETE CASCADE,
  tsws_prize_amount numeric(18,8) NOT NULL DEFAULT 0,
  tsws_outcome text NOT NULL DEFAULT 'better_luck',
  tsws_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tbl_spin_wheel_spins_amount_check CHECK (tsws_prize_amount >= 0),
  CONSTRAINT tbl_spin_wheel_spins_outcome_check CHECK (tsws_outcome IN ('prize', 'better_luck')),
  CONSTRAINT tbl_spin_wheel_spins_user_lifetime_unique UNIQUE (tsws_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tbl_spin_wheel_campaigns_active
  ON public.tbl_spin_wheel_campaigns (tswc_is_enabled, tswc_start_at, tswc_end_at);

CREATE INDEX IF NOT EXISTS idx_tbl_spin_wheel_assignments_user
  ON public.tbl_spin_wheel_assignments (tswa_user_id);

CREATE INDEX IF NOT EXISTS idx_tbl_spin_wheel_spins_user
  ON public.tbl_spin_wheel_spins (tsws_user_id);

ALTER TABLE public.tbl_spin_wheel_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tbl_spin_wheel_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tbl_spin_wheel_spins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_full_spin_campaigns" ON public.tbl_spin_wheel_campaigns;
CREATE POLICY "admin_full_spin_campaigns"
  ON public.tbl_spin_wheel_campaigns
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR public.is_sub_admin())
  WITH CHECK (public.is_super_admin() OR public.is_sub_admin());

DROP POLICY IF EXISTS "admin_full_spin_assignments" ON public.tbl_spin_wheel_assignments;
CREATE POLICY "admin_full_spin_assignments"
  ON public.tbl_spin_wheel_assignments
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR public.is_sub_admin())
  WITH CHECK (public.is_super_admin() OR public.is_sub_admin());

DROP POLICY IF EXISTS "users_read_own_spin_assignments" ON public.tbl_spin_wheel_assignments;
CREATE POLICY "users_read_own_spin_assignments"
  ON public.tbl_spin_wheel_assignments
  FOR SELECT
  TO authenticated
  USING (tswa_user_id = auth.uid());

DROP POLICY IF EXISTS "admin_full_spin_spins" ON public.tbl_spin_wheel_spins;
CREATE POLICY "admin_full_spin_spins"
  ON public.tbl_spin_wheel_spins
  FOR ALL
  TO authenticated
  USING (public.is_super_admin() OR public.is_sub_admin())
  WITH CHECK (public.is_super_admin() OR public.is_sub_admin());

DROP POLICY IF EXISTS "users_read_own_spin_spins" ON public.tbl_spin_wheel_spins;
CREATE POLICY "users_read_own_spin_spins"
  ON public.tbl_spin_wheel_spins
  FOR SELECT
  TO authenticated
  USING (tsws_user_id = auth.uid());

ALTER TABLE public.tbl_wallet_transactions
  DROP CONSTRAINT IF EXISTS tbl_wallet_transactions_twt_reference_type_check;

ALTER TABLE public.tbl_wallet_transactions
  ADD CONSTRAINT tbl_wallet_transactions_twt_reference_type_check
  CHECK (
    twt_reference_type IN (
      'task_reward',
      'coupon_share',
      'social_share',
      'admin_credit',
      'withdrawal',
      'deposit',
      'transfer',
      'registration_parent_income',
      'registration_parent_income_reserved',
      'upgrade_from_reserved',
      'registration_payment',
      'mlm_level_reward_5_15_30',
      'mlm_level_reward_15_45_90',
      'mlm_level_reward',
      'mlm_level_reward_reserved',
      'spin_wheel_prize'
    )
  );

CREATE OR REPLACE FUNCTION public.get_active_spin_wheel_campaign()
RETURNS public.tbl_spin_wheel_campaigns
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.*
  FROM public.tbl_spin_wheel_campaigns c
  WHERE c.tswc_is_enabled = true
    AND (c.tswc_start_at IS NULL OR c.tswc_start_at <= now())
    AND (c.tswc_end_at IS NULL OR c.tswc_end_at >= now())
    AND COALESCE((
      SELECT lower(trim(both '"' from tss_setting_value::text))
      FROM public.tbl_system_settings
      WHERE tss_setting_key = 'launch_phase'
      LIMIT 1
    ), 'prelaunch') = 'prelaunch'
  ORDER BY c.tswc_created_at DESC
  LIMIT 1;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_spin_wheel_prize_transaction
  ON public.tbl_wallet_transactions (twt_reference_type, twt_reference_id)
  WHERE twt_reference_type = 'spin_wheel_prize'
    AND twt_reference_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.credit_spin_wheel_reward_once(p_spin_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spin public.tbl_spin_wheel_spins%ROWTYPE;
  v_wallet_id uuid;
  v_new_balance numeric(18,8) := 0;
BEGIN
  SELECT *
  INTO v_spin
  FROM public.tbl_spin_wheel_spins
  WHERE tsws_id = p_spin_id
  FOR UPDATE;

  IF v_spin.tsws_id IS NULL OR COALESCE(v_spin.tsws_prize_amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tbl_wallet_transactions
    WHERE twt_reference_type = 'spin_wheel_prize'
      AND twt_reference_id = v_spin.tsws_id
  ) THEN
    SELECT COALESCE(tw_balance, 0)
    INTO v_new_balance
    FROM public.tbl_wallets
    WHERE tw_user_id = v_spin.tsws_user_id
      AND tw_currency = 'USDT'
      AND tw_wallet_type = 'working'
    LIMIT 1;

    RETURN COALESCE(v_new_balance, 0);
  END IF;

  INSERT INTO public.tbl_wallets (
    tw_user_id,
    tw_balance,
    tw_reserved_balance,
    tw_currency,
    tw_wallet_type,
    tw_is_active,
    tw_created_at,
    tw_updated_at
  )
  VALUES (
    v_spin.tsws_user_id,
    0.00000000,
    0.00000000,
    'USDT',
    'working',
    true,
    now(),
    now()
  )
  ON CONFLICT (tw_user_id, tw_currency, tw_wallet_type)
  DO UPDATE SET tw_updated_at = now()
  RETURNING tw_id INTO v_wallet_id;

  UPDATE public.tbl_wallets
  SET tw_balance = COALESCE(tw_balance, 0) + v_spin.tsws_prize_amount,
      tw_reserved_balance = COALESCE(tw_reserved_balance, 0) + v_spin.tsws_prize_amount,
      tw_updated_at = now()
  WHERE tw_id = v_wallet_id
  RETURNING tw_balance INTO v_new_balance;

  INSERT INTO public.tbl_wallet_transactions (
    twt_wallet_id,
    twt_user_id,
    twt_transaction_type,
    twt_amount,
    twt_currency,
    twt_description,
    twt_reference_type,
    twt_reference_id,
    twt_status,
    twt_created_at
  )
  VALUES (
    v_wallet_id,
    v_spin.tsws_user_id,
    'credit',
    v_spin.tsws_prize_amount,
    'USDT',
    'Spin wheel reserved reward for upgrade',
    'spin_wheel_prize',
    v_spin.tsws_id,
    'completed',
    now()
  );

  RETURN COALESCE(v_new_balance, 0);
EXCEPTION
  WHEN unique_violation THEN
    SELECT COALESCE(tw_balance, 0)
    INTO v_new_balance
    FROM public.tbl_wallets
    WHERE tw_user_id = v_spin.tsws_user_id
      AND tw_currency = 'USDT'
      AND tw_wallet_type = 'working'
    LIMIT 1;

    RETURN COALESCE(v_new_balance, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_get_spin_wheel_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_campaign public.tbl_spin_wheel_campaigns%ROWTYPE;
  v_spin public.tbl_spin_wheel_spins%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('active', false, 'hasSpun', false, 'message', 'Login required.');
  END IF;

  SELECT * INTO v_campaign FROM public.get_active_spin_wheel_campaign();

  SELECT *
  INTO v_spin
  FROM public.tbl_spin_wheel_spins
  WHERE tsws_user_id = v_user_id
  ORDER BY tsws_created_at DESC
  LIMIT 1;

  IF v_spin.tsws_id IS NOT NULL THEN
    PERFORM public.credit_spin_wheel_reward_once(v_spin.tsws_id);

    RETURN jsonb_build_object(
      'active', v_campaign.tswc_id IS NOT NULL,
      'hasSpun', true,
      'eligible', true,
      'campaignId', v_campaign.tswc_id,
      'campaignName', v_campaign.tswc_name,
      'spunAt', v_spin.tsws_created_at,
      'prizeAmount', v_spin.tsws_prize_amount,
      'outcome', v_spin.tsws_outcome,
      'message', 'You have already used your spin.'
    );
  END IF;

  IF v_campaign.tswc_id IS NULL THEN
    RETURN jsonb_build_object('active', false, 'hasSpun', false, 'message', 'Spin wheel is not available right now.');
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'hasSpun', false,
    'eligible', true,
    'campaignId', v_campaign.tswc_id,
    'campaignName', v_campaign.tswc_name,
    'message', 'Spin available.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_spin_wheel()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_campaign public.tbl_spin_wheel_campaigns%ROWTYPE;
  v_existing_spin public.tbl_spin_wheel_spins%ROWTYPE;
  v_prize_amount numeric(18,8) := 0;
  v_outcome text := 'better_luck';
  v_spin_id uuid;
  v_new_balance numeric(18,8) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required.';
  END IF;

  SELECT * INTO v_existing_spin
  FROM public.tbl_spin_wheel_spins
  WHERE tsws_user_id = v_user_id
  LIMIT 1;

  IF v_existing_spin.tsws_id IS NOT NULL THEN
    v_new_balance := COALESCE(public.credit_spin_wheel_reward_once(v_existing_spin.tsws_id), 0);

    RETURN jsonb_build_object(
      'success', false,
      'hasSpun', true,
      'prizeAmount', v_existing_spin.tsws_prize_amount,
      'outcome', v_existing_spin.tsws_outcome,
      'newBalance', v_new_balance,
      'message', 'You have already used your spin.'
    );
  END IF;

  SELECT * INTO v_campaign FROM public.get_active_spin_wheel_campaign();

  IF v_campaign.tswc_id IS NULL THEN
    RAISE EXCEPTION 'Spin wheel is not available right now.';
  END IF;

  SELECT COALESCE(a.tswa_prize_amount, 0)
  INTO v_prize_amount
  FROM public.tbl_spin_wheel_assignments a
  WHERE a.tswa_campaign_id = v_campaign.tswc_id
    AND a.tswa_user_id = v_user_id
  LIMIT 1;

  v_prize_amount := COALESCE(v_prize_amount, 0);
  v_outcome := CASE WHEN v_prize_amount > 0 THEN 'prize' ELSE 'better_luck' END;

  INSERT INTO public.tbl_spin_wheel_spins (
    tsws_campaign_id,
    tsws_user_id,
    tsws_prize_amount,
    tsws_outcome
  )
  VALUES (
    v_campaign.tswc_id,
    v_user_id,
    v_prize_amount,
    v_outcome
  )
  RETURNING tsws_id INTO v_spin_id;

  IF v_prize_amount > 0 THEN
    v_new_balance := COALESCE(public.credit_spin_wheel_reward_once(v_spin_id), 0);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'hasSpun', true,
    'campaignId', v_campaign.tswc_id,
    'campaignName', v_campaign.tswc_name,
    'spinId', v_spin_id,
    'prizeAmount', v_prize_amount,
    'outcome', v_outcome,
    'newBalance', v_new_balance,
    'message', CASE
      WHEN v_prize_amount > 0 THEN 'Congratulations! Your spin reward has been added to your reserved wallet for upgrade.'
      ELSE 'Better luck next time.'
    END
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'hasSpun', true,
      'prizeAmount', 0,
      'outcome', 'better_luck',
      'message', 'You have already used your spin.'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_spin_wheel_campaign() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.credit_spin_wheel_reward_once(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_get_spin_wheel_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_spin_wheel() TO authenticated;
