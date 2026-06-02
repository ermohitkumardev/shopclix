WITH old_spin_rewards AS (
  SELECT
    twt_wallet_id,
    COALESCE(SUM(twt_amount), 0) AS amount
  FROM public.tbl_wallet_transactions
  WHERE twt_reference_type = 'spin_wheel_prize'
    AND twt_transaction_type = 'credit'
    AND twt_status = 'completed'
    AND twt_description = 'Spin wheel reward'
  GROUP BY twt_wallet_id
)
UPDATE public.tbl_wallets w
SET tw_reserved_balance = COALESCE(w.tw_reserved_balance, 0) + old_spin_rewards.amount,
    tw_updated_at = now()
FROM old_spin_rewards
WHERE w.tw_id = old_spin_rewards.twt_wallet_id;

UPDATE public.tbl_wallet_transactions
SET twt_description = 'Spin wheel reserved reward for upgrade'
WHERE twt_reference_type = 'spin_wheel_prize'
  AND twt_transaction_type = 'credit'
  AND twt_status = 'completed'
  AND twt_description = 'Spin wheel reward';

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

GRANT EXECUTE ON FUNCTION public.credit_spin_wheel_reward_once(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_spin_wheel() TO authenticated;
