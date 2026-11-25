-- FOUNDIT Phase B Migration 1: Core Normalized Schema, Constraints & Indexes
-- Note: Uses Supabase auth.users for identity; never stores passwords in public tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 2 AND 120),
  usn text,
  email text NOT NULL,
  department text NOT NULL DEFAULT 'General',
  phone text NOT NULL DEFAULT '',
  email_verified boolean NOT NULL DEFAULT false,
  account_status text NOT NULL DEFAULT 'Active' CHECK (account_status IN ('Active', 'Suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email_lower
  ON public.profiles (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_usn_upper
  ON public.profiles (upper(trim(usn)))
  WHERE usn IS NOT NULL AND trim(usn) <> '';

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'admin')),
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);

CREATE TRIGGER trg_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. item_reports
CREATE TABLE IF NOT EXISTS public.item_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 100),
  report_type text NOT NULL CHECK (report_type IN ('lost', 'found')),
  category text NOT NULL CHECK (category IN ('Electronics', 'Accessories', 'Documents', 'Books', 'Keys & ID Cards', 'Other')),
  colour text NOT NULL DEFAULT '',
  location text NOT NULL CHECK (location IN ('Academic Block', 'Library', 'Computer Labs', 'Canteen', 'Auditorium', 'Playground', 'Parking Area')),
  incident_date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  is_anonymous boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Under Review', 'Handover Pending', 'Returned', 'Archived')),
  is_flagged boolean NOT NULL DEFAULT false,
  flag_reason text NOT NULL DEFAULT '',
  flagged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_reports_reporter ON public.item_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_item_reports_filter ON public.item_reports (report_type, category, location, status);
CREATE INDEX IF NOT EXISTS idx_item_reports_created ON public.item_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_reports_flagged ON public.item_reports (is_flagged) WHERE is_flagged = true;

CREATE TRIGGER trg_item_reports_updated_at
  BEFORE UPDATE ON public.item_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. item_images
CREATE TABLE IF NOT EXISTS public.item_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.item_reports(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'item-photos' CHECK (storage_bucket = 'item-photos'),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_images_item ON public.item_images (item_id);
CREATE INDEX IF NOT EXISTS idx_item_images_uploader ON public.item_images (uploader_id);

CREATE TRIGGER trg_item_images_updated_at
  BEFORE UPDATE ON public.item_images
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. claims
CREATE TABLE IF NOT EXISTS public.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.item_reports(id) ON DELETE CASCADE,
  claimant_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ownership_explanation text NOT NULL CHECK (char_length(trim(ownership_explanation)) BETWEEN 10 AND 1000),
  handover_preference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Handover Pending', 'Completed', 'Rejected')),
  admin_note text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  finder_confirmed boolean NOT NULL DEFAULT false,
  claimant_confirmed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_claim_per_user_item
  ON public.claims (item_id, claimant_id)
  WHERE status <> 'Rejected';

CREATE INDEX IF NOT EXISTS idx_claims_item ON public.claims (item_id);
CREATE INDEX IF NOT EXISTS idx_claims_claimant ON public.claims (claimant_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON public.claims (status);

CREATE TRIGGER trg_claims_updated_at
  BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. notifications (plus broadcast read receipts)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  is_broadcast boolean NOT NULL DEFAULT false,
  category text NOT NULL CHECK (category IN ('claim', 'report', 'verification', 'announcement')),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 2 AND 160),
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 2 AND 1000),
  action_page text NOT NULL DEFAULT 'dashboard',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notification_target CHECK (
    (is_broadcast = true AND user_id IS NULL) OR
    (is_broadcast = false AND user_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast ON public.notifications (is_broadcast, created_at DESC) WHERE is_broadcast = true;

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. admin_audit_logs
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text NOT NULL DEFAULT '',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.admin_audit_logs (actor_id);

CREATE TRIGGER trg_admin_audit_logs_updated_at
  BEFORE UPDATE ON public.admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
