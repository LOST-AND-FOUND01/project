// FOUNDIT Phase 5 — Non-Destructive Security, Database Constraint & Validation Suite
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const cfgText = fs.readFileSync(path.join(__dirname, "..", "frontend", "scripts", "config", "supabaseConfig.js"), "utf8");
const SUPABASE_URL = cfgText.match(/url:\s*'([^']+)'/)[1];
const ANON_KEY = cfgText.match(/anonKey:\s*'([^']+)'/)[1];
const SERVICE_KEY = process.env.TEST_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing TEST_SERVICE_ROLE_KEY env var.");
  process.exit(1);
}

async function api(endpoint, { method = "GET", key = ANON_KEY, token = null, body = null, headers = {}, isBinary = false } = {}) {
  const hdrs = { apikey: key, Authorization: `Bearer ${token || key}`, ...headers };
  if (body && !isBinary && !hdrs["Content-Type"]) hdrs["Content-Type"] = "application/json";
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
  const ts = Date.now();
  const pw = "Phase5Pass123!";
  const createdIds = [];
  let itemId = null;

  let passed = 0;
  const pass = (name) => { passed++; console.log(`PASS [${passed}]: ${name}`); };

  try {
    // Provision ephemeral Student A & Student B
    const sA = await api("/auth/v1/admin/users", {
      method: "POST", key: SERVICE_KEY,
      body: { email: `p5.a.${ts}@gmail.com`, password: pw, email_confirm: true, user_metadata: { full_name: "P5 Student A", usn: `P5A${String(ts).slice(-4)}` } }
    });
    const sB = await api("/auth/v1/admin/users", {
      method: "POST", key: SERVICE_KEY,
      body: { email: `p5.b.${ts}@gmail.com`, password: pw, email_confirm: true, user_metadata: { full_name: "P5 Student B", usn: `P5B${String(ts).slice(-4)}` } }
    });
    assert.ok(sA.ok && sB.ok);
    const idA = sA.data.id, idB = sB.data.id;
    createdIds.push(idA, idB);

    const tokA = (await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: `p5.a.${ts}@gmail.com`, password: pw } })).data.access_token;
    const tokB = (await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: `p5.b.${ts}@gmail.com`, password: pw } })).data.access_token;

    // Test 1: CHECK constraint rejects invalid campus location
    const badLoc = await api("/rest/v1/item_reports", {
      method: "POST", token: tokA,
      body: { reporter_id: idA, title: "Bad Loc", report_type: "lost", category: "Other", location: "OffCampusHack" }
    });
    assert.strictEqual(badLoc.ok, false);
    pass("CHECK constraint rejects invalid campus location");

    // Test 2: CHECK constraint rejects invalid category
    const badCat = await api("/rest/v1/item_reports", {
      method: "POST", token: tokA,
      body: { reporter_id: idA, title: "Bad Cat", report_type: "lost", category: "Weapons", location: "Library" }
    });
    assert.strictEqual(badCat.ok, false);
    pass("CHECK constraint rejects invalid category");

    // Test 3: SQL Injection payload treated safely as literal string
    const sqliTitle = "Bottle'; DROP TABLE item_reports; --";
    const sqliRes = await api("/rest/v1/item_reports", {
      method: "POST", token: tokA, headers: { Prefer: "return=representation" },
      body: { reporter_id: idA, title: sqliTitle, report_type: "found", category: "Accessories", location: "Library" }
    });
    assert.ok(sqliRes.ok && sqliRes.data[0].title === sqliTitle);
    itemId = sqliRes.data[0].id;
    pass("SQL injection payload parameterized safely without execution");

    // Test 4: Duplicate active claim prevention (unique partial index uq_active_claim_per_user_item)
    const c1 = await api("/rest/v1/claims", {
      method: "POST", token: tokB,
      body: { item_id: itemId, claimant_id: idB, ownership_explanation: "First valid claim explanation here." }
    });
    assert.ok(c1.ok);
    const c2 = await api("/rest/v1/claims", {
      method: "POST", token: tokB,
      body: { item_id: itemId, claimant_id: idB, ownership_explanation: "Duplicate active claim attempt." }
    });
    assert.strictEqual(c2.ok, false);
    pass("Duplicate active claim prevented by unique index");

    // Test 5: Storage rejects invalid MIME type (text/plain)
    const badMime = await api(`/storage/v1/object/item-photos/${idA}/${itemId}/evil.txt`, {
      method: "POST", token: tokA, isBinary: true,
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("not an image")
    });
    assert.strictEqual(badMime.ok, false);
    pass("Storage rejects disallowed MIME type text/plain");

    // Test 6: Storage rejects file > 2 MB
    const bigBuf = Buffer.alloc(2 * 1024 * 1024 + 512, 0);
    const tooBig = await api(`/storage/v1/object/item-photos/${idA}/${itemId}/huge.png`, {
      method: "POST", token: tokA, isBinary: true,
      headers: { "Content-Type": "image/png" },
      body: bigBuf
    });
    assert.strictEqual(tooBig.ok, false);
    pass("Storage rejects oversized file (> 2 MB)");

    // Test 7: Protected profile fields (account_status, email_verified) cannot be altered by student
    const profTamper = await api(`/rest/v1/profiles?id=eq.${idA}`, {
      method: "PATCH", token: tokA, headers: { Prefer: "return=representation" },
      body: { account_status: "Suspended", email_verified: false, department: "AI&ML" }
    });
    assert.ok(profTamper.ok && profTamper.data[0].account_status === "Active" && profTamper.data[0].department === "AI&ML");
    pass("Profile guard trigger preserves protected fields while allowing department update");

    // Test 8: XSS payload escaped cleanly by frontend helper
    const helpersCode = fs.readFileSync(path.join(__dirname, "..", "frontend", "scripts", "utils", "helpers.js"), "utf8");
    const vm = require("vm");
    const box = { window: {}, setTimeout, clearTimeout, Date, String };
    box.window = box;
    vm.runInNewContext(helpersCode, box);
    const escaped = box.FOUNDIT.helpers.safe('<img src=x onerror="alert(1)">');
    assert.ok(!escaped.includes("<img") && escaped.includes("&lt;img"));
    pass("XSS payload safely HTML-escaped by helpers.safe()");

    console.log(`ALL ${passed} PHASE 5 SECURITY & CONSTRAINT TESTS PASSED!`);
  } finally {
    if (itemId) {
      await api(`/rest/v1/item_reports?id=eq.${itemId}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    }
    for (const uid of createdIds) {
      await api(`/rest/v1/admin_audit_logs?actor_id=eq.${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
      await api(`/auth/v1/admin/users/${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    }
  }
})();
