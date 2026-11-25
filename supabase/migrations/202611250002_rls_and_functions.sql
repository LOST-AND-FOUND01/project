-- FOUNDIT Phase B Migration 2: RLS Policies, Auth Signup Trigger & Trusted RPCs
-- Security Priority: Least privilege, fixed search_path on SECURITY DEFINER functions, no self-escalation.

-- Helper: Check if current user holds active admin role
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = COALESCE(check_user_id, auth.uid())
      AND ur.role = 'admin'
      AND p.account_status = 'Active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- Helper: Check if user is active (not suspended)
CREATE OR REPLACE FUNCTION public.is_active_user(check_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = COALESCE(check_user_id, auth.uid())
      AND account_status = 'Active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;

-- Internal audit helper (not directly callable by clients)
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_actor_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = p_actor_id;
  INSERT INTO public.admin_audit_logs (actor_id, actor_email, action, target_type, target_id, details)
  VALUES (p_actor_id, COALESCE(v_email, 'system'), p_action, p_target_type, p_target_id, COALESCE(p_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(uuid, text, text, text, jsonb) FROM PUBLIC;

-- Auth trigger: automatically provision profile & 'student' role only (never admin)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_name text;
  v_usn text;
  v_dept text;
  v_phone text;
BEGIN
  v_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''), split_part(NEW.email, '@', 1));
  v_usn := NULLIF(upper(trim(COALESCE(NEW.raw_user_meta_data ->> 'usn', ''))), '');
  v_dept := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'department'), ''), 'General');
  v_phone := COALESCE(trim(NEW.raw_user_meta_data ->> 'phone'), '');

  INSERT INTO public.profiles (id, full_name, usn, email, department, phone, email_verified)
  VALUES (NEW.id, left(v_name, 120), v_usn, NEW.email, left(v_dept, 100), left(v_phone, 30), NEW.email_confirmed_at IS NOT NULL)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        email_verified = (NEW.email_confirmed_at IS NOT NULL);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email,
      email_verified = (NEW.email_confirmed_at IS NOT NULL)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_updated();

-- Enable RLS on every application table
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES RLS
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_update_own_safe_fields"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() AND account_status = 'Active')
  WITH CHECK (id = auth.uid() AND account_status = 'Active');

-- Prevent students from modifying protected profile fields directly via trigger
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.email := OLD.email;
    NEW.email_verified := OLD.email_verified;
    NEW.account_status := OLD.account_status;
    NEW.usn := OLD.usn;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- USER_ROLES RLS (Read own or admin; NO client writes allowed)
CREATE POLICY "user_roles_select_own_or_admin"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ITEM_REPORTS RLS
CREATE POLICY "item_reports_select_public_non_archived"
  ON public.item_reports FOR SELECT TO anon, authenticated
  USING (status <> 'Archived' OR reporter_id = auth.uid() OR public.is_admin());

CREATE POLICY "item_reports_insert_authenticated_active"
  ON public.item_reports FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND public.is_active_user()
    AND status = 'Open'
    AND is_flagged = false
  );

CREATE POLICY "item_reports_update_own_permitted"
  ON public.item_reports FOR UPDATE TO authenticated
  USING (reporter_id = auth.uid() AND public.is_active_user())
  WITH CHECK (reporter_id = auth.uid() AND public.is_active_user());

