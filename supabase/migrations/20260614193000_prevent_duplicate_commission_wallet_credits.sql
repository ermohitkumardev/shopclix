-- Prevent duplicate direct/reserved commission wallet credits.
--
-- Root cause guarded here:
-- payment verification can be retried or processed by more than one path. A
-- SELECT-then-INSERT check is not enough for money movement because two
-- requests can pass the check before either insert commits.

DO $$
DECLARE
  v_duplicate_count integer;
  v_adjusted_wallet_count integer;
BEGIN
  WITH duplicate_commissions AS (
    SELECT
      tx.twt_id,
      tx.twt_wallet_id,
      tx.twt_reference_type,
      tx.twt_amount,
      row_number() OVER (
        PARTITION BY tx.twt_user_id, tx.twt_reference_type, tx.twt_reference_id
        ORDER BY tx.twt_created_at ASC, tx.twt_id ASC
      ) AS rn
    FROM public.tbl_wallet_transactions tx
    WHERE tx.twt_status = 'completed'
      AND tx.twt_reference_id IS NOT NULL
      AND tx.twt_reference_type IN (
        'registration_parent_income',
        'registration_parent_income_reserved',
        'mlm_level_reward',
        'mlm_level_reward_reserved'
      )
  ),
  duplicate_totals AS (
    SELECT
      twt_wallet_id,
      SUM(twt_amount) AS balance_amount,
      SUM(twt_amount) FILTER (
        WHERE twt_reference_type IN (
          'registration_parent_income_reserved',
          'mlm_level_reward_reserved'
        )
      ) AS reserved_amount
    FROM duplicate_commissions
    WHERE rn > 1
    GROUP BY twt_wallet_id
  ),
  adjusted_wallets AS (
    UPDATE public.tbl_wallets wallet
    SET
      tw_balance = GREATEST(0, COALESCE(wallet.tw_balance, 0) - COALESCE(duplicate_totals.balance_amount, 0)),
      tw_reserved_balance = GREATEST(0, COALESCE(wallet.tw_reserved_balance, 0) - COALESCE(duplicate_totals.reserved_amount, 0)),
      tw_updated_at = now()
    FROM duplicate_totals
    WHERE wallet.tw_id = duplicate_totals.twt_wallet_id
    RETURNING wallet.tw_id
  ),
  cancelled_duplicates AS (
    UPDATE public.tbl_wallet_transactions tx
    SET
      twt_status = 'cancelled',
      twt_description = CONCAT(tx.twt_description, ' (duplicate commission cancelled)')
    FROM duplicate_commissions duplicate
    WHERE tx.twt_id = duplicate.twt_id
      AND duplicate.rn > 1
    RETURNING tx.twt_id
  )
  SELECT
    (SELECT COUNT(*) FROM cancelled_duplicates),
    (SELECT COUNT(*) FROM adjusted_wallets)
  INTO v_duplicate_count, v_adjusted_wallet_count;

  RAISE NOTICE 'Cancelled duplicate commission wallet transactions: %, adjusted wallets: %',
    v_duplicate_count,
    v_adjusted_wallet_count;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_completed_commission_wallet_credit
  ON public.tbl_wallet_transactions (twt_user_id, twt_reference_type, twt_reference_id)
  WHERE twt_status = 'completed'
    AND twt_reference_id IS NOT NULL
    AND twt_reference_type IN (
      'registration_parent_income',
      'registration_parent_income_reserved',
      'mlm_level_reward',
      'mlm_level_reward_reserved'
    );
