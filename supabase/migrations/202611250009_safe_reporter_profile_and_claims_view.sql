-- FOUNDIT Migration 9: Safe Public Finder/Reporter Profile & Finder Name in Claims
-- Exposes only safe public profile fields (full_name, department, verified badge, member_since, report counts).
-- Never exposes email, phone, password, or private account data.

CREATE OR REPLACE FUNCTION public.get_safe_reporter_profile(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.item_reports%ROWTYPE;
  v_prof public.profiles%ROWTYPE;
  v_total integer := 0;
  v_returned integer := 0;
BEGIN
  SELECT * INTO v_item FROM public.item_reports WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF v_item.status = 'Closed' AND v_item.reporter_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Profile unavailable';
  END IF;

  IF v_item.is_anonymous AND v_item.reporter_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin() THEN
    RETURN jsonb_build_object(
      'display_name', 'Campus Member (Anonymous)',
      'department', 'JCET Campus Community',
      'verified', true,
      'is_anonymous', true,
      'member_since', null,
      'total_reports', null,
      'returned_reports', null
    );
  END IF;

  SELECT * INTO v_prof FROM public.profiles WHERE id = v_item.reporter_id;

  SELECT count(*), count(*) FILTER (WHERE status = 'Returned')
  INTO v_total, v_returned
  FROM public.item_reports
  WHERE reporter_id = v_item.reporter_id
    AND status <> 'Closed'
    AND is_anonymous = false;

  RETURN jsonb_build_object(
    'display_name', COALESCE(NULLIF(trim(v_prof.full_name), ''), 'Campus Member'),
    'department', COALESCE(NULLIF(trim(v_prof.department), ''), 'JCET Campus Community'),
    'verified', COALESCE(v_prof.email_verified, false),
    'is_anonymous', false,
    'member_since', v_prof.created_at,
    'total_reports', v_total,
    'returned_reports', v_returned
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_safe_reporter_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safe_reporter_profile(uuid) TO anon, authenticated;

-- Safe RPC for authenticated users to fetch their visible claims (as claimant OR finder) WITH finder display name
CREATE OR REPLACE FUNCTION public.get_my_claims_with_finder()
RETURNS TABLE (
  id uuid,
  item_id uuid,
  claimant_id uuid,
  item_title text,
  item_location text,
  item_specific_location text,
  item_status text,
  finder_id uuid,
  finder_name text,
  ownership_explanation text,
  handover_preference text,
  status text,
  admin_note text,
  finder_confirmed boolean,
  claimant_confirmed boolean,
  completed_at timestamptz,
  history jsonb,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cl.id,
    cl.item_id,
    cl.claimant_id,
    ir.title AS item_title,
    ir.location AS item_location,
    ir.specific_location AS item_specific_location,
    ir.status AS item_status,
    ir.reporter_id AS finder_id,
    CASE
      WHEN ir.is_anonymous AND ir.reporter_id <> auth.uid() AND NOT public.is_admin() THEN 'Campus Member'
      ELSE COALESCE(NULLIF(trim(pf.full_name), ''), 'Campus Member')
    END AS finder_name,
    cl.ownership_explanation,
    cl.handover_preference,
    cl.status,
    cl.admin_note,
    cl.finder_confirmed,
    cl.claimant_confirmed,
    cl.completed_at,
    cl.history,
    cl.created_at
  FROM public.claims cl
  JOIN public.item_reports ir ON ir.id = cl.item_id
  LEFT JOIN public.profiles pf ON pf.id = ir.reporter_id
  WHERE cl.claimant_id = auth.uid()
     OR ir.reporter_id = auth.uid()
     OR public.is_admin()
  ORDER BY cl.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_claims_with_finder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_claims_with_finder() TO authenticated;