CREATE POLICY "item_reports_delete_own_or_admin"
  ON public.item_reports FOR DELETE TO authenticated
  USING ((reporter_id = auth.uid() AND status = 'Open') OR public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_item_report_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    -- Owners cannot alter moderation flags, reporter_id, or jump to arbitrary statuses except marking Open -> Returned/Archived
    NEW.reporter_id := OLD.reporter_id;
    NEW.is_flagged := OLD.is_flagged;
    NEW.flag_reason := OLD.flag_reason;
    NEW.flagged_by := OLD.flagged_by;
    IF NEW.status <> OLD.status AND NOT (OLD.status = 'Open' AND NEW.status IN ('Returned', 'Archived')) THEN
      RAISE EXCEPTION 'Only administrators can set status to %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_item_report_update
  BEFORE UPDATE ON public.item_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_item_report_update();

-- Safe public listing view (hides reporter_id/name when is_anonymous = true)
CREATE OR REPLACE VIEW public.public_item_listings AS
SELECT
  ir.id,
  ir.title,
  ir.report_type,
  ir.category,
  ir.colour,
  ir.location,
  ir.incident_date,
  ir.description,
  ir.is_anonymous,
  ir.status,
  ir.is_flagged,
  ir.created_at,
  ir.updated_at,
  CASE
    WHEN ir.is_anonymous AND ir.reporter_id <> COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) AND NOT public.is_admin()
      THEN NULL
    ELSE ir.reporter_id
  END AS reporter_id,
  CASE
    WHEN ir.is_anonymous THEN 'Campus member'
    ELSE COALESCE(p.full_name, 'Campus member')
  END AS reporter_display_name
FROM public.item_reports ir
LEFT JOIN public.profiles p ON p.id = ir.reporter_id
WHERE ir.status <> 'Archived'
   OR ir.reporter_id = auth.uid()
   OR public.is_admin();

GRANT SELECT ON public.public_item_listings TO anon, authenticated;

-- ITEM_IMAGES RLS
CREATE POLICY "item_images_select_visible"
  ON public.item_images FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id
        AND (ir.status <> 'Archived' OR ir.reporter_id = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY "item_images_insert_own"
  ON public.item_images FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id AND ir.reporter_id = auth.uid()
    )
  );

CREATE POLICY "item_images_delete_own_or_admin"
  ON public.item_images FOR DELETE TO authenticated
  USING (uploader_id = auth.uid() OR public.is_admin());

-- CLAIMS RLS
CREATE POLICY "claims_select_involved_or_admin"
  ON public.claims FOR SELECT TO authenticated
  USING (
    claimant_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id AND ir.reporter_id = auth.uid()
    )
  );

CREATE POLICY "claims_insert_authenticated_non_owner"
  ON public.claims FOR INSERT TO authenticated
  WITH CHECK (
    claimant_id = auth.uid()
    AND public.is_active_user()
    AND status = 'Pending'
    AND finder_confirmed = false
    AND claimant_confirmed = false
    AND EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id
        AND ir.report_type = 'found'
        AND ir.status = 'Open'
        AND ir.reporter_id <> auth.uid()
    )
  );

-- Direct client updates on claims blocked; state transitions go through secure RPCs

-- NOTIFICATIONS & READS RLS
CREATE POLICY "notifications_select_public_announcements"
  ON public.notifications FOR SELECT TO anon
  USING (is_broadcast = true AND category = 'announcement');

CREATE POLICY "notifications_select_own_or_broadcast"
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_broadcast = true OR public.is_admin());

CREATE POLICY "notifications_update_own_read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND is_broadcast = false)
  WITH CHECK (user_id = auth.uid() AND is_broadcast = false);

CREATE POLICY "notification_reads_own"
  ON public.notification_reads FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ADMIN_AUDIT_LOGS RLS (Admin read only; writes strictly via SECURITY DEFINER functions)
CREATE POLICY "audit_logs_select_admin_only"
  ON public.admin_audit_logs FOR SELECT TO authenticated
  USING (public.is_admin());

-- TRUSTED RPC FUNCTIONS

