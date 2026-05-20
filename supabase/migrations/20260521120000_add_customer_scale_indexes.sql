/*
  # Customer-scale query indexes

  The admin customer list and referral network RPCs are the customer-table
  hot paths. These indexes support million-row customer/profile tables by
  covering:
    - newest-first admin pagination
    - status/filter combinations used by admin_get_customers
    - ILIKE search across customer/profile fields
    - normalized sponsorship/parent lookups used by referral traversal
*/

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tbl_users_customer_created_at
  ON public.tbl_users (tu_user_type, tu_created_at DESC, tu_id);

CREATE INDEX IF NOT EXISTS idx_tbl_users_customer_status_created_at
  ON public.tbl_users (
    tu_user_type,
    tu_is_active,
    tu_registration_paid,
    tu_mobile_verified,
    tu_email_verified,
    tu_is_dummy,
    tu_created_at DESC,
    tu_id
  );

CREATE INDEX IF NOT EXISTS idx_tbl_users_email_trgm
  ON public.tbl_users USING gin (tu_email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_user_id
  ON public.tbl_user_profiles (tup_user_id);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_sponsorship_number
  ON public.tbl_user_profiles (tup_sponsorship_number);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_parent_account
  ON public.tbl_user_profiles (tup_parent_account);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_sponsorship_norm
  ON public.tbl_user_profiles ((
    CASE
      WHEN lower(btrim(tup_sponsorship_number)) LIKE 'sp%' THEN substr(lower(btrim(tup_sponsorship_number)), 3)
      ELSE lower(btrim(tup_sponsorship_number))
    END
  ));

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_parent_norm
  ON public.tbl_user_profiles ((
    CASE
      WHEN lower(btrim(tup_parent_account)) LIKE 'sp%' THEN substr(lower(btrim(tup_parent_account)), 3)
      ELSE lower(btrim(tup_parent_account))
    END
  ));

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_sponsorship_lower_trim
  ON public.tbl_user_profiles ((lower(btrim(tup_sponsorship_number))));

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_parent_lower_trim
  ON public.tbl_user_profiles ((lower(btrim(tup_parent_account))));

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_first_name_trgm
  ON public.tbl_user_profiles USING gin (tup_first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_last_name_trgm
  ON public.tbl_user_profiles USING gin (tup_last_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_username_trgm
  ON public.tbl_user_profiles USING gin (tup_username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tbl_user_profiles_sponsorship_trgm
  ON public.tbl_user_profiles USING gin (tup_sponsorship_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tbl_mlm_level_counts_level1_updated
  ON public.tbl_mlm_level_counts (tmlc_level1_count DESC, tmlc_updated_at DESC, tmlc_user_id);

CREATE INDEX IF NOT EXISTS idx_tbl_mlm_level_counts_sponsorship_trgm
  ON public.tbl_mlm_level_counts USING gin (tmlc_sponsorship_number gin_trgm_ops);

COMMENT ON INDEX public.idx_tbl_users_customer_created_at IS
  'Supports newest-first admin customer pagination.';

COMMENT ON INDEX public.idx_tbl_users_customer_status_created_at IS
  'Supports admin customer status, verification, dummy-account filters, and newest-first ordering.';

COMMENT ON INDEX public.idx_tbl_user_profiles_sponsorship_norm IS
  'Supports normalized sponsorship comparisons that strip optional SP prefix.';

COMMENT ON INDEX public.idx_tbl_user_profiles_parent_norm IS
  'Supports normalized parent-account comparisons that strip optional SP prefix.';

COMMENT ON INDEX public.idx_tbl_mlm_level_counts_level1_updated IS
  'Supports Level Counts admin ordering by level-1 count and update time.';
