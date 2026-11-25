// FOUNDIT — Trusted Supabase Edge Function: Privileged Admin Operations
// Enforces server-side JWT verification + admin role check + immutable audit logging.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Missing Authorization Bearer token" }, 401);
  }

  // Verify caller identity using their JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "Unauthorized session" }, 401);
  }
  const actor = userData.user;

  // Service-role client for privileged server-side checks & mutations
  const adminClient = createClient(supabaseUrl, serviceKey);

  const { data: roleRow } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", actor.id)
    .eq("role", "admin")
    .maybeSingle();

  const { data: actorProfile } = await adminClient
    .from("profiles")
    .select("account_status")
    .eq("id", actor.id)
    .maybeSingle();

  if (!roleRow || actorProfile?.account_status !== "Active") {
    await adminClient.from("admin_audit_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email ?? "",
      action: "ADMIN_ACCESS_DENIED",
      target_type: "edge_function",
      target_id: "admin-ops",
      details: { reason: "Non-admin or suspended caller" }
    });
    return json({ error: "Forbidden: Administrator role required" }, 403);
  }

  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const action = body.action;
  const payload = body.payload ?? {};

  const logAudit = async (auditAction: string, targetType: string, targetId: string, details: Record<string, unknown> = {}) => {
    await adminClient.from("admin_audit_logs").insert({
      actor_id: actor.id,
      actor_email: actor.email ?? "",
      action: auditAction,
      target_type: targetType,
      target_id: targetId,
      details
    });
  };

  try {
    switch (action) {
      case "get_dashboard_bundle": {
        const [reportsRes, claimsRes, usersRes, rolesRes, logsRes, imagesRes] = await Promise.all([
          adminClient.from("item_reports").select("*").order("created_at", { ascending: false }),
          adminClient.from("claims").select("*, item_reports(title, location)").order("created_at", { ascending: false }),
          adminClient.from("profiles").select("id, full_name, usn, email, department, phone, email_verified, account_status, created_at").order("created_at", { ascending: false }),
          adminClient.from("user_roles").select("user_id, role"),
          adminClient.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(150),
          adminClient.from("item_images").select("item_id, storage_path")
        ]);

        if (reportsRes.error) throw reportsRes.error;
        if (claimsRes.error) throw claimsRes.error;
        if (usersRes.error) throw usersRes.error;
        if (rolesRes.error) throw rolesRes.error;
        if (logsRes.error) throw logsRes.error;

        const photoUrls: Record<string, string> = {};
        const imgRows = imagesRes.data ?? [];
        if (imgRows.length > 0) {
          const { data: signed } = await adminClient.storage
            .from("item-photos")
            .createSignedUrls(imgRows.map((i) => i.storage_path), 600);
          (signed ?? []).forEach((s, idx) => {
            if (s?.signedUrl) photoUrls[imgRows[idx].item_id] = s.signedUrl;
          });
        }

        const roleMap = new Map<string, string>();
        for (const r of rolesRes.data ?? []) {
          if (r.role === "admin" || !roleMap.has(r.user_id)) {
            roleMap.set(r.user_id, r.role);
          }
        }

        const users = (usersRes.data ?? []).map((u) => ({
          ...u,
          role: roleMap.get(u.id) ?? "student"
        }));

        const profileMap = new Map(users.map((u) => [u.id, u]));
        const claims = (claimsRes.data ?? []).map((c) => ({
          ...c,
          claimant_name: profileMap.get(c.claimant_id)?.full_name ?? "Student",
          claimant_email: profileMap.get(c.claimant_id)?.email ?? ""
        }));

        const reports = (reportsRes.data ?? []).map((r) => ({
          ...r,
          reporter_email: profileMap.get(r.reporter_id)?.email ?? "",
          reporter_name: profileMap.get(r.reporter_id)?.full_name ?? "Campus member",
          photo_url: photoUrls[r.id] ?? ""
        }));

        return json({ reports, claims, users, auditLogs: logsRes.data ?? [] });
      }

      case "decide_claim": {
        const claimId = String(payload.claimId ?? "");
        const decision = String(payload.decision ?? "");
        const note = String(payload.note ?? "").slice(0, 400);
        if (!claimId || !["Approved", "Rejected"].includes(decision)) {
          return json({ error: "Invalid claimId or decision" }, 400);
        }
        const { data: claim, error: cErr } = await adminClient.from("claims").select("*").eq("id", claimId).single();
        if (cErr || !claim) return json({ error: "Claim not found" }, 404);

        const { data: item } = await adminClient.from("item_reports").select("id, title, reporter_id, status").eq("id", claim.item_id).single();
        if (!item) return json({ error: "Item not found" }, 404);
        if (["Returned", "Closed"].includes(item.status)) {
          return json({ error: `Item is already ${item.status}` }, 400);
        }
        if (claim.status !== "Pending") {
          return json({ error: `Claim already processed (${claim.status})` }, 400);
        }

        const nextHistory = [
          ...(Array.isArray(claim.history) ? claim.history : []),
          { status: decision, at: new Date().toISOString(), note: note || `Reviewed by ${actor.email}` }
        ];

        const { error: updErr } = await adminClient
          .from("claims")
          .update({
            status: decision,
            admin_note: note,
            reviewed_by: actor.id,
            reviewed_at: new Date().toISOString(),
            history: nextHistory
          })
          .eq("id", claimId);
        if (updErr) throw updErr;

        if (decision === "Approved") {
          await adminClient.from("item_reports").update({ status: "Claim Approved" }).eq("id", claim.item_id);
          await adminClient
            .from("item_conversations")
            .upsert(
              { item_id: item.id, claim_id: claimId, finder_id: item.reporter_id, claimant_id: claim.claimant_id },
              { onConflict: "claim_id" }
            );
        } else {
          const { count } = await adminClient
            .from("claims")
            .select("id", { count: "exact", head: true })
            .eq("item_id", item.id)
            .eq("status", "Pending");
          await adminClient
            .from("item_reports")
            .update({ status: (count ?? 0) > 0 ? "Claim Requested" : "Available" })
            .eq("id", item.id);
        }

        await adminClient.from("notifications").insert({
          user_id: claim.claimant_id,
          is_broadcast: false,
          category: "claim",
          title: `Claim ${decision}: ${item?.title ?? "Item"}`,
          message: decision === "Approved"
            ? "Your claim was approved! Open Private Finder–Owner Chat in My Dashboard to coordinate handover."
            : `Your claim was rejected.${note ? " Note: " + note : ""}`,
          action_page: "dashboard"
        });

        await logAudit(`CLAIM_${decision.toUpperCase()}`, "claim", claimId, { item_id: claim.item_id, note });
        return json({ ok: true });
      }

      case "update_report_status": {
        const itemId = String(payload.itemId ?? "");
        const status = String(payload.status ?? "");
        const allowed = ["Available", "Claim Requested", "Claim Approved", "Returned", "Closed"];
        if (!itemId || !allowed.includes(status)) return json({ error: "Invalid status" }, 400);

        const { data: item, error: fErr } = await adminClient.from("item_reports").select("title, reporter_id, status").eq("id", itemId).single();
        if (fErr || !item) return json({ error: "Report not found" }, 404);

        const { error: uErr } = await adminClient.from("item_reports").update({ status }).eq("id", itemId);
        if (uErr) throw uErr;

        await adminClient.from("notifications").insert({
          user_id: item.reporter_id,
          is_broadcast: false,
          category: "report",
          title: `Report updated: ${item.title}`,
          message: `Status changed from ${item.status} to ${status}.`,
          action_page: "dashboard"
        });

        await logAudit("ITEM_STATUS_CHANGED", "item_report", itemId, { from: item.status, to: status });
        return json({ ok: true });
      }

      case "moderate_report": {
        const itemId = String(payload.itemId ?? "");
        const modAction = String(payload.moderationAction ?? "");
        if (!itemId || !["clear", "archive", "delete"].includes(modAction)) {
          return json({ error: "Invalid moderation action" }, 400);
        }

        if (modAction === "clear") {
          const { error } = await adminClient.from("item_reports").update({ is_flagged: false, flag_reason: "", flagged_by: null }).eq("id", itemId);
          if (error) throw error;
          await logAudit("MODERATION_CLEARED", "item_report", itemId);
        } else if (modAction === "archive") {
          const { error } = await adminClient.from("item_reports").update({ is_flagged: false, status: "Closed" }).eq("id", itemId);
          if (error) throw error;
          await logAudit("MODERATION_ARCHIVED", "item_report", itemId);
        } else if (modAction === "delete") {
          // Clean up storage objects if any exist
          const { data: imgs } = await adminClient.from("item_images").select("storage_path").eq("item_id", itemId);
          if (imgs?.length) {
            await adminClient.storage.from("item-photos").remove(imgs.map((x) => x.storage_path));
          }
          const { error } = await adminClient.from("item_reports").delete().eq("id", itemId);
          if (error) throw error;
          await logAudit("ITEM_DELETED", "item_report", itemId);
        }
        return json({ ok: true });
      }

      case "set_user_status": {
        const targetUserId = String(payload.targetUserId ?? "");
        const accountStatus = String(payload.accountStatus ?? "");
        if (!targetUserId || !["Active", "Suspended"].includes(accountStatus)) {
          return json({ error: "Invalid user status" }, 400);
        }
        if (targetUserId === actor.id) {
          return json({ error: "Cannot suspend your own administrator account" }, 400);
        }
        const { error } = await adminClient.from("profiles").update({ account_status: accountStatus }).eq("id", targetUserId);
        if (error) throw error;
        await logAudit("USER_STATUS_CHANGED", "profile", targetUserId, { accountStatus });
        return json({ ok: true });
      }

      case "publish_announcement": {
        const title = String(payload.title ?? "").trim();
        const message = String(payload.message ?? "").trim();
        if (title.length < 2 || message.length < 2) {
          return json({ error: "Title and message are required" }, 400);
        }
        const { data: ann, error } = await adminClient
          .from("notifications")
          .insert({
            user_id: null,
            is_broadcast: true,
            category: "announcement",
            title: title.slice(0, 160),
            message: message.slice(0, 1000),
            action_page: "home"
          })
          .select("id")
          .single();
        if (error) throw error;
        await logAudit("ANNOUNCEMENT_PUBLISHED", "notification", ann.id, { title });
        return json({ ok: true, id: ann.id });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("admin-ops error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
