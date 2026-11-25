// FOUNDIT — Live Supabase End-to-End & Security Verification Suite
// Tests Student A, Student B, Admin, RLS isolation, Storage policies, Edge Functions, and constraints.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const cfgText = fs.readFileSync(path.join(__dirname, "..", "frontend", "scripts", "config", "supabaseConfig.js"), "utf8");
const urlMatch = cfgText.match(/url:\s*'([^']+)'/);
const keyMatch = cfgText.match(/anonKey:\s*'([^']+)'/);
const SUPABASE_URL = urlMatch[1];
const ANON_KEY = keyMatch[1];
const SERVICE_KEY = process.env.TEST_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing TEST_SERVICE_ROLE_KEY env var for test provisioning.");
  process.exit(1);
}

async function api(endpoint, { method = "GET", key = ANON_KEY, token = null, body = null, headers = {}, isBinary = false } = {}) {
  const hdrs = {
    apikey: key,
    Authorization: `Bearer ${token || key}`,
    ...headers
  };
  if (body && !isBinary && !hdrs["Content-Type"]) {
    hdrs["Content-Type"] = "application/json";
  }
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method,
    headers: hdrs,
    body: body ? (isBinary ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, data: json };
}

(async () => {
  const tag = Date.now();
  const studentAEmail = `foundit.studenta.${tag}@gmail.com`;
  const studentBEmail = `foundit.studentb.${tag}@gmail.com`;
  const adminEmail = `foundit.admin.${tag}@gmail.com`;
  const password = "TestPassword123!";
  const createdUserIds = [];
  let createdItemId = null;

  try {
    // 1. Verify Student registration via public Auth signup (or admin fallback if built-in SMTP hits 429 rate limit)
    let studentBId;
    const regB = await api("/auth/v1/signup", {
      method: "POST",
      body: {
        email: studentBEmail,
        password,
        data: { full_name: "Student B", usn: `2JC23CS${String(tag).slice(-4)}B`, department: "ECE" }
      }
    });
    if (regB.status === 429) {
      console.log("Note: Public /auth/v1/signup hit Supabase built-in SMTP 429 rate limit; provisioning Student B via Admin API for remaining checks.");
      const createB = await api("/auth/v1/admin/users", {
        method: "POST",
        key: SERVICE_KEY,
        body: {
          email: studentBEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: "Student B", usn: `2JC23CS${String(tag).slice(-4)}B`, department: "ECE" }
        }
      });
      assert.ok(createB.ok, `Student B admin create failed: ${JSON.stringify(createB.data)}`);
      studentBId = createB.data.id;
    } else {
      assert.ok(regB.ok, `Public signup failed: ${JSON.stringify(regB.data)}`);
      studentBId = regB.data.user?.id || regB.data.id;
      assert.ok(studentBId, "Student B ID returned on signup");
      await api(`/auth/v1/admin/users/${studentBId}`, {
        method: "PUT",
        key: SERVICE_KEY,
        body: { email_confirm: true }
      });
    }
    createdUserIds.push(studentBId);

    const createA = await api("/auth/v1/admin/users", {
      method: "POST",
      key: SERVICE_KEY,
      body: {
        email: studentAEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Student A", usn: `2JC23CS${String(tag).slice(-4)}A`, department: "CSE" }
      }
    });
    assert.ok(createA.ok, "Student A created");
    const studentAId = createA.data.id;
    createdUserIds.push(studentAId);

    const createAdmin = await api("/auth/v1/admin/users", {
      method: "POST",
      key: SERVICE_KEY,
      body: {
        email: adminEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Campus Admin", usn: `ADM${String(tag).slice(-4)}`, department: "Admin" }
      }
    });
    assert.ok(createAdmin.ok, "Admin created");
    const adminId = createAdmin.data.id;
    createdUserIds.push(adminId);

    // Assign admin role via trusted service key (server-side only)
    const grantAdmin = await api("/rest/v1/user_roles", {
      method: "POST",
      key: SERVICE_KEY,
      body: { user_id: adminId, role: "admin", assigned_by: adminId }
    });
    assert.ok(grantAdmin.ok, `Assign admin role failed: ${JSON.stringify(grantAdmin.data)}`);

    // 2. Login as Student A, Student B, and Admin
    const loginA = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: studentAEmail, password } });
    const loginB = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: studentBEmail, password } });
    const loginAdm = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: adminEmail, password } });
    assert.ok(loginA.ok && loginB.ok && loginAdm.ok, "All 3 accounts logged in cleanly");

    const tokA = loginA.data.access_token;
    const tokB = loginB.data.access_token;
    const tokAdm = loginAdm.data.access_token;

    // 3. Security Check: Student A cannot assign themselves admin role
    const escalate = await api("/rest/v1/user_roles", {
      method: "POST",
      token: tokA,
      body: { user_id: studentAId, role: "admin" }
    });
    assert.strictEqual(escalate.ok, false, "Student A MUST NOT assign themselves admin role");

    // 4. Security Check: Student A cannot read Student B's profile or admin_audit_logs
    const readOtherProfile = await api(`/rest/v1/profiles?id=eq.${studentBId}`, { token: tokA });
    assert.deepStrictEqual(readOtherProfile.data, [], "Student A MUST NOT read Student B profile");

    const readAuditAsStudent = await api("/rest/v1/admin_audit_logs", { token: tokA });
    assert.deepStrictEqual(readAuditAsStudent.data, [], "Student A MUST NOT read admin_audit_logs");

    // 5. Security Check: Student A calling admin-ops Edge Function -> 403 Forbidden
    const studentAdminOps = await api("/functions/v1/admin-ops", {
      method: "POST",
      token: tokA,
      body: { action: "get_dashboard_bundle" }
    });
    assert.strictEqual(studentAdminOps.status, 403, "Non-admin calling admin-ops MUST get 403");

    // 6. Unauthorized (anon) user cannot insert reports or read private profiles/claims
    const anonInsert = await api("/rest/v1/item_reports", {
      method: "POST",
      body: { reporter_id: studentAId, title: "Anon Hack", report_type: "lost", category: "Other", location: "Library" }
    });
    assert.strictEqual(anonInsert.ok, false, "Anon MUST NOT insert item reports");

    const anonClaims = await api("/rest/v1/claims");
    assert.ok(anonClaims.status === 401 || anonClaims.status === 403 || (Array.isArray(anonClaims.data) && anonClaims.data.length === 0), `Anon MUST NOT read claims, got ${anonClaims.status}`);

    // 7. Student A creates Found item + uploads PNG to private item-photos bucket + saves item_images metadata
    const repRes = await api("/rest/v1/item_reports", {
      method: "POST",
      token: tokA,
      headers: { Prefer: "return=representation" },
      body: {
        reporter_id: studentAId,
        title: "E2E Test Wallet",
        report_type: "found",
        category: "Accessories",
        colour: "Brown",
        location: "Library",
        description: "Found near circulation desk"
      }
    });
    assert.ok(repRes.ok && repRes.data.length === 1, `Report insert failed: ${JSON.stringify(repRes.data)}`);
    createdItemId = repRes.data[0].id;

    const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC", "base64");
    const goodPath = `${studentAId}/${createdItemId}/test.png`;
    const upGood = await api(`/storage/v1/object/item-photos/${goodPath}`, {
      method: "POST",
      token: tokA,
      isBinary: true,
      headers: { "Content-Type": "image/png" },
      body: pngBytes
    });
    assert.ok(upGood.ok, `Storage upload failed: ${JSON.stringify(upGood.data)}`);

    // Student B MUST NOT upload into Student A's storage folder
    const upBadFolder = await api(`/storage/v1/object/item-photos/${studentAId}/${createdItemId}/hijack.png`, {
      method: "POST",
      token: tokB,
      isBinary: true,
      headers: { "Content-Type": "image/png" },
      body: pngBytes
    });
    assert.strictEqual(upBadFolder.ok, false, "Student B MUST NOT upload into Student A folder");

    const imgMeta = await api("/rest/v1/item_images", {
      method: "POST",
      token: tokA,
      body: {
        item_id: createdItemId,
        uploader_id: studentAId,
        storage_bucket: "item-photos",
        storage_path: goodPath,
        mime_type: "image/png",
        byte_size: pngBytes.length
      }
    });
    assert.ok(imgMeta.ok, `item_images insert failed: ${JSON.stringify(imgMeta.data)}`);

    // Signed URL retrieval via get-photo-urls Edge Function
    const signedRes = await api("/functions/v1/get-photo-urls", {
      method: "POST",
      body: { itemIds: [createdItemId] }
    });
    assert.ok(signedRes.ok && signedRes.data.urls?.[createdItemId], "Signed URL returned for non-archived photo");

    // 8. Student A cannot claim own item; Student B submits valid claim
    const selfClaim = await api("/rest/v1/claims", {
      method: "POST",
      token: tokA,
      body: { item_id: createdItemId, claimant_id: studentAId, ownership_explanation: "Trying to claim my own item" }
    });
    assert.strictEqual(selfClaim.ok, false, "Reporter MUST NOT claim their own item");

    const claimB = await api("/rest/v1/claims", {
      method: "POST",
      token: tokB,
      headers: { Prefer: "return=representation" },
      body: { item_id: createdItemId, claimant_id: studentBId, ownership_explanation: "Contains my JCET library slip inside" }
    });
    assert.ok(claimB.ok && claimB.data.length === 1, `Student B claim failed: ${JSON.stringify(claimB.data)}`);
    const claimId = claimB.data[0].id;

    // Student B cannot approve their own claim directly via REST
    const selfApprove = await api(`/rest/v1/claims?id=eq.${claimId}`, {
      method: "PATCH",
      token: tokB,
      body: { status: "Approved" }
    });
    // Either 403/401 or 0 rows updated — verify status remains Pending
    const checkPending = await api(`/rest/v1/claims?id=eq.${claimId}`, { token: tokB });
    assert.strictEqual(checkPending.data[0].status, "Pending", "Student B MUST NOT approve their own claim");

    // 9. Admin approves claim via admin-ops Edge Function + Student B receives notification
    const admApprove = await api("/functions/v1/admin-ops", {
      method: "POST",
      token: tokAdm,
      body: { action: "decide_claim", payload: { claimId, decision: "Approved", note: "Matches description" } }
    });
    assert.ok(admApprove.ok, `Admin approve failed: ${JSON.stringify(admApprove.data)}`);

    const notifsB = await api(`/rest/v1/notifications?user_id=eq.${studentBId}`, { token: tokB });
    assert.ok(notifsB.ok && notifsB.data.some((n) => n.category === "claim"), "Student B received claim approval notification");

    // 10. Two-party handover: Student A (finder) & Student B (claimant) confirm
    const hoA = await api("/rest/v1/rpc/confirm_handover", {
      method: "POST",
      token: tokA,
      body: { p_claim_id: claimId, p_role: "finder" }
    });
    assert.ok(hoA.ok && hoA.data.completed === false, "Finder handover confirmed");

    const hoB = await api("/rest/v1/rpc/confirm_handover", {
      method: "POST",
      token: tokB,
      body: { p_claim_id: claimId, p_role: "claimant" }
    });
    assert.ok(hoB.ok && hoB.data.completed === true, "Claimant handover completed return");

    // 11. Admin reads audit logs via admin-ops Edge Function
    const admBundle = await api("/functions/v1/admin-ops", {
      method: "POST",
      token: tokAdm,
      body: { action: "get_dashboard_bundle" }
    });
    assert.ok(admBundle.ok && admBundle.data.auditLogs.length >= 2, "Admin retrieved audit logs via Edge Function");

    console.log("ALL 11 SUPABASE SECURITY, RLS, STORAGE, AUTH & E2E CHECKS PASSED!");
  } finally {
    // Cleanup test artifacts so database stays clean
    if (createdItemId) {
      await api("/functions/v1/admin-ops", {
        method: "POST",
        key: SERVICE_KEY,
        body: {} // cleanup via direct service calls below
      }).catch(() => {});
      await api(`/storage/v1/object/item-photos`, {
        method: "DELETE",
        key: SERVICE_KEY,
        body: { prefixes: [`${createdUserIds[1]}/${createdItemId}/test.png`] }
      }).catch(() => {});
      await api(`/rest/v1/item_reports?id=eq.${createdItemId}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await api(`/rest/v1/admin_audit_logs?actor_id=eq.${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
      await api(`/auth/v1/admin/users/${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    }
  }
})();
