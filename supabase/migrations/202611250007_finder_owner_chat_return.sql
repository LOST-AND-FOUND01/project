-- FOUNDIT Migration 7: Finder/Owner Roles, Status Lifecycle, Finder Claim Approval, Private Chat & Return Confirmation
-- Safe & non-destructive: preserves all existing rows and maps legacy statuses cleanly.

-- 1. Add optional specific_location to item_reports
ALTER TABLE public.item_reports
  ADD COLUMN IF NOT EXISTS specific_location text NOT NULL DEFAULT '';

ALTER TABLE public.item_reports
  DROP CONSTRAINT IF EXISTS chk_item_reports_specific_location_len;
ALTER TABLE public.item_reports
  ADD CONSTRAINT chk_item_reports_specific_location_len CHECK (char_length(specific_location) <= 200);

-- 2. Safely migrate item_reports.status to: Available | Claim Requested | Claim Approved | Returned | Closed
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.item_reports'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.item_reports DROP CONSTRAINT %I', v_conname);
  END LOOP;
END
$$;

UPDATE public.item_reports
SET status = CASE status
  WHEN 'Open' THEN 'Available'
  WHEN 'Under Review' THEN 'Claim Requested'
  WHEN 'Handover Pending' THEN 'Claim Approved'
  WHEN 'Archived' THEN 'Closed'
  ELSE status
END
WHERE status IN ('Open', 'Under Review', 'Handover Pending', 'Archived');

ALTER TABLE public.item_reports
  ALTER COLUMN status SET DEFAULT 'Available';

ALTER TABLE public.item_reports
  ADD CONSTRAINT item_reports_status_check
  CHECK (status IN ('Available', 'Claim Requested', 'Claim Approved', 'Returned', 'Closed'));

-- 3. Recreate public_item_listings view exposing specific_location (still hiding anonymous reporter & contact info)
DROP VIEW IF EXISTS public.public_item_listings;
CREATE VIEW public.public_item_listings AS
SELECT
  ir.id,
  ir.title,
  ir.report_type,
  ir.category,
  ir.colour,
  ir.location,
  ir.specific_location,
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
WHERE ir.status <> 'Closed'
   OR ir.reporter_id = auth.uid()
   OR public.is_admin();

GRANT SELECT ON public.public_item_listings TO anon, authenticated;

-- 4. Update item_reports RLS policies & guard trigger for new statuses
DROP POLICY IF EXISTS "item_reports_select_public_non_archived" ON public.item_reports;
CREATE POLICY "item_reports_select_public_non_closed"
  ON public.item_reports FOR SELECT TO anon, authenticated
  USING (status <> 'Closed' OR reporter_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "item_reports_insert_authenticated_active" ON public.item_reports;
CREATE POLICY "item_reports_insert_authenticated_active"
  ON public.item_reports FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = auth.uid()
    AND public.is_active_user()
    AND status = 'Available'
    AND is_flagged = false
  );

DROP POLICY IF EXISTS "item_reports_delete_own_or_admin" ON public.item_reports;
CREATE POLICY "item_reports_delete_own_or_admin"
  ON public.item_reports FOR DELETE TO authenticated
  USING ((reporter_id = auth.uid() AND status IN ('Available', 'Claim Requested')) OR public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_item_report_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    NEW.reporter_id := OLD.reporter_id;
    NEW.is_flagged := OLD.is_flagged;
    NEW.flag_reason := OLD.flag_reason;
    NEW.flagged_by := OLD.flagged_by;
    IF NEW.status <> OLD.status THEN
      -- Finders/owners can update status between Available, Claim Approved, Closed; Returned must use confirm_item_returned/confirm_handover
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

-- Update sightings RLS policies for new statuses
DROP POLICY IF EXISTS "item_sightings_select_authenticated" ON public.item_sightings;
CREATE POLICY "item_sightings_select_authenticated"
  ON public.item_sightings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id
        AND (ir.status <> 'Closed' OR ir.reporter_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS "item_sightings_insert_active_authenticated" ON public.item_sightings;
CREATE POLICY "item_sightings_insert_active_authenticated"
  ON public.item_sightings FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id AND ir.status IN ('Available', 'Claim Requested')
    )
  );

