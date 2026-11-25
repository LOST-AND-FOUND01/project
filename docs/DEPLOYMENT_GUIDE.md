# FOUNDIT — Deployment Readiness & Operations Guide

## 1. Architecture Summary
- **Frontend (`A:\lavanya\frontend\`):** Zero-build static HTML5/CSS3/ES6 JS application (`index.html`, `styles/`, `scripts/`). Connects directly to Supabase via `@supabase/supabase-js@2` using only the public Project URL and `anon` key.
- **Database & Storage (`A:\lavanya\supabase\migrations\`):** 5 applied PostgreSQL migrations covering 7 core tables (`profiles`, `user_roles`, `item_reports`, `item_images`, `claims`, `notifications` + `notification_reads`, `admin_audit_logs`), `public_item_listings` view, RLS policies, `SECURITY DEFINER` RPCs, private `item-photos` bucket, least-privilege grants, and `supabase_realtime` publication.
- **Edge Functions (`A:\lavanya\supabase\functions\`):** `admin-ops` (JWT-verified, server-side admin role enforced) and `get-photo-urls` (signed URLs for non-archived private images).

## 2. Production Configuration Checklist (Supabase Dashboard)
1. **Authentication → URL Configuration:**
   - Set **Site URL** to your production origin (e.g., `https://your-domain.com/`).
   - Add production & preview URLs to **Redirect URLs** (for email confirmation and password reset links).
2. **Authentication → Email / SMTP:**
   - Replace Supabase's built-in SMTP (limited to ~2 emails/hour) with a custom SMTP provider (Resend, SendGrid, Postmark, or SES) before opening student registration to the campus.
3. **Edge Functions → Secrets (CORS Restriction):**
   - Set `ALLOWED_ORIGIN=https://your-domain.com` in Supabase Edge Function secrets so `admin-ops` and `get-photo-urls` restrict CORS to your hosted domain.
4. **Provision First Real Administrator:**
   - Register the admin account through the **Account** tab, then run in **Supabase SQL Editor**:
     ```sql
     INSERT INTO public.user_roles (user_id, role)
     SELECT id, 'admin' FROM auth.users WHERE email = 'admin@jcet.edu'
     ON CONFLICT (user_id, role) DO NOTHING;
     ```
5. **Phase 3 Boundary:**
   - `frontend/scripts/components/aiAssistant.js` currently uses local mock responses (`Phase 3 Pending`). Do not deploy live AI keys to frontend code; connect AI via a Supabase Edge Function in Phase 3.

## 3. Running Locally
```powershell
node A:\lavanya\frontend\serve.js
```
Open `http://127.0.0.1:4173/`.

## 4. Static Deployment Options (When Ready)
Because `A:\lavanya\frontend\` requires no build step, any static host can serve the `frontend/` directory directly:
- **Vercel / Netlify / Cloudflare Pages:** Publish directory = `frontend` (no build command needed).
- **Nginx / Apache / GitHub Pages (with user approval):** Serve `A:\lavanya\frontend\` as static root.
- Always verify `frontend/scripts/config/supabaseConfig.js` contains **only** `url` and `anonKey` (never `service_role` or database passwords).
