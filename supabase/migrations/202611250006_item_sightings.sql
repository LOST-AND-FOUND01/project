-- FOUNDIT Migration 6: Community Sightings / Found-It Messages on Lost & Found Items

CREATE TABLE IF NOT EXISTS public.item_sightings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.item_reports(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status_type text NOT NULL CHECK (status_type IN ('found_it', 'spotted_it', 'info')),
  found_location text NOT NULL CHECK (found_location IN ('Academic Block', 'Library', 'Computer Labs', 'Canteen', 'Auditorium', 'Playground', 'Parking Area')),
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 3 AND 600),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_sightings_item
  ON public.item_sightings (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_item_sightings_sender
  ON public.item_sightings (sender_id);

CREATE TRIGGER trg_item_sightings_updated_at
  BEFORE UPDATE ON public.item_sightings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.item_sightings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.item_sightings FROM anon;

CREATE POLICY "item_sightings_select_authenticated"
  ON public.item_sightings FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id
        AND (ir.status <> 'Archived' OR ir.reporter_id = auth.uid() OR public.is_admin())
    )
  );

CREATE POLICY "item_sightings_insert_active_authenticated"
  ON public.item_sightings FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id AND ir.status = 'Open'
    )
  );

CREATE POLICY "item_sightings_delete_own_or_admin"
  ON public.item_sightings FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.is_admin());

-- Safe view exposing sender display name without leaking private email/phone
CREATE OR REPLACE VIEW public.public_item_sightings AS
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
WHERE ir.status <> 'Archived'
   OR ir.reporter_id = auth.uid()
   OR public.is_admin();

REVOKE ALL ON public.public_item_sightings FROM anon;
GRANT SELECT ON public.public_item_sightings TO authenticated;

-- Notify the item owner automatically whenever someone posts a sighting/found message
CREATE OR REPLACE FUNCTION public.notify_owner_on_sighting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.item_reports%ROWTYPE;
  v_sender_name text;
  v_label text;
BEGIN
  SELECT * INTO v_item FROM public.item_reports WHERE id = NEW.item_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_item.reporter_id <> NEW.sender_id THEN
    SELECT COALESCE(full_name, 'A campus member') INTO v_sender_name
    FROM public.profiles WHERE id = NEW.sender_id;

    v_label := CASE NEW.status_type
      WHEN 'found_it' THEN 'found this item'
      WHEN 'spotted_it' THEN 'spotted this item'
      ELSE 'posted an update'
    END;

    INSERT INTO public.notifications (user_id, is_broadcast, category, title, message, action_page)
    VALUES (
      v_item.reporter_id,
      false,
      'report',
      'Sighting update: ' || v_item.title,
      v_sender_name || ' ' || v_label || ' at ' || NEW.found_location || ': "' || left(NEW.message, 160) || '"',
      'dashboard'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_owner_on_sighting ON public.item_sightings;
CREATE TRIGGER trg_notify_owner_on_sighting
  AFTER INSERT ON public.item_sightings
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_sighting();

-- Enable Realtime for item_sightings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'item_sightings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.item_sightings;
    END IF;
  END IF;
END
$$;
