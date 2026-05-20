/*
  # Atomic customer signup from auth.users

  Customer signup used to happen as:
    1. supabase.auth.signUp()
    2. public.register_customer(...)

  If step 1 succeeded and step 2 failed/interrupted, admin could see an
  email-only customer with no profile. This trigger consumes customer profile
  fields from auth.users.raw_user_meta_data and creates tbl_users +
  tbl_user_profiles inside the same auth user insert transaction.
*/

CREATE OR REPLACE FUNCTION public.generate_unique_sponsorship_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_try int := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_code := 'SP' || lpad((floor(random() * 100000000))::int::text, 8, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.tbl_user_profiles
      WHERE lower(btrim(tup_sponsorship_number)) = lower(btrim(v_code))
    ) THEN
      RETURN v_code;
    END IF;

    IF v_try > 200 THEN
      RAISE EXCEPTION 'Could not generate unique sponsorship number after % attempts', v_try;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_customer_auth_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_user_type text := lower(NULLIF(btrim(COALESCE(v_meta->>'user_type', v_meta->>'userType', '')), ''));
  v_parent_account text := NULLIF(btrim(COALESCE(v_meta->>'parent_account', v_meta->>'parentAccount', '')), '');
  v_default_parent text;
  v_sponsor_id uuid;
  v_sponsorship text;
BEGIN
  IF v_user_type <> 'customer' THEN
    RETURN NEW;
  END IF;

  IF v_parent_account IS NULL THEN
    SELECT tup_sponsorship_number
    INTO v_default_parent
    FROM public.tbl_user_profiles
    WHERE tup_is_default_parent = true
      AND NULLIF(btrim(tup_sponsorship_number), '') IS NOT NULL
    LIMIT 1;

    IF v_default_parent IS NULL THEN
      RAISE EXCEPTION 'Default parent account not configured';
    END IF;

    v_parent_account := v_default_parent;
  END IF;

  SELECT sponsor_profile.tup_user_id
  INTO v_sponsor_id
  FROM public.tbl_user_profiles sponsor_profile
  WHERE (
    CASE
      WHEN lower(btrim(sponsor_profile.tup_sponsorship_number)) LIKE 'sp%'
        THEN substr(lower(btrim(sponsor_profile.tup_sponsorship_number)), 3)
      ELSE lower(btrim(sponsor_profile.tup_sponsorship_number))
    END
  ) = (
    CASE
      WHEN lower(btrim(v_parent_account)) LIKE 'sp%'
        THEN substr(lower(btrim(v_parent_account)), 3)
      ELSE lower(btrim(v_parent_account))
    END
  )
  LIMIT 1;

  IF v_sponsor_id IS NULL THEN
    RAISE EXCEPTION 'Invalid sponsorship number: %', v_parent_account;
  END IF;

  SELECT tup_sponsorship_number
  INTO v_sponsorship
  FROM public.tbl_user_profiles
  WHERE tup_user_id = NEW.id;

  IF v_sponsorship IS NULL OR btrim(v_sponsorship) = '' THEN
    v_sponsorship := public.generate_unique_sponsorship_number();
  END IF;

  INSERT INTO public.tbl_users (
    tu_id,
    tu_email,
    tu_user_type,
    tu_referrer_id,
    tu_email_verified,
    tu_is_verified,
    tu_updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'customer',
    v_sponsor_id,
    NEW.email_confirmed_at IS NOT NULL,
    NEW.email_confirmed_at IS NOT NULL,
    now()
  )
  ON CONFLICT (tu_id) DO UPDATE
  SET
    tu_email = EXCLUDED.tu_email,
    tu_user_type = 'customer',
    tu_referrer_id = EXCLUDED.tu_referrer_id,
    tu_email_verified = COALESCE(public.tbl_users.tu_email_verified, false) OR EXCLUDED.tu_email_verified,
    tu_is_verified = COALESCE(public.tbl_users.tu_is_verified, false) OR EXCLUDED.tu_is_verified,
    tu_updated_at = now();

  INSERT INTO public.tbl_user_profiles (
    tup_user_id,
    tup_first_name,
    tup_last_name,
    tup_username,
    tup_mobile,
    tup_gender,
    tup_parent_account,
    tup_sponsorship_number,
    tup_updated_at
  )
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(v_meta->>'first_name', v_meta->>'firstName', '')), ''),
    NULLIF(btrim(COALESCE(v_meta->>'last_name', v_meta->>'lastName', '')), ''),
    NULLIF(btrim(COALESCE(v_meta->>'username', v_meta->>'userName', '')), ''),
    NULLIF(btrim(COALESCE(v_meta->>'mobile', '')), ''),
    NULLIF(btrim(COALESCE(v_meta->>'gender', '')), ''),
    v_parent_account,
    v_sponsorship,
    now()
  )
  ON CONFLICT (tup_user_id) DO UPDATE
  SET
    tup_first_name = EXCLUDED.tup_first_name,
    tup_last_name = EXCLUDED.tup_last_name,
    tup_username = EXCLUDED.tup_username,
    tup_mobile = EXCLUDED.tup_mobile,
    tup_gender = EXCLUDED.tup_gender,
    tup_parent_account = EXCLUDED.tup_parent_account,
    tup_sponsorship_number = CASE
      WHEN public.tbl_user_profiles.tup_sponsorship_number IS NULL
        OR btrim(public.tbl_user_profiles.tup_sponsorship_number) = ''
        THEN EXCLUDED.tup_sponsorship_number
      ELSE public.tbl_user_profiles.tup_sponsorship_number
    END,
    tup_updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_default_parent_sponsorship_number()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT p.tup_sponsorship_number
FROM public.tbl_user_profiles p
JOIN public.tbl_users u
  ON u.tu_id = p.tup_user_id
WHERE p.tup_is_default_parent = true
  AND NULLIF(btrim(p.tup_sponsorship_number), '') IS NOT NULL
  AND COALESCE(u.tu_is_active, false)
  AND COALESCE(u.tu_registration_paid, false)
  AND (COALESCE(u.tu_email_verified, false) OR COALESCE(u.tu_mobile_verified, false))
ORDER BY p.tup_created_at ASC NULLS LAST
LIMIT 1
$$;

DROP TRIGGER IF EXISTS trigger_customer_auth_signup ON auth.users;
CREATE TRIGGER trigger_customer_auth_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_customer_auth_signup();

GRANT EXECUTE ON FUNCTION public.handle_customer_auth_signup() TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_unique_sponsorship_number() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_default_parent_sponsorship_number() TO authenticated, anon, service_role;
