/*
  # Referral closure table for million-user scale

  Recursive CTEs are fine while the tree is small, but they become risky for
  large customer networks because each page/count request has to walk the tree.
  This migration stores ancestor -> descendant paths once, then serves network
  pages and level counts from indexed rows.
*/

CREATE TABLE IF NOT EXISTS public.tbl_referral_closure (
  trc_ancestor_user_id uuid NOT NULL REFERENCES public.tbl_users(tu_id) ON DELETE CASCADE,
  trc_descendant_user_id uuid NOT NULL REFERENCES public.tbl_users(tu_id) ON DELETE CASCADE,
  trc_depth integer NOT NULL CHECK (trc_depth >= 1),
  trc_created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trc_ancestor_user_id, trc_descendant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tbl_referral_closure_ancestor_depth
  ON public.tbl_referral_closure (trc_ancestor_user_id, trc_depth, trc_descendant_user_id);

CREATE INDEX IF NOT EXISTS idx_tbl_referral_closure_descendant_depth
  ON public.tbl_referral_closure (trc_descendant_user_id, trc_depth, trc_ancestor_user_id);

CREATE INDEX IF NOT EXISTS idx_tbl_referral_closure_depth_ancestor
  ON public.tbl_referral_closure (trc_depth, trc_ancestor_user_id, trc_descendant_user_id);

ALTER TABLE public.tbl_referral_closure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.tbl_referral_closure;
CREATE POLICY "service_role_full_access" ON public.tbl_referral_closure
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_referral_closure" ON public.tbl_referral_closure;
CREATE POLICY "authenticated_read_referral_closure" ON public.tbl_referral_closure
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.tbl_referral_closure TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON public.tbl_referral_closure TO service_role;

CREATE OR REPLACE FUNCTION public.normalize_sponsorship_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
SELECT NULLIF(
  CASE
    WHEN lower(btrim(COALESCE(p_value, ''))) LIKE 'sp%' THEN substr(lower(btrim(COALESCE(p_value, ''))), 3)
    ELSE lower(btrim(COALESCE(p_value, '')))
  END,
  ''
)
$$;

CREATE OR REPLACE FUNCTION public.refresh_referral_closure_for_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_user_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT parent_profile.tup_user_id
  INTO v_parent_user_id
  FROM public.tbl_user_profiles child_profile
  JOIN public.tbl_user_profiles parent_profile
    ON public.normalize_sponsorship_key(parent_profile.tup_sponsorship_number)
     = public.normalize_sponsorship_key(child_profile.tup_parent_account)
  WHERE child_profile.tup_user_id = p_user_id
  LIMIT 1;

  DELETE FROM public.tbl_referral_closure
  WHERE trc_descendant_user_id = p_user_id;

  IF v_parent_user_id IS NULL OR v_parent_user_id = p_user_id THEN
    RETURN;
  END IF;

  INSERT INTO public.tbl_referral_closure (
    trc_ancestor_user_id,
    trc_descendant_user_id,
    trc_depth
  )
  VALUES (v_parent_user_id, p_user_id, 1)
  ON CONFLICT (trc_ancestor_user_id, trc_descendant_user_id) DO UPDATE
  SET trc_depth = EXCLUDED.trc_depth;

  INSERT INTO public.tbl_referral_closure (
    trc_ancestor_user_id,
    trc_descendant_user_id,
    trc_depth
  )
  SELECT
    parent_path.trc_ancestor_user_id,
    p_user_id,
    parent_path.trc_depth + 1
  FROM public.tbl_referral_closure parent_path
  WHERE parent_path.trc_descendant_user_id = v_parent_user_id
  ON CONFLICT (trc_ancestor_user_id, trc_descendant_user_id) DO UPDATE
  SET trc_depth = EXCLUDED.trc_depth;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_referral_closure()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  TRUNCATE public.tbl_referral_closure;

  INSERT INTO public.tbl_referral_closure (
    trc_ancestor_user_id,
    trc_descendant_user_id,
    trc_depth
  )
  WITH RECURSIVE edges AS (
    SELECT
      parent_profile.tup_user_id AS parent_user_id,
      child_profile.tup_user_id AS child_user_id
    FROM public.tbl_user_profiles child_profile
    JOIN public.tbl_user_profiles parent_profile
      ON public.normalize_sponsorship_key(parent_profile.tup_sponsorship_number)
       = public.normalize_sponsorship_key(child_profile.tup_parent_account)
    WHERE child_profile.tup_user_id IS NOT NULL
      AND parent_profile.tup_user_id IS NOT NULL
      AND child_profile.tup_user_id <> parent_profile.tup_user_id
  ),
  paths AS (
    SELECT
      e.parent_user_id AS ancestor_user_id,
      e.child_user_id AS descendant_user_id,
      1 AS depth,
      ARRAY[e.parent_user_id, e.child_user_id] AS visited
    FROM edges e

    UNION ALL

    SELECT
      p.ancestor_user_id,
      e.child_user_id,
      p.depth + 1,
      p.visited || e.child_user_id
    FROM paths p
    JOIN edges e ON e.parent_user_id = p.descendant_user_id
    WHERE p.depth < 100
      AND NOT e.child_user_id = ANY(p.visited)
  )
  SELECT
    paths.ancestor_user_id,
    paths.descendant_user_id,
    MIN(paths.depth) AS depth
  FROM paths
  GROUP BY paths.ancestor_user_id, paths.descendant_user_id
  ON CONFLICT (trc_ancestor_user_id, trc_descendant_user_id) DO UPDATE
  SET trc_depth = EXCLUDED.trc_depth;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_referral_closure_profile_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_referral_closure_for_user(NEW.tup_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_referral_closure_profile ON public.tbl_user_profiles;
CREATE TRIGGER trigger_sync_referral_closure_profile
  AFTER INSERT OR UPDATE OF tup_user_id, tup_parent_account, tup_sponsorship_number
  ON public.tbl_user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_referral_closure_profile_trigger();

CREATE OR REPLACE FUNCTION public.upsert_mlm_level_counts(
  p_sponsorship_number text
) RETURNS TABLE(
  user_id uuid,
  level1_count integer,
  level2_count integer,
  level3_count integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
WITH sponsor AS (
  SELECT
    up.tup_user_id AS user_id,
    btrim(up.tup_sponsorship_number) AS sponsorship_number
  FROM public.tbl_user_profiles up
  WHERE public.normalize_sponsorship_key(up.tup_sponsorship_number)
    = public.normalize_sponsorship_key(p_sponsorship_number)
  LIMIT 1
),
counts AS (
  SELECT
    sponsor.user_id,
    sponsor.sponsorship_number,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 1
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int AS level1_count,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 2
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int AS level2_count,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 3
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int AS level3_count
  FROM sponsor
  LEFT JOIN public.tbl_referral_closure c
    ON c.trc_ancestor_user_id = sponsor.user_id
   AND c.trc_depth BETWEEN 1 AND 3
  LEFT JOIN public.tbl_users u
    ON u.tu_id = c.trc_descendant_user_id
  WHERE sponsor.user_id IS NOT NULL
  GROUP BY sponsor.user_id, sponsor.sponsorship_number
),
upserted AS (
  INSERT INTO public.tbl_mlm_level_counts (
    tmlc_user_id,
    tmlc_sponsorship_number,
    tmlc_level1_count,
    tmlc_level2_count,
    tmlc_level3_count,
    tmlc_updated_at
  )
  SELECT
    c.user_id,
    c.sponsorship_number,
    c.level1_count,
    c.level2_count,
    c.level3_count,
    now()
  FROM counts c
  ON CONFLICT (tmlc_user_id) DO UPDATE
  SET
    tmlc_sponsorship_number = EXCLUDED.tmlc_sponsorship_number,
    tmlc_level1_count = EXCLUDED.tmlc_level1_count,
    tmlc_level2_count = EXCLUDED.tmlc_level2_count,
    tmlc_level3_count = EXCLUDED.tmlc_level3_count,
    tmlc_updated_at = now()
  RETURNING
    tmlc_user_id,
    tmlc_level1_count,
    tmlc_level2_count,
    tmlc_level3_count
)
SELECT
  u.tmlc_user_id AS user_id,
  u.tmlc_level1_count AS level1_count,
  u.tmlc_level2_count AS level2_count,
  u.tmlc_level3_count AS level3_count
FROM upserted u
$sql$;

CREATE OR REPLACE FUNCTION public.recompute_all_mlm_level_counts()
RETURNS integer
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  PERFORM public.rebuild_referral_closure();

  INSERT INTO public.tbl_mlm_level_counts (
    tmlc_user_id,
    tmlc_sponsorship_number,
    tmlc_level1_count,
    tmlc_level2_count,
    tmlc_level3_count,
    tmlc_updated_at
  )
  SELECT
    up.tup_user_id,
    up.tup_sponsorship_number,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 1
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 2
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int,
    COALESCE(COUNT(*) FILTER (
      WHERE c.trc_depth = 3
        AND COALESCE(u.tu_is_active, false)
        AND COALESCE(u.tu_registration_paid, false)
        AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ), 0)::int,
    now()
  FROM public.tbl_user_profiles up
  LEFT JOIN public.tbl_referral_closure c
    ON c.trc_ancestor_user_id = up.tup_user_id
   AND c.trc_depth BETWEEN 1 AND 3
  LEFT JOIN public.tbl_users u
    ON u.tu_id = c.trc_descendant_user_id
  WHERE up.tup_user_id IS NOT NULL
    AND up.tup_sponsorship_number IS NOT NULL
    AND btrim(up.tup_sponsorship_number) <> ''
  GROUP BY up.tup_user_id, up.tup_sponsorship_number
  ON CONFLICT (tmlc_user_id) DO UPDATE
  SET
    tmlc_sponsorship_number = EXCLUDED.tmlc_sponsorship_number,
    tmlc_level1_count = EXCLUDED.tmlc_level1_count,
    tmlc_level2_count = EXCLUDED.tmlc_level2_count,
    tmlc_level3_count = EXCLUDED.tmlc_level3_count,
    tmlc_updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

DROP FUNCTION IF EXISTS public.get_mlm_level_counts_for_sponsors_at_level(int, text[]);
DROP FUNCTION IF EXISTS public.get_mlm_level_counts_for_sponsors_at_level(text[], int);

CREATE OR REPLACE FUNCTION public.get_mlm_level_counts_for_sponsors_at_level(
  p_sponsorship_numbers text[],
  p_level int
)
RETURNS TABLE (
  sponsorship_number text,
  level_count int
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
WITH seed AS (
  SELECT DISTINCT public.normalize_sponsorship_key(s) AS sponsor_key
  FROM unnest(p_sponsorship_numbers) AS s
  WHERE public.normalize_sponsorship_key(s) IS NOT NULL
),
sponsors AS (
  SELECT
    up.tup_user_id,
    public.normalize_sponsorship_key(up.tup_sponsorship_number) AS sponsor_key,
    btrim(up.tup_sponsorship_number) AS sponsorship_number
  FROM public.tbl_user_profiles up
  JOIN seed ON seed.sponsor_key = public.normalize_sponsorship_key(up.tup_sponsorship_number)
)
SELECT
  sponsors.sponsorship_number AS sponsorship_number,
  COALESCE(COUNT(*) FILTER (
    WHERE c.trc_depth = LEAST(100, GREATEST(1, COALESCE(p_level, 1)))
      AND COALESCE(u.tu_is_active, false)
      AND COALESCE(u.tu_registration_paid, false)
      AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
  ), 0)::int AS level_count
FROM sponsors
LEFT JOIN public.tbl_referral_closure c
  ON c.trc_ancestor_user_id = sponsors.tup_user_id
 AND c.trc_depth = LEAST(100, GREATEST(1, COALESCE(p_level, 1)))
LEFT JOIN public.tbl_users u
  ON u.tu_id = c.trc_descendant_user_id
GROUP BY sponsors.sponsorship_number
$sql$;

CREATE OR REPLACE FUNCTION public.get_upline_sponsorships(
  p_child_sponsorship text,
  p_max_levels integer DEFAULT 3
) RETURNS TABLE(level integer, sponsorship_number text, user_id uuid)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
WITH child AS (
  SELECT up.tup_user_id
  FROM public.tbl_user_profiles up
  WHERE public.normalize_sponsorship_key(up.tup_sponsorship_number)
    = public.normalize_sponsorship_key(p_child_sponsorship)
  LIMIT 1
)
SELECT
  c.trc_depth AS level,
  ancestor_profile.tup_sponsorship_number AS sponsorship_number,
  ancestor_profile.tup_user_id AS user_id
FROM child
JOIN public.tbl_referral_closure c
  ON c.trc_descendant_user_id = child.tup_user_id
JOIN public.tbl_user_profiles ancestor_profile
  ON ancestor_profile.tup_user_id = c.trc_ancestor_user_id
WHERE c.trc_depth <= LEAST(100, GREATEST(1, COALESCE(p_max_levels, 3)))
ORDER BY c.trc_depth
$sql$;

DROP FUNCTION IF EXISTS public.get_referral_network_v1(uuid, int);
DROP FUNCTION IF EXISTS public.get_referral_network_page_v1(uuid, int, int, text, int, int);

CREATE OR REPLACE FUNCTION public.get_referral_network_v1(
  p_user_id uuid,
  p_max_levels int DEFAULT 10
)
RETURNS TABLE (
  user_id uuid,
  parent_user_id uuid,
  level int,
  sponsorship_number text,
  parent_account text,
  is_active boolean,
  is_registration_paid boolean,
  mobile_verified boolean,
  is_active_member boolean,
  email text,
  first_name text,
  last_name text,
  username text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
SELECT
  c.trc_descendant_user_id AS user_id,
  direct_parent.trc_ancestor_user_id AS parent_user_id,
  c.trc_depth AS level,
  p.tup_sponsorship_number AS sponsorship_number,
  p.tup_parent_account AS parent_account,
  COALESCE(u.tu_is_active, false) AS is_active,
  COALESCE(u.tu_registration_paid, false) AS is_registration_paid,
  COALESCE(u.tu_mobile_verified, false) AS mobile_verified,
  (
    COALESCE(u.tu_is_active, false)
    AND COALESCE(u.tu_registration_paid, false)
    AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
  ) AS is_active_member,
  u.tu_email AS email,
  p.tup_first_name AS first_name,
  p.tup_last_name AS last_name,
  p.tup_username AS username
FROM public.tbl_referral_closure c
LEFT JOIN public.tbl_referral_closure direct_parent
  ON direct_parent.trc_descendant_user_id = c.trc_descendant_user_id
 AND direct_parent.trc_depth = 1
LEFT JOIN public.tbl_users u ON u.tu_id = c.trc_descendant_user_id
LEFT JOIN public.tbl_user_profiles p ON p.tup_user_id = c.trc_descendant_user_id
WHERE c.trc_ancestor_user_id = p_user_id
  AND c.trc_depth <= LEAST(100, GREATEST(1, COALESCE(p_max_levels, 10)))
ORDER BY c.trc_depth, p.tup_sponsorship_number
$sql$;

CREATE OR REPLACE FUNCTION public.get_referral_network_page_v1(
  p_user_id uuid,
  p_max_levels int DEFAULT 10,
  p_level int DEFAULT NULL,
  p_search_term text DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  user_id uuid,
  parent_user_id uuid,
  level int,
  sponsorship_number text,
  parent_account text,
  parent_sponsorship_number text,
  is_active boolean,
  is_registration_paid boolean,
  mobile_verified boolean,
  is_active_member boolean,
  email text,
  first_name text,
  last_name text,
  username text,
  total_count int,
  direct_referrals int,
  max_depth int
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
WITH params AS (
  SELECT
    LEAST(100, GREATEST(1, COALESCE(p_max_levels, 10)))::int AS max_levels,
    CASE
      WHEN p_level IS NULL OR p_level < 1 THEN NULL::int
      ELSE LEAST(100, p_level)::int
    END AS level_filter,
    NULLIF(btrim(COALESCE(p_search_term, '')), '') AS search_term,
    GREATEST(0, COALESCE(p_offset, 0))::int AS offset_rows,
    LEAST(100, GREATEST(1, COALESCE(p_limit, 50)))::int AS limit_rows
),
network_enriched AS (
  SELECT
    c.trc_descendant_user_id AS user_id,
    direct_parent.trc_ancestor_user_id AS parent_user_id,
    c.trc_depth AS level,
    p.tup_sponsorship_number AS sponsorship_number,
    p.tup_parent_account AS parent_account,
    parent_profile.tup_sponsorship_number AS parent_sponsorship_number,
    COALESCE(u.tu_is_active, false) AS is_active,
    COALESCE(u.tu_registration_paid, false) AS is_registration_paid,
    COALESCE(u.tu_mobile_verified, false) AS mobile_verified,
    (
      COALESCE(u.tu_is_active, false)
      AND COALESCE(u.tu_registration_paid, false)
      AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
    ) AS is_active_member,
    u.tu_email AS email,
    p.tup_first_name AS first_name,
    p.tup_last_name AS last_name,
    p.tup_username AS username
  FROM public.tbl_referral_closure c
  JOIN params ON true
  LEFT JOIN public.tbl_referral_closure direct_parent
    ON direct_parent.trc_descendant_user_id = c.trc_descendant_user_id
   AND direct_parent.trc_depth = 1
  LEFT JOIN public.tbl_user_profiles parent_profile
    ON parent_profile.tup_user_id = direct_parent.trc_ancestor_user_id
  LEFT JOIN public.tbl_users u ON u.tu_id = c.trc_descendant_user_id
  LEFT JOIN public.tbl_user_profiles p ON p.tup_user_id = c.trc_descendant_user_id
  WHERE c.trc_ancestor_user_id = p_user_id
    AND c.trc_depth <= params.max_levels
),
network_filtered AS (
  SELECT ne.*
  FROM network_enriched ne
  JOIN params ON true
  WHERE (params.level_filter IS NULL OR ne.level = params.level_filter)
    AND (
      params.search_term IS NULL
      OR ne.sponsorship_number ILIKE '%' || params.search_term || '%'
      OR ne.username ILIKE '%' || params.search_term || '%'
      OR ne.email ILIKE '%' || params.search_term || '%'
      OR ne.first_name ILIKE '%' || params.search_term || '%'
      OR ne.last_name ILIKE '%' || params.search_term || '%'
    )
),
summary AS (
  SELECT
    COALESCE(COUNT(*), 0)::int AS total_count,
    COALESCE(SUM(CASE WHEN level = 1 THEN 1 ELSE 0 END), 0)::int AS direct_referrals,
    COALESCE(MAX(level), 0)::int AS max_depth
  FROM network_filtered
)
SELECT
  nf.user_id,
  nf.parent_user_id,
  nf.level,
  nf.sponsorship_number,
  nf.parent_account,
  nf.parent_sponsorship_number,
  nf.is_active,
  nf.is_registration_paid,
  nf.mobile_verified,
  nf.is_active_member,
  nf.email,
  nf.first_name,
  nf.last_name,
  nf.username,
  summary.total_count,
  summary.direct_referrals,
  summary.max_depth
FROM network_filtered nf
CROSS JOIN summary
JOIN params ON true
ORDER BY nf.level, nf.sponsorship_number
LIMIT (SELECT limit_rows FROM params) OFFSET (SELECT offset_rows FROM params)
$sql$;

CREATE OR REPLACE FUNCTION public.get_referral_network_stats_v1(
  p_user_id uuid,
  p_max_levels int DEFAULT 100
)
RETURNS TABLE (
  total_team int,
  total_direct_referrals int,
  active_direct_referrals int,
  active_team int,
  max_depth int
)
SECURITY DEFINER
SET search_path = public
LANGUAGE sql
AS $sql$
SELECT
  COALESCE(COUNT(*), 0)::int AS total_team,
  COALESCE(COUNT(*) FILTER (WHERE c.trc_depth = 1), 0)::int AS total_direct_referrals,
  COALESCE(COUNT(*) FILTER (
    WHERE c.trc_depth = 1
      AND COALESCE(u.tu_is_active, false)
      AND COALESCE(u.tu_registration_paid, false)
      AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
  ), 0)::int AS active_direct_referrals,
  COALESCE(COUNT(*) FILTER (
    WHERE COALESCE(u.tu_is_active, false)
      AND COALESCE(u.tu_registration_paid, false)
      AND public.meets_current_verification_requirements(u.tu_email_verified, u.tu_mobile_verified)
  ), 0)::int AS active_team,
  COALESCE(MAX(c.trc_depth), 0)::int AS max_depth
FROM public.tbl_referral_closure c
LEFT JOIN public.tbl_users u
  ON u.tu_id = c.trc_descendant_user_id
WHERE c.trc_ancestor_user_id = p_user_id
  AND c.trc_depth <= LEAST(100, GREATEST(1, COALESCE(p_max_levels, 100)))
$sql$;

GRANT EXECUTE ON FUNCTION public.normalize_sponsorship_key(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_referral_closure_for_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rebuild_referral_closure() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_mlm_level_counts(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_all_mlm_level_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mlm_level_counts_for_sponsors_at_level(text[], int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_upline_sponsorships(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_network_v1(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_network_page_v1(uuid, int, int, text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_referral_network_stats_v1(uuid, int) TO authenticated, service_role;

SELECT public.recompute_all_mlm_level_counts();
