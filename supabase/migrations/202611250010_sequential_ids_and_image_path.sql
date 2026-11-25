-- FOUNDIT Migration 10: Sequential Auto-Increment IDs (seq_id) across all tables,
-- persistent image_path on item_reports, and strict own-item sighting guard.
-- Preserves all existing rows, UUID primary keys, and foreign key relationships.

-- 1. Persistent image_path column on item_reports (linked to private item-photos bucket)
ALTER TABLE public.item_reports
  ADD COLUMN IF NOT EXISTS image_path text NOT NULL DEFAULT '';

-- Backfill image_path from existing item_images records if any
UPDATE public.item_reports ir
SET image_path = ii.storage_path
FROM public.item_images ii
WHERE ii.item_id = ir.id
  AND (ir.image_path IS NULL OR ir.image_path = '');

-- 2. Prevent users from posting sightings on their own items at DB RLS level
DROP POLICY IF EXISTS "item_sightings_insert_active_authenticated" ON public.item_sightings;
CREATE POLICY "item_sightings_insert_active_authenticated"
  ON public.item_sightings FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_active_user()
    AND EXISTS (
      SELECT 1 FROM public.item_reports ir
      WHERE ir.id = item_id
        AND ir.status IN ('Available', 'Claim Requested')
        AND ir.reporter_id <> auth.uid()
    )
  );

-- 3. Add auto-incrementing sequential seq_id (1, 2, 3...) to all core tables
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'profiles',
    'user_roles',
    'item_reports',
    'item_images',
    'claims',
    'item_sightings',
    'item_conversations',
    'chat_messages',
    'notifications',
    'admin_audit_logs'
  ];
  v_tbl text;
  v_seq text;
  v_max bigint;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    v_seq := format('public.%I_seq_id_seq', v_tbl);

    -- Add seq_id column if missing
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS seq_id bigint', v_tbl);

    -- Create dedicated sequence if missing
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %s START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1', v_seq);

    -- Backfill existing rows sequentially in chronological order without collisions
    EXECUTE format($q$
      WITH max_existing AS (
        SELECT COALESCE(MAX(seq_id), 0) AS m FROM public.%I
      ),
      to_fill AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
        FROM public.%I
        WHERE seq_id IS NULL
      )
      UPDATE public.%I t
      SET seq_id = (SELECT m FROM max_existing) + to_fill.rn
      FROM to_fill
      WHERE t.id = to_fill.id
    $q$, v_tbl, v_tbl, v_tbl);

    -- Attach sequence default, NOT NULL, and UNIQUE constraint
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN seq_id SET DEFAULT nextval(%L)', v_tbl, v_seq);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN seq_id SET NOT NULL', v_tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_tbl)::regclass
        AND conname = format('uq_%s_seq_id', v_tbl)
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (seq_id)', v_tbl, format('uq_%s_seq_id', v_tbl));
    END IF;

    -- Sync sequence next value to MAX(seq_id) + 1
    EXECUTE format('SELECT COALESCE(MAX(seq_id), 0) FROM public.%I', v_tbl) INTO v_max;
    IF v_max = 0 THEN
      EXECUTE format('SELECT setval(%L, 1, false)', v_seq);
    ELSE
      EXECUTE format('SELECT setval(%L, %s, true)', v_seq, v_max);
    END IF;
  END LOOP;
END
$$;

-- 4. Update public_item_listings view to expose seq_id and image_path
DROP VIEW IF EXISTS public.public_item_listings;
CREATE VIEW public.public_item_listings AS
SELECT
  ir.id,
  ir.seq_id,
  ir.title,
  ir.report_type,
  ir.category,
  ir.colour,
  ir.location,
  ir.specific_location,
  ir.incident_date,
  ir.description,
  ir.image_path,
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

-- 5. Update get_my_claims_with_finder to expose claim seq_id & item seq_id
DROP FUNCTION IF EXISTS public.get_my_claims_with_finder();
CREATE FUNCTION public.get_my_claims_with_finder()
RETURNS TABLE (
  id uuid,
  seq_id bigint,
  item_id uuid,
  item_seq_id bigint,
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
    cl.seq_id,
    cl.item_id,
    ir.seq_id AS item_seq_id,
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
  ORDER BY cl.seq_id DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_claims_with_finder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_claims_with_finder() TO authenticated;