DROP VIEW IF EXISTS public.public_item_sightings;
CREATE VIEW public.public_item_sightings AS
SELECT
  s.id,
  s.item_id,
  s.sender_id,
  COALESCE(p.full_name, 'Campus member') AS sender_name,
  s.status_type,
  s.found_location,
  s.message,
  s.created_at
FROM public.item_sightings s
JOIN public.item_reports ir ON ir.id = s.item_id
LEFT JOIN public.profiles p ON p.id = s.sender_id
WHERE ir.status <> 'Closed'
   OR ir.reporter_id = auth.uid()
   OR public.is_admin();

REVOKE ALL ON public.public_item_sightings FROM anon;
GRANT SELECT ON public.public_item_sightings TO authenticated;

-- 5. Update claims INSERT policy & auto-transition item to 'Claim Requested' + notify Finder
DROP POLICY IF EXISTS "claims_insert_authenticated_non_owner" ON public.claims;
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
        AND ir.status IN ('Available', 'Claim Requested')
        AND ir.reporter_id <> auth.uid()
    )
  );

-- Allow at most one approved/completed claim per item
CREATE UNIQUE INDEX IF NOT EXISTS uq_approved_claim_per_item
  ON public.claims (item_id)
  WHERE status IN ('Approved', 'Handover Pending', 'Completed');

CREATE OR REPLACE FUNCTION public.on_claim_created_notify_finder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.item_reports%ROWTYPE;
  v_claimant_name text;
BEGIN
  SELECT * INTO v_item FROM public.item_reports WHERE id = NEW.item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_item.status = 'Available' THEN
    UPDATE public.item_reports SET status = 'Claim Requested' WHERE id = v_item.id;
  END IF;

  SELECT COALESCE(full_name, 'A student') INTO v_claimant_name FROM public.profiles WHERE id = NEW.claimant_id;

  INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
  VALUES (
    v_item.reporter_id,
    false,
    'claim',
    'New claim request: ' || v_item.title,
    v_claimant_name || ' submitted a claim request. Review and approve or reject in My Dashboard.',
    'dashboard'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_claim_created_notify_finder ON public.claims;
CREATE TRIGGER trg_on_claim_created_notify_finder
  AFTER INSERT ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.on_claim_created_notify_finder();

-- 6. Private Finder-Owner Chat Tables
CREATE TABLE IF NOT EXISTS public.item_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.item_reports(id) ON DELETE CASCADE,
  claim_id uuid NOT NULL UNIQUE REFERENCES public.claims(id) ON DELETE CASCADE,
  finder_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_conversation_distinct_users CHECK (finder_id <> claimant_id)
);

CREATE INDEX IF NOT EXISTS idx_item_conversations_finder ON public.item_conversations (finder_id);
CREATE INDEX IF NOT EXISTS idx_item_conversations_claimant ON public.item_conversations (claimant_id);

CREATE TRIGGER trg_item_conversations_updated_at
  BEFORE UPDATE ON public.item_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.item_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1000),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages (conversation_id, created_at ASC);

CREATE TRIGGER trg_chat_messages_updated_at
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.item_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.item_conversations FROM anon;
REVOKE ALL ON TABLE public.chat_messages FROM anon;

CREATE POLICY "conversations_select_participants_or_admin"
  ON public.item_conversations FOR SELECT TO authenticated
  USING (finder_id = auth.uid() OR claimant_id = auth.uid() OR public.is_admin());

CREATE POLICY "chat_messages_select_participants_or_admin"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.item_conversations c
      WHERE c.id = conversation_id
        AND (c.finder_id = auth.uid() OR c.claimant_id = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY "chat_messages_insert_participants"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1
      FROM public.item_conversations c
      JOIN public.claims cl ON cl.id = c.claim_id
      WHERE c.id = conversation_id
        AND (c.finder_id = auth.uid() OR c.claimant_id = auth.uid())
        AND cl.status IN ('Approved', 'Handover Pending', 'Completed')
    )
  );

