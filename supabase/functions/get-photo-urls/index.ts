// FOUNDIT — Edge Function: Safe Signed URL Generator for Private 'item-photos' Bucket
// Ensures private storage bucket stays non-public while safely serving non-archived listing photos.

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

  let callerId: string | null = null;
  let callerIsAdmin = false;

  const adminClient = createClient(supabaseUrl, serviceKey);

  if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data } = await userClient.auth.getUser();
    if (data?.user) {
      callerId = data.user.id;
      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", callerId)
        .eq("role", "admin")
        .maybeSingle();
      callerIsAdmin = Boolean(roleRow);
    }
  }

  let body: { itemIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.filter((x) => typeof x === "string").slice(0, 60)
    : [];

  if (itemIds.length === 0) return json({ urls: {} });

  const { data: rows, error } = await adminClient
    .from("item_images")
    .select("item_id, storage_path, item_reports!inner(status, reporter_id)")
    .in("item_id", itemIds);

  if (error) return json({ error: error.message }, 500);

  const allowedRows = (rows ?? []).filter((row) => {
    const rep = Array.isArray(row.item_reports) ? row.item_reports[0] : row.item_reports;
    if (!rep) return false;
    if (rep.status !== "Archived") return true;
    return callerIsAdmin || (callerId && rep.reporter_id === callerId);
  });

  const urls: Record<string, string> = {};
  if (allowedRows.length > 0) {
    const paths = allowedRows.map((r) => r.storage_path);
    const { data: signed, error: signErr } = await adminClient.storage
      .from("item-photos")
      .createSignedUrls(paths, 600);
    if (!signErr && signed) {
      signed.forEach((entry, idx) => {
        if (entry?.signedUrl) {
          urls[allowedRows[idx].item_id] = entry.signedUrl;
        }
      });
    }
  }

  return json({ urls });
});
