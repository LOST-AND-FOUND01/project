/* FOUNDIT — Admin Dashboard (Server-Side Verified via Supabase Edge Function admin-ops) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.adminDashboard = (() => {
  const { safe, formatDateTime, statusTagClass, toast } = window.FOUNDIT.helpers;
  let activeTab = "overview";
  let reportFilter = "";
  let auditFilter = "";

  function setTab(tab) {
    activeTab = tab;
    render();
  }

  function updateReportFilter(val) {
    reportFilter = val.toLowerCase();
    render();
  }

  function updateAuditFilter(val) {
    auditFilter = val.toLowerCase();
    render();
  }

  async function changeStatus(itemId, status) {
    const res = await window.FOUNDIT.store.adminUpdateReportStatus(itemId, status);
    if (!res.ok) return toast(res.error);
    toast(`Status updated to ${status}`);
  }

  async function deleteItem(itemId) {
    if (!window.confirm("Delete this item, its stored photos, and related claims?")) return;
    const res = await window.FOUNDIT.store.adminModerateReport(itemId, "delete");
    if (!res.ok) return toast(res.error);
    toast("Item deleted.");
  }

  async function moderate(itemId, action) {
    const res = await window.FOUNDIT.store.adminModerateReport(itemId, action);
    if (!res.ok) return toast(res.error);
    toast(action === "clear" ? "Moderation flag cleared." : "Listing archived.");
  }

  async function decideClaim(claimId, status) {
    const note = window.prompt(`Optional admin note for ${status.toLowerCase()} claim:`, "") ?? "";
    const res = await window.FOUNDIT.store.decideClaim(claimId, status, note.trim());
    if (!res.ok) return toast(res.error);
    toast(`Claim ${status.toLowerCase()}.`);
  }

  async function toggleUserStatus(userId, nextStatus) {
    const res = await window.FOUNDIT.store.adminSetUserStatus(userId, nextStatus);
    if (!res.ok) return toast(res.error);
    toast(`Account set to ${nextStatus}.`);
  }

  function updateQR() {
    const loc = document.getElementById("qrLocation")?.value || "Academic Block";
    const text = document.getElementById("qrText");
    if (text) text.textContent = `Prefilled report location: ${loc}`;
  }

  function copyQRLink() {
    const loc = document.getElementById("qrLocation")?.value || "Academic Block";
    const url = `${window.location.origin}${window.location.pathname}?location=${encodeURIComponent(loc)}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url)
        .then(() => toast("Prefilled QR link copied!"))
        .catch(() => window.prompt("Copy this link:", url));
    } else {
      window.prompt("Copy this link:", url);
    }
  }

  function render() {
    const root = document.getElementById("adminDashboardRoot");
    if (!root) return;

    const store = window.FOUNDIT.store;
    const state = store.getState();
    const user = store.getCurrentUser();
    const { CAMPUS_ZONES, STATUSES } = window.FOUNDIT.MOCK_DATA;

    if (!user || user.role !== "admin") {
      root.innerHTML = `
        <div class="panel empty">
          <strong>Administrator Access Required</strong>
          <p class="muted" style="margin-bottom:14px">
            ${user
              ? `Signed in as ${safe(user.email)} (role: ${safe(user.role)}). Only server-verified administrators can access this workspace.`
              : "Please sign in with an administrator account provisioned through trusted backend administration."}
          </p>
          <div class="action-row" style="justify-content:center">
            <button type="button" class="btn" onclick="window.FOUNDIT.router.showPage('auth')">Go to Login</button>
          </div>
        </div>
      `;
      return;
    }

    const bundle = state.adminBundle || {};
    const items = bundle.reports || [];
    const claims = bundle.claims || [];
    const users = bundle.users || [];
    const auditLogs = bundle.auditLogs || [];
    const flaggedItems = items.filter((x) => x.is_flagged);
    const pendingClaims = claims.filter((c) => c.status === "Pending");

    const statsHtml = `
      <div class="stats">
        <div class="stat"><strong>${items.length}</strong><small>Total reports</small></div>
        <div class="stat"><strong>${pendingClaims.length}</strong><small>Pending claims</small></div>
        <div class="stat"><strong>${items.filter((x) => x.status === "Returned").length}</strong><small>Returned items</small></div>
        <div class="stat"><strong>${users.length}</strong><small>Users (${flaggedItems.length} flagged)</small></div>
      </div>
    `;

    const tabsHtml = `
      <div class="subtabs">
        ${[
          ["overview", "Overview & Activity"],
          ["reports", `Reports (${items.length})`],
          ["claims", `Claims (${claims.length})`],
          ["users", `Users (${users.length})`],
          ["moderation", `Moderation (${flaggedItems.length})`],
          ["audit", `Audit Log (${auditLogs.length})`],
          ["qr", "QR Reporting"]
        ].map(([id, label]) => `
          <button type="button" class="${activeTab === id ? "active" : ""}" onclick="window.FOUNDIT.adminDashboard.setTab('${id}')">${label}</button>
        `).join("")}
      </div>
    `;

    let panelHtml = "";

    if (activeTab === "overview") {
      const zoneBars = CAMPUS_ZONES.map((zone) => {
        const count = items.filter((x) => x.location === zone).length;
        const pct = items.length ? Math.round((count / items.length) * 100) : 0;
        return `
          <div class="zone-row">
            <div><span>${safe(zone)}</span><span>${count} reports (${pct}%)</span></div>
            <div class="bar"><span style="width:${pct}%"></span></div>
          </div>
        `;
      }).join("");

      const openReminders = items.filter((x) => x.status === "Open");

      panelHtml = `
        <div class="two-col">
          <div class="panel">
            <h3>Campus Zone Analytics</h3>
            <p class="muted" style="font-size:12px;margin:4px 0 12px">Report distribution by JCET zone</p>
            ${zoneBars}
          </div>
          <div class="panel">
            <h3>Recent Activity</h3>
            <p class="muted" style="font-size:12px;margin:4px 0 12px">Latest server-verified audit events</p>
            ${auditLogs.slice(0, 6).map((log) => `
              <div class="activity-item">
                <b>${safe(log.action)}</b> · <span class="muted">${safe(log.target_type)}: ${safe(log.target_id)}</span>
                <p class="muted" style="font-size:11px;margin-top:2px">${safe(log.actor_email)} · ${formatDateTime(log.created_at)}</p>
              </div>
            `).join("") || '<p class="muted">No audit events recorded yet.</p>'}
          </div>
        </div>
        <div class="panel" style="margin-top:16px">
          <h3>Unclaimed Item Reminders</h3>
          ${openReminders.length
            ? openReminders.map((x) => `<p style="margin:8px 0;color:#80545F">• Reminder: <b>${safe(x.title)}</b> (${safe(x.report_type)}) at ${safe(x.location)} is still Open.</p>`).join("")
            : '<p class="muted" style="margin-top:8px">No open unclaimed items.</p>'}
        </div>
      `;
    } else if (activeTab === "reports") {
      const filtered = items.filter((x) =>
        !reportFilter || `${x.title} ${x.location} ${x.status} ${x.report_type}`.toLowerCase().includes(reportFilter)
      );
      panelHtml = `
        <div class="panel">
          <div class="filters" style="margin-top:0">
            <input placeholder="Filter reports by title, zone, or status..." value="${safe(reportFilter)}" oninput="window.FOUNDIT.adminDashboard.updateReportFilter(this.value)">
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Item</th><th>Type</th><th>Location</th><th>Reporter</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                ${filtered.length
                  ? filtered.map((x) => `
                      <tr>
                        <td>
                          <strong>${safe(x.title)}</strong>${x.is_flagged ? ' <span class="tag rejected">Flagged</span>' : ""}
                          ${x.photo_url ? `<div style="margin-top:4px"><a href="${safe(x.photo_url)}" target="_blank" rel="noopener noreferrer" style="color:#C94655;font-size:11px;font-weight:700">View photo ↗</a></div>` : ""}
                        </td>
                        <td>${safe(x.report_type)}</td>
                        <td>${safe(x.location)}</td>
                        <td>${safe(x.reporter_email || x.reporter_name)}</td>
                        <td>
                          <select onchange="window.FOUNDIT.adminDashboard.changeStatus('${safe(x.id)}', this.value)" style="padding:6px 8px;min-width:135px">
                            ${STATUSES.map((s) => `<option value="${s}" ${x.status === s ? "selected" : ""}>${s}</option>`).join("")}
                          </select>
                        </td>
                        <td>
                          <div class="action-row" style="margin:0">
                            ${x.status !== "Open" ? `<button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.adminDashboard.changeStatus('${safe(x.id)}','Open')">Approve</button>` : ""}
                            ${x.status !== "Archived" ? `<button type="button" class="btn btn-soft btn-small" onclick="window.FOUNDIT.adminDashboard.changeStatus('${safe(x.id)}','Archived')">Reject</button>` : ""}
                            <button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.adminDashboard.deleteItem('${safe(x.id)}')">Delete</button>
                          </div>
                        </td>
                      </tr>
                    `).join("")
                  : '<tr><td colspan="6">No matching reports.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === "claims") {
      panelHtml = `
        <div class="panel table-wrap">
          <table>
            <thead>
              <tr><th>Item</th><th>Claimant</th><th>Ownership Explanation</th><th>Status</th><th>Action</th></tr>
            </thead>
            <tbody>
              ${claims.length
                ? claims.map((c) => {
                    const itemObj = Array.isArray(c.item_reports) ? c.item_reports[0] : c.item_reports;
                    return `
                      <tr>
                        <td><strong>${safe(itemObj?.title || "Item")}</strong><br><small class="muted">${safe(c.handover_preference || "")}</small></td>
                        <td>${safe(c.claimant_name)}<br><small class="muted">${safe(c.claimant_email)}</small></td>
                        <td>${safe(c.ownership_explanation)}${c.admin_note ? `<br><small><em>Note: ${safe(c.admin_note)}</em></small>` : ""}</td>
                        <td><span class="tag ${statusTagClass(c.status)}">${safe(c.status)}</span></td>
                        <td>
                          ${c.status === "Pending"
                            ? `<div class="action-row" style="margin:0">
                                <button type="button" class="btn btn-small" onclick="window.FOUNDIT.adminDashboard.decideClaim('${safe(c.id)}','Approved')">Approve</button>
                                <button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.adminDashboard.decideClaim('${safe(c.id)}','Rejected')">Reject</button>
                              </div>`
                            : "Processed"}
                        </td>
                      </tr>
                    `;
                  }).join("")
                : '<tr><td colspan="5">No claims submitted yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } else if (activeTab === "users") {
      panelHtml = `
        <div class="panel table-wrap">
          <table>
            <thead>
              <tr><th>Name &amp; USN</th><th>Email</th><th>Role</th><th>Verified</th><th>Status</th><th>Controls</th></tr>
            </thead>
            <tbody>
              ${users.map((u) => `
                <tr>
                  <td><strong>${safe(u.full_name)}</strong><br><small class="muted">${safe(u.usn || "—")} · ${safe(u.department)}</small></td>
                  <td>${safe(u.email)}</td>
                  <td><span class="tag">${safe(u.role.toUpperCase())}</span></td>
                  <td><span class="tag ${u.email_verified ? "done" : "pending"}">${u.email_verified ? "Verified" : "Unverified"}</span></td>
                  <td><span class="tag ${statusTagClass(u.account_status)}">${safe(u.account_status)}</span></td>
                  <td>
                    ${u.role !== "admin"
                      ? `<button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.adminDashboard.toggleUserStatus('${safe(u.id)}','${u.account_status === "Active" ? "Suspended" : "Active"}')">${u.account_status === "Active" ? "Suspend" : "Activate"}</button>`
                      : "<span class='muted'>Protected</span>"}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    } else if (activeTab === "moderation") {
      panelHtml = `
        <div class="two-col">
          <div class="panel">
            <h3>Flagged Content Queue</h3>
            <p class="muted" style="font-size:12px;margin:4px 0 12px">Items flagged by users for review</p>
            ${flaggedItems.length
              ? flaggedItems.map((x) => `
                  <div class="action-card">
                    <strong>${safe(x.title)}</strong> (${safe(x.location)})
                    <p>Reason: ${safe(x.flag_reason)}</p>
                    <div class="action-row">
                      <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.adminDashboard.moderate('${safe(x.id)}','clear')">Clear Flag</button>
                      <button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.adminDashboard.moderate('${safe(x.id)}','archive')">Archive Listing</button>
                    </div>
                  </div>
                `).join("")
              : '<div class="empty">No flagged listings to moderate.</div>'}
          </div>
          <div class="panel">
            <h3>Publish Campus Announcement</h3>
            <p class="muted" style="font-size:12px;margin:4px 0 12px">Broadcasts to Home banner &amp; Notifications</p>
            <form id="adminAnnounceForm">
              <div class="field"><label for="annTitle">Announcement Title *</label><input id="annTitle" required placeholder="e.g. Exam Week Lost & Found Hours"></div>
              <div class="field"><label for="annMessage">Message *</label><textarea id="annMessage" required placeholder="Enter campus-wide notice..."></textarea></div>
              <button class="btn" type="submit">Publish Announcement</button>
            </form>
          </div>
        </div>
      `;
    } else if (activeTab === "audit") {
      const logs = auditLogs.filter((l) =>
        !auditFilter || `${l.actor_email} ${l.action} ${l.target_type} ${l.target_id} ${JSON.stringify(l.details)}`.toLowerCase().includes(auditFilter)
      );
      panelHtml = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <input style="max-width:340px" placeholder="Filter audit logs..." value="${safe(auditFilter)}" oninput="window.FOUNDIT.adminDashboard.updateAuditFilter(this.value)">
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr>
              </thead>
              <tbody>
                ${logs.map((l) => `
                  <tr>
                    <td>${formatDateTime(l.created_at)}</td>
                    <td>${safe(l.actor_email)}</td>
                    <td><span class="tag">${safe(l.action)}</span></td>
                    <td>${safe(l.target_type)} · ${safe(l.target_id)}</td>
                    <td>${safe(JSON.stringify(l.details || {}))}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else if (activeTab === "qr") {
      panelHtml = `
        <div class="panel">
          <h3>QR Reporting Interface</h3>
          <p class="muted" style="margin:6px 0 12px">Choose a campus zone for a prefilled reporting link</p>
          <select id="qrLocation" onchange="window.FOUNDIT.adminDashboard.updateQR()">
            ${CAMPUS_ZONES.map((z) => `<option value="${safe(z)}">${safe(z)}</option>`).join("")}
          </select>
          <div class="qr-box">
            <div class="qr-symbol">▦</div>
            <p id="qrText">Prefilled report location: ${safe(CAMPUS_ZONES[0])}</p>
          </div>
          <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.adminDashboard.copyQRLink()">Copy prefilled link</button>
          <p class="muted" style="font-size:12px;margin-top:10px">Link preview only — not a generated scannable QR image.</p>
        </div>
      `;
    }

    root.innerHTML = `${statsHtml}${tabsHtml}${panelHtml}`;

    document.getElementById("adminAnnounceForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = document.getElementById("annTitle").value.trim();
      const msg = document.getElementById("annMessage").value.trim();
      if (!title || !msg) return toast("Please enter both title and message.");
      const res = await window.FOUNDIT.store.publishAnnouncement(title, msg);
      if (!res.ok) return toast(res.error);
      toast("Campus announcement published!");
    });
  }

  return {
    setTab,
    updateReportFilter,
    updateAuditFilter,
    changeStatus,
    deleteItem,
    moderate,
    decideClaim,
    toggleUserStatus,
    updateQR,
    copyQRLink,
    render
  };
})();
