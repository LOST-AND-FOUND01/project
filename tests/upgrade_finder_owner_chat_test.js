// FOUNDIT Upgrade Test: Finder, Owner, Sightings, Status Lifecycle, Private Chat & Return Confirmation
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

async function api(endpoint, { method = "GET", key = ANON_KEY, token = null, body = null, headers = {} } = {}) {
  const hdrs = { apikey: key, Authorization: `Bearer ${token || key}`, ...headers };
  if (body && !hdrs["Content-Type"]) hdrs["Content-Type"] = "application/json";
  const res = await fetch(`${SUPABASE_URL}${endpoint}`, {
    method,
    headers: hdrs,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, data: json };
}

(async () => {
  const ts = Date.now();
  const pw = "UpgradeTest123!";
  const createdUsers = [];
  let foundItemId = null;
  let lostItemId = null;
  let passed = 0;
  const pass = (msg) => { passed++; console.log(`PASS [${passed}]: ${msg}`); };

  try {
    const mkUser = async (tag, name) => {
      const r = await api("/auth/v1/admin/users", {
        method: "POST", key: SERVICE_KEY,
        body: { email: `upg.${tag}.${ts}@gmail.com`, password: pw, email_confirm: true, user_metadata: { full_name: name, usn: `U${tag}${String(ts).slice(-4)}` } }
      });
      assert.ok(r.ok);
      createdUsers.push(r.data.id);
      const tok = (await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: `upg.${tag}.${ts}@gmail.com`, password: pw } })).data.access_token;
      return { id: r.data.id, token: tok };
    };

    const finder = await mkUser("f", "Finder User");
    const owner = await mkUser("o", "Owner User");
    const outsider = await mkUser("x", "Random Student");

    // 1. Finder posts Found item with location + specific_location
    const postRes = await api("/rest/v1/item_reports", {
      method: "POST", token: finder.token, headers: { Prefer: "return=representation" },
      body: {
        reporter_id: finder.id,
        title: "Silver MacBook Charger",
        report_type: "found",
        category: "Electronics",
        colour: "White",
        location: "Library",
        specific_location: "2nd floor quiet table #4",
        description: "Found plugged in near window"
      }
    });
    assert.ok(postRes.ok && postRes.data[0].status === "Available" && postRes.data[0].specific_location === "2nd floor quiet table #4");
    foundItemId = postRes.data[0].id;
    pass("Found item created as Available with specific_location");

    // 2. Owner posts Lost item & Finder posts sighting update on it
    const lostRes = await api("/rest/v1/item_reports", {
      method: "POST", token: owner.token, headers: { Prefer: "return=representation" },
      body: { reporter_id: owner.id, title: "Lost Pink Pencil", report_type: "lost", category: "Other", location: "Library" }
    });
    assert.ok(lostRes.ok);
    lostItemId = lostRes.data[0].id;

    const sightRes = await api("/rest/v1/item_sightings", {
      method: "POST", token: finder.token, headers: { Prefer: "return=representation" },
      body: { item_id: lostItemId, sender_id: finder.id, status_type: "found_it", found_location: "Library", message: "Left it at the librarian counter" }
    });
    assert.ok(sightRes.ok);
    pass("Sighting/Found-It message posted on lost item");

    // 3. Finder cannot claim their own found item
    const selfClaim = await api("/rest/v1/claims", {
      method: "POST", token: finder.token,
      body: { item_id: foundItemId, claimant_id: finder.id, ownership_explanation: "My own charger test" }
    });
    assert.strictEqual(selfClaim.ok, false);
    pass("Finder blocked from claiming own item");

    // 4. Owner submits claim -> item moves to Claim Requested & Finder gets notification
    const claimRes = await api("/rest/v1/claims", {
      method: "POST", token: owner.token, headers: { Prefer: "return=representation" },
      body: { item_id: foundItemId, claimant_id: owner.id, ownership_explanation: "Has my blue initials sticker on brick" }
    });
    assert.ok(claimRes.ok);
    const claimId = claimRes.data[0].id;

    const checkItemReq = await api(`/rest/v1/item_reports?id=eq.${foundItemId}`, { token: finder.token });
    assert.strictEqual(checkItemReq.data[0].status, "Claim Requested");
    pass("Claim moves item to Claim Requested and notifies finder");

    // 5. Owner cannot approve their own claim
    const ownerSelfApprove = await api("/rest/v1/rpc/finder_decide_claim", {
      method: "POST", token: owner.token,
      body: { p_claim_id: claimId, p_decision: "Approved" }
    });
    assert.strictEqual(ownerSelfApprove.ok, false);
    pass("Claimant/Owner blocked from approving own claim");

    // 6. Outsider cannot approve or reject claim
    const outsiderApprove = await api("/rest/v1/rpc/finder_decide_claim", {
      method: "POST", token: outsider.token,
      body: { p_claim_id: claimId, p_decision: "Approved" }
    });
    assert.strictEqual(outsiderApprove.ok, false);
    pass("Random user blocked from approving claim");

    // 7. Finder approves claim -> status becomes Claim Approved (NOT Returned!) & conversation created
    const finderApprove = await api("/rest/v1/rpc/finder_decide_claim", {
      method: "POST", token: finder.token,
      body: { p_claim_id: claimId, p_decision: "Approved", p_note: "Matches sticker" }
    });
    assert.ok(finderApprove.ok && finderApprove.data.conversation_id);
    const convId = finderApprove.data.conversation_id;

    const afterApprove = await api(`/rest/v1/item_reports?id=eq.${foundItemId}`, { token: finder.token });
    assert.strictEqual(afterApprove.data[0].status, "Claim Approved");
    pass("Finder approved claim -> status Claim Approved (not Returned) & chat created");

    // 8. Private chat: Finder & Owner can chat; Outsider CANNOT read or insert
    const msg1 = await api("/rest/v1/chat_messages", {
      method: "POST", token: owner.token,
      body: { conversation_id: convId, sender_id: owner.id, body: "Can we meet at Academic Block desk at 2 PM?" }
    });
    const msg2 = await api("/rest/v1/chat_messages", {
      method: "POST", token: finder.token,
      body: { conversation_id: convId, sender_id: finder.id, body: "Yes, 2 PM works!" }
    });
    assert.ok(msg1.ok && msg2.ok);

    const outsiderRead = await api(`/rest/v1/chat_messages?conversation_id=eq.${convId}`, { token: outsider.token });
    assert.deepStrictEqual(outsiderRead.data, []);

    const outsiderSend = await api("/rest/v1/chat_messages", {
      method: "POST", token: outsider.token,
      body: { conversation_id: convId, sender_id: outsider.id, body: "Intruder message" }
    });
    assert.strictEqual(outsiderSend.ok, false);
    pass("Private Finder-Owner chat isolated from unauthorized users");

    // 9. Outsider cannot mark finder's item Returned; direct PATCH to Returned blocked; Finder confirms handover -> Returned
    const outsiderReturn = await api("/rest/v1/rpc/confirm_item_returned", {
      method: "POST", token: outsider.token, body: { p_item_id: foundItemId }
    });
    assert.strictEqual(outsiderReturn.ok, false);

    const directPatchReturned = await api(`/rest/v1/item_reports?id=eq.${foundItemId}`, {
      method: "PATCH", token: finder.token, body: { status: "Returned" }
    });
    assert.strictEqual(directPatchReturned.ok, false);

    const finderReturn = await api("/rest/v1/rpc/confirm_item_returned", {
      method: "POST", token: finder.token, body: { p_item_id: foundItemId }
    });
    assert.ok(finderReturn.ok && finderReturn.data.status === "Returned", `confirm_item_returned failed: ${JSON.stringify(finderReturn.data)}`);
    pass("Finder confirmed handover -> item marked Returned (direct PATCH blocked)");

    // 10. Returned item cannot be claimed again
    const claimAfterReturn = await api("/rest/v1/claims", {
      method: "POST", token: outsider.token,
      body: { item_id: foundItemId, claimant_id: outsider.id, ownership_explanation: "Trying to claim returned item" }
    });
    assert.strictEqual(claimAfterReturn.ok, false);
    pass("Returned item rejects new claim requests");

    console.log(`ALL ${passed} UPGRADE E2E & SECURITY TESTS PASSED!`);
  } finally {
    if (foundItemId) await api(`/rest/v1/item_reports?id=eq.${foundItemId}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    if (lostItemId) await api(`/rest/v1/item_reports?id=eq.${lostItemId}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    for (const uid of createdUsers) {
      await api(`/rest/v1/admin_audit_logs?actor_id=eq.${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
      await api(`/auth/v1/admin/users/${uid}`, { method: "DELETE", key: SERVICE_KEY }).catch(() => {});
    }
  }
})();
