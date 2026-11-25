// FOUNDIT Frontend State & Flow Smoke Test (Node.js)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const storageMap = new Map();
const sandbox = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Set,
  Array,
  Object,
  String,
  Boolean,
  Number,
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  }
};
sandbox.window = sandbox;
sandbox.window.crypto = require("crypto").webcrypto;

vm.createContext(sandbox);

const scriptsDir = path.join(__dirname, "..", "frontend", "scripts");
["data/mockData.js", "utils/helpers.js", "state/store.js"].forEach((rel) => {
  const code = fs.readFileSync(path.join(scriptsDir, rel), "utf8");
  vm.runInContext(code, sandbox, { filename: rel });
});

const { store, helpers } = sandbox.FOUNDIT;

// 1. Validate helpers
assert.strictEqual(helpers.isValidEmail("student@jcet.demo"), true);
assert.strictEqual(helpers.isValidEmail("bad-email"), false);
assert.notStrictEqual(helpers.validatePassword("short"), "");
assert.strictEqual(helpers.validatePassword("ValidPass1"), "");
assert.strictEqual(helpers.safe('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");

// 2. Registration, Email Verification, Logout, Login, Forgot & Reset Password
const reg = store.registerUser({
  name: "Test Student",
  usn: "2JC23CS099",
  email: "test.student@jcet.demo",
  department: "CSE",
  phone: "9999999999",
  password: "Password1"
});
assert.strictEqual(reg.ok, true);
assert.strictEqual(store.getCurrentUser().verified, false);

const badVerify = store.verifyEmailCode("000000");
assert.strictEqual(badVerify.ok, false);

const goodVerify = store.verifyEmailCode(reg.code);
assert.strictEqual(goodVerify.ok, true);
assert.strictEqual(store.getCurrentUser().verified, true);

store.logout();
assert.strictEqual(store.getCurrentUser(), null);

const forgot = store.requestPasswordReset("test.student@jcet.demo");
assert.strictEqual(forgot.ok, true);
const reset = store.resetPassword("NewPass123");
assert.strictEqual(reset.ok, true);

const loginFail = store.loginUser("test.student@jcet.demo", "Password1");
assert.strictEqual(loginFail.ok, false);
const loginOk = store.loginUser("test.student@jcet.demo", "NewPass123");
assert.strictEqual(loginOk.ok, true);

// 3. Report Found Item & Submit Claim from Another Account
store.quickLogin("rohan.p@jcet.demo");
const foundItem = store.createItem({
  name: "Blue Umbrella",
  type: "found",
  category: "Accessories",
  colour: "Blue",
  location: "Library",
  date: "2026-11-25",
  description: "Foldable umbrella near entrance",
  photo: "",
  anonymous: false
});
assert.strictEqual(foundItem.status, "Open");

store.quickLogin("ananya.k@jcet.demo");
const claimRes = store.submitClaim({
  itemId: foundItem.id,
  name: "Ananya Kulkarni",
  email: "ananya.k@jcet.demo",
  message: "Has wooden handle and small tear on edge",
  handoverPreference: "Library Desk"
});
assert.strictEqual(claimRes.ok, true);

// 4. Admin Approve Claim & Two-Party Handover
store.quickLogin("admin@jcet.demo");
store.decideClaim(claimRes.claim.id, "Approved", "Verified details");

const afterApproveItem = store.getState().items.find((x) => x.id === foundItem.id);
assert.strictEqual(afterApproveItem.status, "Handover Pending");

const h1 = store.confirmHandover(claimRes.claim.id, "finder");
assert.strictEqual(h1.ok, true);
assert.strictEqual(h1.completed, false);

const h2 = store.confirmHandover(claimRes.claim.id, "claimant");
assert.strictEqual(h2.ok, true);
assert.strictEqual(h2.completed, true);

const returnedItem = store.getState().items.find((x) => x.id === foundItem.id);
assert.strictEqual(returnedItem.status, "Returned");

// 5. Flagging, Moderation, Announcement, Notifications & Audit Log
store.flagItem(foundItem.id, "Test flag");
assert.strictEqual(store.getState().items.find((x) => x.id === foundItem.id).flagged, true);
store.resolveFlag(foundItem.id, "clear");
assert.strictEqual(store.getState().items.find((x) => x.id === foundItem.id).flagged, false);

store.publishAnnouncement("Demo Notice", "Testing broadcast");
const notifs = store.getUserNotifications();
assert.ok(notifs.some((n) => n.title.includes("Demo Notice")));
assert.ok(store.getState().auditLogs.some((l) => l.action === "HANDOVER_COMPLETED"));

console.log("ALL FOUNDIT FRONTEND SMOKE TESTS PASSED!");
