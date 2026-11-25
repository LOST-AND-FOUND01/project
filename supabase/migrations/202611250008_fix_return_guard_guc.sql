-- FOUNDIT Migration 8: Allow trusted SECURITY DEFINER return RPCs to transition item status to Returned

CREATE OR REPLACE FUNCTION public.guard_item_report_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.bypass_status_guard', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    NEW.reporter_id := OLD.reporter_id;
    NEW.is_flagged := OLD.is_flagged;
    NEW.flag_reason := OLD.flag_reason;
    NEW.flagged_by := OLD.flagged_by;
    IF NEW.status <> OLD.status THEN
      IF NEW.status = 'Returned' AND OLD.status <> 'Returned' THEN
        RAISE EXCEPTION 'Use the return confirmation action to mark an item Returned';
      END IF;
      IF NEW.status NOT IN ('Available', 'Claim Requested', 'Claim Approved', 'Closed') THEN
        RAISE EXCEPTION 'Invalid status transition to %', NEW.status;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_item_returned(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.item_reports%ROWTYPE;
  v_claim public.claims%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_item FROM public.item_reports WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

  IF v_item.reporter_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the item reporter or an administrator can confirm item handover';
  END IF;

  IF v_item.status = 'Returned' THEN
    RAISE EXCEPTION 'Item is already marked as Returned';
  END IF;

  IF v_item.report_type = 'found' AND v_item.status <> 'Claim Approved' THEN
    RAISE EXCEPTION 'Approve a claim first before confirming handover';
  END IF;

  PERFORM set_config('app.bypass_status_guard', 'true', true);
  UPDATE public.item_reports SET status = 'Returned' WHERE id = v_item.id;

  SELECT * INTO v_claim
  FROM public.claims
  WHERE item_id = v_item.id AND status IN ('Approved', 'Handover Pending')
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.claims
    SET status = 'Completed',
        finder_confirmed = true,
        claimant_confirmed = true,
        completed_at = now(),
        history = history || jsonb_build_array(jsonb_build_object('status', 'Completed', 'at', now(), 'note', 'Finder confirmed item handed over'))
    WHERE id = v_claim.id;

    INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
    VALUES (
      v_claim.claimant_id,
      false,
      'claim',
      'Item Returned: ' || v_item.title,
      'The finder confirmed the item has been handed over. Listing is now marked Returned.',
      'dashboard'
    );
  END IF;

  PERFORM public.write_audit_log(auth.uid(), 'ITEM_RETURN_CONFIRMED', 'item_report', v_item.id::text, jsonb_build_object('claim_id', v_claim.id));
  RETURN jsonb_build_object('ok', true, 'status', 'Returned');
END;
$$;

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
    PERFORM set_config('app.bypass_status_guard', 'true', true);
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
