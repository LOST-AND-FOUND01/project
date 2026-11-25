# FOUNDIT — Phase A Audit & Phase B Database Architecture Plan

## Phase A: Existing Frontend & Configuration Audit

### 1. Current Project Configuration
- **Directory:** `A:\lavanya`
- **Structure:** `frontend/` (Vanilla HTML/CSS/ES6 JS, no bundler or framework dependencies), `backups/original-community/` (untouched reference clone), `docs/`, `tests/`.
- **Existing Dependencies / Backend:** None (`package.json`, `.env`, and `supabase/` do not exist yet).
- **Local Tooling Detected:** `node v26.7.0`, `npm 11.19.0`, `supabase` CLI (`C:\Users\Asus\AppData\Roaming\npm\supabase.cmd`), `Docker 29.9.2`.

### 2. Frontend Features Requiring Backend Integration
| Feature Module | Current Mock Implementation | Target Supabase Integration |
|---|---|---|
| `authPage.js` | `DEMO_USERS` + simulated OTP/reset in `localStorage` | Supabase Auth (`signUp`, `signInWithPassword`, `signOut`, email verification, `resetPasswordForEmail`, `updateUser`, `onAuthStateChange`) + `profiles` & `user_roles` |
| `homePage.js` & `browsePage.js` | `DEMO_ITEMS` array filtered in memory | `item_reports` + `item_images` (signed URLs) + active `notifications` (`category = 'announcement'`) |
| `reportPage.js` | Base64 `FileReader` in `localStorage` | Insert into `item_reports` + upload binary to private `item-photos` bucket + metadata row in `item_images` |
| `itemCard.js` | Local `submitClaim` & `flagItem` | Insert into `claims` + `flag_item` RPC |
| `studentDashboard.js` | Local filtering by `email`, `confirmHandover`, `updateProfile` | RLS-scoped `item_reports`, `claims`, `notifications`, `profiles`, plus `confirm_handover` RPC |
| `adminDashboard.js` | Client-side `role === "admin"` check | Server-side `is_admin()` RLS + `SECURITY DEFINER` RPCs / Edge Functions writing to `admin_audit_logs` |
| `navbar.js` | Local notifications array | Real-time/fetched `notifications` + per-user read tracking |
| `aiAssistant.js` | Local mock replies | **Excluded in Phase 2** (remains mock until Phase 3 AI integration) |

---

## Phase B: Database Architecture & Security Design

### Normalized Tables (`public` schema)
1. **`profiles`** — Linked 1:1 to `auth.users(id)`. Stores `full_name`, `usn`, `email` (synced from `auth.users`), `department`, `phone`, `email_verified`, `account_status` (`Active`/`Suspended`). Never stores passwords.
2. **`user_roles`** — Linked to `auth.users(id)` (`student` | `admin`). Auto-seeded with `student` on signup; client inserts/updates/deletes blocked by RLS.
3. **`item_reports`** — Lost & found reports with `reporter_id`, `title`, `report_type`, `category`, `colour`, `location`, `incident_date`, `description`, `is_anonymous`, `status`, `is_flagged`, `flag_reason`.
4. **`item_images`** — Image metadata (`item_id`, `uploader_id`, `storage_bucket`, `storage_path`, `mime_type`, `byte_size`) pointing to private Supabase Storage (`item-photos`).
5. **`claims`** — Ownership claims (`item_id`, `claimant_id`, `ownership_explanation`, `handover_preference`, `status`, `admin_note`, `finder_confirmed`, `claimant_confirmed`, `history`). Partial unique index prevents duplicate active claims per `(item_id, claimant_id)`.
6. **`notifications`** — Personal and campus-wide announcement notifications (`user_id`, `is_broadcast`, `category`, `title`, `message`, `action_page`, `is_read`) + `notification_reads` join table for broadcast read-state.
7. **`admin_audit_logs`** — Append-only administrative & security audit trail (`actor_id`, `actor_email`, `action`, `target_type`, `target_id`, `details`). Readable only by admins; writable only via trusted server-side functions.

### Security & Storage Summary
- RLS enabled on **all** tables; least-privilege grants (`REVOKE ALL` from `anon`/`authenticated` on sensitive RPCs where appropriate).
- All `SECURITY DEFINER` functions enforce `SET search_path = public, auth` and explicit `auth.uid()` / `public.is_admin()` checks.
- Private `item-photos` Storage bucket (`2 MB` max, JPEG/PNG/WebP only), path-scoped to `<user_id>/<item_id>/<filename>`, retrieved via short-lived signed URLs.
- Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` (publishable key) are ever used in browser config; `SERVICE_ROLE_KEY` is never exposed to frontend files.