CREATE POLICY "chat_messages_mark_read_recipient"
  ON public.chat_messages FOR UPDATE TO authenticated
  USING (
    sender_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.item_conversations c
      WHERE c.id = conversation_id
        AND (c.finder_id = auth.uid() OR c.claimant_id = auth.uid())
    )
  )
  WITH CHECK (
    sender_id <> auth.uid()
    AND is_read = true
  );

-- Notify recipient when a new private chat message is sent
CREATE OR REPLACE FUNCTION public.on_chat_message_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv public.item_conversations%ROWTYPE;
  v_item_title text;
  v_sender_name text;
  v_recipient uuid;
BEGIN
  SELECT * INTO v_conv FROM public.item_conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_recipient := CASE WHEN NEW.sender_id = v_conv.finder_id THEN v_conv.claimant_id ELSE v_conv.finder_id END;
  SELECT title INTO v_item_title FROM public.item_reports WHERE id = v_conv.item_id;
  SELECT COALESCE(full_name, 'Campus member') INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
  VALUES (
    v_recipient,
    false,
    'claim',
    'New message about: ' || COALESCE(v_item_title, 'Item'),
    v_sender_name || ': ' || left(NEW.body, 140),
    'dashboard'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_chat_message_notify ON public.chat_messages;
CREATE TRIGGER trg_on_chat_message_notify
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.on_chat_message_notify();

-- 7. Finder RPC: Approve or Reject a Claim (Server-Side Authorized)
CREATE OR REPLACE FUNCTION public.finder_decide_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.claims%ROWTYPE;
  v_item public.item_reports%ROWTYPE;
  v_conv_id uuid;
  v_pending_left integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_decision NOT IN ('Approved', 'Rejected') THEN
    RAISE EXCEPTION 'Decision must be Approved or Rejected';
  END IF;

  SELECT * INTO v_claim FROM public.claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;

  SELECT * INTO v_item FROM public.item_reports WHERE id = v_claim.item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;

  IF v_item.reporter_id <> auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only the finder of this item or an administrator can review claims';
  END IF;

  IF v_claim.claimant_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot approve or reject your own claim';
  END IF;

  IF v_item.status IN ('Returned', 'Closed') THEN
    RAISE EXCEPTION 'Item is already % and claims can no longer be modified', v_item.status;
  END IF;

  IF v_claim.status <> 'Pending' THEN
    RAISE EXCEPTION 'This claim has already been processed (%)', v_claim.status;
  END IF;

  UPDATE public.claims
  SET status = p_decision,
      admin_note = left(COALESCE(p_note, ''), 400),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      history = history || jsonb_build_array(
        jsonb_build_object(
          'status', p_decision,
          'at', now(),
          'note', COALESCE(NULLIF(trim(p_note), ''), CASE WHEN public.is_admin() THEN 'Reviewed by Administrator' ELSE 'Reviewed by Finder' END)
        )
      )
  WHERE id = p_claim_id;

  IF p_decision = 'Approved' THEN
    -- Keep item in Claim Approved (NOT Returned until physical handover confirmation!)
    UPDATE public.item_reports SET status = 'Claim Approved' WHERE id = v_item.id;

    -- Auto-reject any competing pending claims cleanly
    INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
    SELECT c.claimant_id, false, 'claim', 'Claim Rejected: ' || v_item.title, 'Another claimant was approved by the finder.', 'dashboard'
    FROM public.claims c
    WHERE c.item_id = v_item.id AND c.id <> p_claim_id AND c.status = 'Pending';

    UPDATE public.claims
    SET status = 'Rejected',
        admin_note = 'Another claim was approved by the finder.',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        history = history || jsonb_build_array(jsonb_build_object('status', 'Rejected', 'at', now(), 'note', 'Another claim was approved'))
    WHERE item_id = v_item.id AND id <> p_claim_id AND status = 'Pending';

    -- Open private finder-owner chat conversation
    INSERT INTO public.item_conversations (item_id, claim_id, finder_id, claimant_id)
    VALUES (v_item.id, v_claim.id, v_item.reporter_id, v_claim.claimant_id)
    ON CONFLICT (claim_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_conv_id;

    INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
    VALUES (
      v_claim.claimant_id,
      false,
      'claim',
      'Claim Approved: ' || v_item.title,
      'The finder approved your claim! Use the private Finder–Owner Chat in My Dashboard to coordinate collection.',
      'dashboard'
    );

    PERFORM public.write_audit_log(auth.uid(), 'FINDER_CLAIM_APPROVED', 'claim', p_claim_id::text, jsonb_build_object('item_id', v_item.id));
  ELSE
    SELECT count(*) INTO v_pending_left FROM public.claims WHERE item_id = v_item.id AND status = 'Pending';
    UPDATE public.item_reports
    SET status = CASE WHEN v_pending_left > 0 THEN 'Claim Requested' ELSE 'Available' END
    WHERE id = v_item.id;

    INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
    VALUES (
      v_claim.claimant_id,
      false,
      'claim',
      'Claim Rejected: ' || v_item.title,
      'Your claim was rejected.' || CASE WHEN trim(COALESCE(p_note, '')) <> '' THEN ' Note: ' || trim(p_note) ELSE '' END,
      'dashboard'
    );

    PERFORM public.write_audit_log(auth.uid(), 'FINDER_CLAIM_REJECTED', 'claim', p_claim_id::text, jsonb_build_object('item_id', v_item.id, 'note', p_note));
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision, 'conversation_id', v_conv_id);
END;
$$;

REVOKE ALL ON FUNCTION public.finder_decide_claim(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finder_decide_claim(uuid, text, text) TO authenticated;

-- 8. Finder/Owner Return Confirmation RPC ("Confirm Item Handed Over")
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

REVOKE ALL ON FUNCTION public.confirm_item_returned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_item_returned(uuid) TO authenticated;

-- Update admin_decide_claim & confirm_handover to stay aligned with Claim Approved / Returned + conversation creation
CREATE OR REPLACE FUNCTION public.admin_decide_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator authorization required';
  END IF;
  PERFORM public.finder_decide_claim(p_claim_id, p_decision, p_note);
END;
$$;

-- Safe RPC to list current user's authorized private conversations (hiding phone/email)
CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS TABLE (
  id uuid,
  item_id uuid,
  claim_id uuid,
  item_title text,
  item_location text,
  item_specific_location text,
  item_status text,
  claim_status text,
  finder_id uuid,
  claimant_id uuid,
  other_user_name text,
  my_role text,
  unread_count bigint,
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.item_id,
    c.claim_id,
    ir.title AS item_title,
    ir.location AS item_location,
    ir.specific_location AS item_specific_location,
    ir.status AS item_status,
    cl.status AS claim_status,
    c.finder_id,
    c.claimant_id,
    CASE WHEN c.finder_id = auth.uid() THEN COALESCE(pc.full_name, 'Claimant') ELSE COALESCE(pf.full_name, 'Finder') END AS other_user_name,
    CASE WHEN c.finder_id = auth.uid() THEN 'finder' ELSE 'claimant' END AS my_role,
    (SELECT count(*) FROM public.chat_messages cm WHERE cm.conversation_id = c.id AND cm.sender_id <> auth.uid() AND cm.is_read = false) AS unread_count,
    (SELECT cm.body FROM public.chat_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message,
    (SELECT cm.created_at FROM public.chat_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message_at,
    c.created_at
  FROM public.item_conversations c
  JOIN public.item_reports ir ON ir.id = c.item_id
  JOIN public.claims cl ON cl.id = c.claim_id
  LEFT JOIN public.profiles pf ON pf.id = c.finder_id
  LEFT JOIN public.profiles pc ON pc.id = c.claimant_id
  WHERE c.finder_id = auth.uid() OR c.claimant_id = auth.uid()
  ORDER BY COALESCE((SELECT cm.created_at FROM public.chat_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1), c.created_at) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

-- 8. Enable Realtime on item_conversations and chat_messages
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'item_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.item_conversations;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END
$$;
