-- FOUNDIT Phase 4 Migration 5: Enable Supabase Realtime for Claims, Notifications & Item Reports
-- Safe & idempotent: adds tables to supabase_realtime publication only if not already present.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'item_reports'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.item_reports;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'claims'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.claims;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
  END IF;
END
$$;
