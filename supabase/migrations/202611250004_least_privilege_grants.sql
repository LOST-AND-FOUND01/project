-- FOUNDIT Phase C Migration 4: Explicit Least-Privilege Table Grants
-- Revokes anonymous access from private application tables while preserving RLS.

REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.user_roles FROM anon;
REVOKE ALL ON TABLE public.claims FROM anon;
REVOKE ALL ON TABLE public.item_images FROM anon;
REVOKE ALL ON TABLE public.notification_reads FROM anon;
REVOKE ALL ON TABLE public.admin_audit_logs FROM anon;

-- Ensure anon can only read public listings and public broadcast announcements
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.item_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications FROM anon;