-- 1. Flag an item listing (any active authenticated user)
CREATE OR REPLACE FUNCTION public.flag_item_report(p_item_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  UPDATE public.item_reports
  SET is_flagged = true,
      flag_reason = left(COALESCE(NULLIF(trim(p_reason), ''), 'Flagged by campus user'), 300),
      flagged_by = auth.uid()
  WHERE id = p_item_id;

  PERFORM public.write_audit_log(auth.uid(), 'ITEM_FLAGGED', 'item_report', p_item_id::text, jsonb_build_object('reason', p_reason));
END;
$$;

REVOKE ALL ON FUNCTION public.flag_item_report(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_item_report(uuid, text) TO authenticated;

-- 2. Two-party handover confirmation (only finder OR claimant on an Approved/Handover Pending claim)
CREATE OR REPLACE FUNCTION public.confirm_handover(p_claim_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.claims%ROWTYPE;
  v_item public.item_reports%ROWTYPE;
  v_completed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_claim FROM public.claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  SELECT * INTO v_item FROM public.item_reports WHERE id = v_claim.item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

  IF v_claim.status NOT IN ('Approved', 'Handover Pending') THEN
    RAISE EXCEPTION 'Claim must be approved before handover confirmation';
  END IF;

  IF p_role = 'finder' THEN
    IF v_item.reporter_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the item reporter can confirm finder handover';
    END IF;
    IF v_claim.finder_confirmed THEN
      RAISE EXCEPTION 'Finder already confirmed';
    END IF;
    v_claim.finder_confirmed := true;
    v_claim.history := v_claim.history || jsonb_build_array(jsonb_build_object('status', 'Finder Confirmed', 'at', now(), 'note', 'Finder confirmed physical handover'));
  ELSIF p_role = 'claimant' THEN
    IF v_claim.claimant_id <> auth.uid() THEN
      RAISE EXCEPTION 'Only the claimant can confirm receipt';
    END IF;
    IF v_claim.claimant_confirmed THEN
      RAISE EXCEPTION 'Claimant already confirmed';
    END IF;
    v_claim.claimant_confirmed := true;
    v_claim.history := v_claim.history || jsonb_build_array(jsonb_build_object('status', 'Claimant Confirmed', 'at', now(), 'note', 'Claimant confirmed receipt'));
  ELSE
    RAISE EXCEPTION 'Invalid handover role';
  END IF;

  IF v_claim.finder_confirmed AND v_claim.claimant_confirmed THEN
    v_claim.status := 'Completed';
    v_claim.completed_at := now();
    v_claim.history := v_claim.history || jsonb_build_array(jsonb_build_object('status', 'Completed', 'at', now(), 'note', 'Two-party return completed'));
    v_completed := true;
    UPDATE public.item_reports SET status = 'Returned' WHERE id = v_item.id;
    INSERT INTO public.notifications (user_id, category, title, message, action_page)
    VALUES
      (v_claim.claimant_id, 'claim', 'Return Completed: ' || v_item.title, 'Both parties confirmed handover. Item marked Returned.', 'dashboard'),
      (v_item.reporter_id, 'claim', 'Return Completed: ' || v_item.title, 'Both parties confirmed handover. Item marked Returned.', 'dashboard');
    PERFORM public.write_audit_log(auth.uid(), 'HANDOVER_COMPLETED', 'claim', v_claim.id::text, jsonb_build_object('item_id', v_item.id));
  ELSE
    v_claim.status := 'Handover Pending';
    PERFORM public.write_audit_log(auth.uid(), 'HANDOVER_PARTIAL', 'claim', v_claim.id::text, jsonb_build_object('role', p_role));
  END IF;

  UPDATE public.claims
  SET finder_confirmed = v_claim.finder_confirmed,
      claimant_confirmed = v_claim.claimant_confirmed,
      status = v_claim.status,
      completed_at = v_claim.completed_at,
      history = v_claim.history
  WHERE id = v_claim.id;

  RETURN jsonb_build_object('completed', v_completed, 'status', v_claim.status);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_handover(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_handover(uuid, text) TO authenticated;

-- 3. Admin RPC: Approve or Reject Claim
CREATE OR REPLACE FUNCTION public.admin_decide_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.claims%ROWTYPE;
  v_item public.item_reports%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF p_decision NOT IN ('Approved', 'Rejected') THEN
    RAISE EXCEPTION 'Invalid claim decision';
  END IF;

  SELECT * INTO v_claim FROM public.claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  SELECT * INTO v_item FROM public.item_reports WHERE id = v_claim.item_id FOR UPDATE;

  UPDATE public.claims
  SET status = p_decision,
      admin_note = left(COALESCE(p_note, ''), 400),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      history = history || jsonb_build_array(jsonb_build_object('status', p_decision, 'at', now(), 'note', COALESCE(NULLIF(trim(p_note), ''), 'Reviewed by Administrator')))
  WHERE id = p_claim_id;

  IF p_decision = 'Approved' THEN
    UPDATE public.item_reports SET status = 'Handover Pending' WHERE id = v_claim.item_id;
  END IF;

  INSERT INTO public.notifications (user_id, category, title, message, action_page)
  VALUES (
    v_claim.claimant_id,
    'claim',
    'Claim ' || p_decision || ': ' || v_item.title,
    CASE
      WHEN p_decision = 'Approved' THEN 'Your claim was approved. Coordinate handover and confirm receipt in My Dashboard.'
      ELSE 'Your claim was rejected.' || CASE WHEN trim(COALESCE(p_note, '')) <> '' THEN ' Note: ' || trim(p_note) ELSE '' END
    END,
    'dashboard'
  );

  PERFORM public.write_audit_log(auth.uid(), 'CLAIM_' || upper(p_decision), 'claim', p_claim_id::text, jsonb_build_object('item_id', v_claim.item_id, 'note', p_note));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_decide_claim(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_decide_claim(uuid, text, text) TO authenticated;

-- 4. Admin RPC: Update report status or moderate flag
CREATE OR REPLACE FUNCTION public.admin_update_report(p_item_id uuid, p_status text DEFAULT NULL, p_moderation_action text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.item_reports%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;

  SELECT * INTO v_item FROM public.item_reports WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item report not found'; END IF;

  IF p_status IS NOT NULL THEN
    UPDATE public.item_reports SET status = p_status WHERE id = p_item_id;
    INSERT INTO public.notifications (user_id, category, title, message, action_page)
    VALUES (v_item.reporter_id, 'report', 'Report updated: ' || v_item.title, 'Status changed to ' || p_status || '.', 'dashboard');
    PERFORM public.write_audit_log(auth.uid(), 'ITEM_STATUS_CHANGED', 'item_report', p_item_id::text, jsonb_build_object('from', v_item.status, 'to', p_status));
  END IF;

  IF p_moderation_action = 'clear' THEN
    UPDATE public.item_reports SET is_flagged = false, flag_reason = '', flagged_by = NULL WHERE id = p_item_id;
    PERFORM public.write_audit_log(auth.uid(), 'MODERATION_CLEARED', 'item_report', p_item_id::text, '{}'::jsonb);
  ELSIF p_moderation_action = 'archive' THEN
    UPDATE public.item_reports SET is_flagged = false, status = 'Archived' WHERE id = p_item_id;
    PERFORM public.write_audit_log(auth.uid(), 'MODERATION_ARCHIVED', 'item_report', p_item_id::text, '{}'::jsonb);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_report(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_report(uuid, text, text) TO authenticated;

-- 5. Admin RPC: Manage user status & publish announcement
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_target_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  IF p_status NOT IN ('Active', 'Suspended') THEN
    RAISE EXCEPTION 'Invalid account status';
  END IF;
  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Administrators cannot suspend their own account';
  END IF;

  UPDATE public.profiles SET account_status = p_status WHERE id = p_target_user_id;
  PERFORM public.write_audit_log(auth.uid(), 'USER_STATUS_CHANGED', 'profile', p_target_user_id::text, jsonb_build_object('status', p_status));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_status(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_publish_announcement(p_title text, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;

  INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
  VALUES (NULL, true, 'announcement', trim(p_title), trim(p_message), 'home')
  RETURNING id INTO v_id;

  PERFORM public.write_audit_log(auth.uid(), 'ANNOUNCEMENT_PUBLISHED', 'notification', v_id::text, jsonb_build_object('title', p_title));
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_publish_announcement(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_publish_announcement(text, text) TO authenticated;

-- 6. Admin RPC: Trusted user directory (never exposes sensitive auth columns)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id uuid,
  full_name text,
  usn text,
  email text,
  department text,
  phone text,
  email_verified boolean,
  account_status text,
  role text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.usn,
    p.email,
    p.department,
    p.phone,
    p.email_verified,
    p.account_status,
    COALESCE((
      SELECT ur.role FROM public.user_roles ur
      WHERE ur.user_id = p.id
      ORDER BY (ur.role = 'admin') DESC
      LIMIT 1
    ), 'student') AS role,
    p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
