/* FOUNDIT — Student Dashboard (Live Supabase Queries & RLS-Protected Actions) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.studentDashboard = (() => {
  const { safe, formatDateTime, statusTagClass, toast } = window.FOUNDIT.helpers;
  let activeTab = "lost"; // lost | found | claims | notifications | profile
  let notifFilter = "all";

  function setTab(tab) {
    activeTab = tab;
    render();
  }

  function setNotifFilter(cat) {
    notifFilter = cat;
    render();
  }

  function renderTimeline(claim) {
    const isRejected = claim.status === "Rejected";
    const steps = [
      { label: "1. Claim Submitted", done: true },
      { label: "2. Admin Review", done: claim.status !== "Pending", current: claim.status === "Pending" },
      {
        label: isRejected ? "3. Rejected" : "3. Handover Pending",
        done: claim.status === "Completed",
        current: claim.status === "Approved" || claim.status === "Handover Pending",
        rejected: isRejected
      },
      { label: "4. Return Completed", done: claim.status === "Completed" }
    ];

    return `
      <div class="timeline">
        ${steps.map((s) => {
          const cls = s.rejected ? "rejected" : s.done ? "done" : s.current ? "current" : "";
          return `<div class="timeline-step ${cls}">${safe(s.label)}</div>`;
        }).join("")}
      </div>
    `;
  }

  async function confirmHandover(claimId, role) {
    const msg = role === "finder"
      ? "Confirm that you have physically handed over this item?"
      : "Confirm that you have physically received this item?";
    if (!window.confirm(msg)) return;
    const res = await window.FOUNDIT.store.confirmHandover(claimId, role);
    if (!res.ok) return toast(res.error);
    toast(res.completed ? "Both confirmed! Item successfully returned." : "Confirmation saved. Waiting for the other person.");
  }

  async function markReturned(itemId) {
    const res = await window.FOUNDIT.store.updateItemStatus(itemId, "Returned");
    if (!res.ok) return toast(res.error);
    toast("Report marked as Returned.");
  }

  async function removeOwnReport(itemId) {
    if (!window.confirm("Delete this open report and any uploaded photo?")) return;
    const res = await window.FOUNDIT.store.deleteItem(itemId);
    if (!res.ok) return toast(res.error);
    toast("Report deleted.");
  }

  let editingItemId = null;

  function startEditReport(itemId) {
    editingItemId = itemId;
    render();
  }

  function cancelEditReport() {
    editingItemId = null;
    render();
  }

  function renderEditForm(item) {
    const { CAMPUS_ZONES } = window.FOUNDIT.MOCK_DATA;
    return `
      <form class="action-card edit-report-form" data-item-id="${safe(item.id)}" style="background:#FFF9F7;margin-top:10px">
        <h4 style="margin-bottom:10px">Edit Permitted Report Details</h4>
        <div class="form-grid">
          <div class="field"><label>Item Name *</label><input name="name" required maxlength="70" value="${safe(item.name)}"></div>
          <div class="field"><label>Colour</label><input name="colour" value="${safe(item.colour || "")}"></div>
          <div class="field"><label>Location *</label>
            <select name="location" required>
              ${CAMPUS_ZONES.map((z) => `<option value="${safe(z)}" ${item.location === z ? "selected" : ""}>${safe(z)}</option>`).join("")}
            </select>
          </div>
          <div class="field" style="justify-content:center">
            <label style="display:flex;align-items:center;gap:8px;font-weight:400">
              <input type="checkbox" name="anonymous" ${item.anonymous ? "checked" : ""}> Anonymous listing
            </label>
          </div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="500">${safe(item.description || "")}</textarea></div>
        </div>
        <div class="action-row">
          <button type="submit" class="btn btn-small">Save Changes</button>
          <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.cancelEditReport()">Cancel</button>
        </div>
      </form>
    `;
  }

  function render() {
    const root = document.getElementById("studentDashboardRoot");
    if (!root) return;

    const store = window.FOUNDIT.store;
    const state = store.getState();
    const user = store.getCurrentUser();

    if (!user) {
      root.innerHTML = `
        <div class="panel empty">
          <strong>Sign in to view your Student Dashboard</strong>
          <p class="muted" style="margin-bottom:14px">Log in or register to manage your lost/found reports, claim status tracking, notifications, and profile.</p>
          <div class="action-row" style="justify-content:center">
            <button type="button" class="btn" onclick="window.FOUNDIT.router.showPage('auth')">Sign in / Register</button>
          </div>
        </div>
      `;
      return;
    }

    const myItems = state.myReports || [];
    const myLost = myItems.filter((x) => x.type === "lost");
    const myFound = myItems.filter((x) => x.type === "found");
    const myClaims = (state.claims || []).filter((c) => c.claimantId === user.id);
    const returnedCount = myItems.filter((x) => x.status === "Returned").length;
    const myNotifs = store.getUserNotifications();
    const unreadNotifs = myNotifs.filter((n) => !n.read).length;

    const verifyReminder = !user.verified
      ? `
        <div class="notice" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <span><strong>Verification Reminder:</strong> Your email (${safe(user.email)}) is not yet verified.</span>
          <button type="button" class="btn btn-small" onclick="window.FOUNDIT.authPage.setMode('verify');window.FOUNDIT.router.showPage('auth')">Verify Email</button>
        </div>
      `
      : "";

    const statsHtml = `
      <div class="stats">
        <div class="stat"><strong>${myLost.length}</strong><small>My lost reports</small></div>
        <div class="stat"><strong>${myFound.length}</strong><small>My found reports</small></div>
        <div class="stat"><strong>${myClaims.length}</strong><small>My claims</small></div>
        <div class="stat"><strong>${returnedCount}</strong><small>Returned items</small></div>
      </div>
    `;

    const tabsHtml = `
      <div class="subtabs">
        <button type="button" class="${activeTab === "lost" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('lost')">My Lost Reports (${myLost.length})</button>
        <button type="button" class="${activeTab === "found" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('found')">My Found Reports (${myFound.length})</button>
        <button type="button" class="${activeTab === "claims" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('claims')">My Claims (${myClaims.length})</button>
        <button type="button" class="${activeTab === "notifications" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('notifications')">Notifications (${unreadNotifs} unread)</button>
        <button type="button" class="${activeTab === "profile" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('profile')">Profile Management</button>
      </div>
    `;

    let panelHtml = "";

    if (activeTab === "lost") {
      panelHtml = myLost.length
        ? myLost.map((item) => `
            <div class="action-card">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                <div>
                  <span class="tag lost">LOST</span>
                  <span class="tag ${statusTagClass(item.status)}">${safe(item.status)}</span>
                </div>
                <span class="muted" style="font-size:12px">${safe(item.location)} · ${safe(item.date)}</span>
              </div>
              <h3 style="margin:8px 0">${safe(item.name)}</h3>
              <p>${safe(item.description || "No description provided.")}</p>
              <div class="action-row">
                <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View details</button>
                ${item.status === "Open" ? `<button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.startEditReport('${safe(item.id)}')">Edit</button>` : ""}
                ${item.status === "Open" ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.markReturned('${safe(item.id)}')">Mark Found / Returned</button>` : ""}
                ${item.status === "Open" ? `<button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.studentDashboard.removeOwnReport('${safe(item.id)}')">Delete</button>` : ""}
              </div>
              ${editingItemId === item.id ? renderEditForm(item) : ""}
            </div>
          `).join("")
        : '<div class="empty"><strong>No lost reports yet</strong>Use Report Item if you misplaced something on campus.</div>';
    } else if (activeTab === "found") {
      panelHtml = myFound.length
        ? myFound.map((item) => {
            const relatedClaims = (state.claims || []).filter((c) => c.itemId === item.id && c.status !== "Rejected");
            return `
              <div class="action-card">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                  <div>
                    <span class="tag found">FOUND</span>
                    <span class="tag ${statusTagClass(item.status)}">${safe(item.status)}</span>
                  </div>
                  <span class="muted" style="font-size:12px">${safe(item.location)} · ${safe(item.date)}</span>
                </div>
                <h3 style="margin:8px 0">${safe(item.name)}</h3>
                <p>${safe(item.description || "No description provided.")}</p>
                ${relatedClaims.map((claim) => {
                  if (claim.status === "Approved" || claim.status === "Handover Pending" || claim.status === "Completed") {
                    return `
                      <div class="action-card" style="background:#FFF9F7">
                        <b>Approved claim</b>
                        <p>Ownership note: ${safe(claim.message)}</p>
                        <p class="status-line">Finder confirmation: ${claim.finderConfirmed ? "Confirmed ✓" : "Waiting"}</p>
                        <p class="status-line">Claimant confirmation: ${claim.claimantConfirmed ? "Confirmed ✓" : "Waiting"}</p>
                        ${!claim.finderConfirmed && item.status !== "Returned"
                          ? `<button type="button" class="btn btn-small" style="margin-top:8px" onclick="window.FOUNDIT.studentDashboard.confirmHandover('${safe(claim.id)}','finder')">I handed over the item</button>`
                          : ""}
                      </div>
                    `;
                  }
                  return `<p class="status-line">Pending claim (awaiting Admin review)</p>`;
                }).join("")}
                <div class="action-row">
                  <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View details</button>
                  ${item.status === "Open" ? `<button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.startEditReport('${safe(item.id)}')">Edit</button>` : ""}
                  ${item.status === "Open" ? `<button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.studentDashboard.removeOwnReport('${safe(item.id)}')">Delete</button>` : ""}
                </div>
                ${editingItemId === item.id ? renderEditForm(item) : ""}
              </div>
            `;
          }).join("")
        : '<div class="empty"><strong>No found reports yet</strong>Thanks for helping the JCET community stay connected.</div>';
    } else if (activeTab === "claims") {
      panelHtml = myClaims.length
        ? myClaims.map((claim) => `
            <div class="action-card">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                <h3>${safe(claim.itemName)}</h3>
                <span class="tag ${statusTagClass(claim.status)}">${safe(claim.status)}</span>
              </div>
              ${renderTimeline(claim)}
              <p><strong>Ownership explanation:</strong> ${safe(claim.message)}</p>
              <p class="muted">Preferred handover: ${safe(claim.handoverPreference || "Campus Welfare Desk")}</p>
              ${claim.adminNote ? `<p class="status-line">Admin note: ${safe(claim.adminNote)}</p>` : ""}
              ${claim.status === "Approved" || claim.status === "Handover Pending"
                ? `
                  <p class="status-line">Finder confirmation: ${claim.finderConfirmed ? "Confirmed ✓" : "Waiting"}</p>
                  <p class="status-line">Your receipt confirmation: ${claim.claimantConfirmed ? "Confirmed ✓" : "Waiting"}</p>
                  ${!claim.claimantConfirmed && claim.itemStatus !== "Returned"
                    ? `<button type="button" class="btn btn-small" style="margin-top:8px" onclick="window.FOUNDIT.studentDashboard.confirmHandover('${safe(claim.id)}','claimant')">I received the item</button>`
                    : ""}
                `
                : ""}
              <details style="margin-top:10px;font-size:12px">
                <summary style="cursor:pointer;color:#7A2D43;font-weight:700">Claim history (${(claim.history || []).length})</summary>
                <div style="margin-top:6px">
                  ${(claim.history || []).map((h) => `<p class="muted">• <b>${safe(h.status)}</b> (${formatDateTime(h.at)}) — ${safe(h.note)}</p>`).join("")}
                </div>
              </details>
            </div>
          `).join("")
        : '<div class="empty"><strong>No claims submitted</strong>Browse Found items and submit a claim if you recognise yours.</div>';
    } else if (activeTab === "notifications") {
      const filtered = notifFilter === "all"
        ? myNotifs
        : myNotifs.filter((n) => n.category === notifFilter);
      panelHtml = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            <div class="action-row" style="margin:0">
              ${["all", "claim", "report", "verification", "announcement"].map((cat) => `
                <button type="button" class="btn btn-small ${notifFilter === cat ? "" : "btn-outline"}" onclick="window.FOUNDIT.studentDashboard.setNotifFilter('${cat}')">${cat.toUpperCase()}</button>
              `).join("")}
            </div>
            <button type="button" class="btn btn-soft btn-small" onclick="window.FOUNDIT.navbar.markAllRead()">Mark all read</button>
          </div>
          ${filtered.length
            ? filtered.map((n) => `
                <div class="notif-item ${n.read ? "" : "unread"}" onclick="window.FOUNDIT.store.markNotificationRead('${safe(n.id)}')">
                  <h4>${safe(n.title)}</h4>
                  <p>${safe(n.message)}</p>
                  <div class="notif-meta">
                    <span>${safe(n.category.toUpperCase())} ${n.read ? "· Read" : "· Unread"}</span>
                    <span>${formatDateTime(n.createdAt)}</span>
                  </div>
                </div>
              `).join("")
            : '<div class="empty">No notifications in this category.</div>'}
        </div>
      `;
    } else if (activeTab === "profile") {
      panelHtml = `
        <div class="panel form-panel" style="margin:0">
          <div class="profile-row" style="margin-bottom:16px">
            <div>
              <h3>${safe(user.name)}</h3>
              <p class="muted">${safe(user.email)} · USN: ${safe(user.usn || "Not set")}</p>
            </div>
            <span class="tag ${user.verified ? "done" : "pending"}">${user.verified ? "Verified ✓" : "Unverified"}</span>
          </div>
          <form id="profileUpdateForm">
            <div class="form-grid">
              <div class="field"><label for="profName">Display Name *</label><input id="profName" required value="${safe(user.name)}"></div>
              <div class="field"><label for="profDept">Department / Branch</label><input id="profDept" value="${safe(user.department || "")}"></div>
              <div class="field"><label for="profPhone">Phone</label><input id="profPhone" value="${safe(user.phone || "")}"></div>
              <div class="field"><label>Student USN (protected)</label><input value="${safe(user.usn || "Not set")}" disabled></div>
            </div>
            <div class="action-row">
              <button class="btn" type="submit">Save Profile</button>
              ${!user.verified ? `<button type="button" class="btn btn-outline" onclick="window.FOUNDIT.authPage.setMode('verify');window.FOUNDIT.router.showPage('auth')">Verify Email</button>` : ""}
              <button type="button" class="btn btn-danger" onclick="window.FOUNDIT.navbar.handleLogout()">Logout</button>
            </div>
          </form>
        </div>
      `;
    }

    root.innerHTML = `${verifyReminder}${statsHtml}${tabsHtml}${panelHtml}`;

    document.getElementById("profileUpdateForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("profName").value.trim();
      const department = document.getElementById("profDept").value.trim();
      const phone = document.getElementById("profPhone").value.trim();
      if (name.length < 2) return toast("Display name must be at least 2 characters.");
      const res = await window.FOUNDIT.store.updateProfile({ name, department, phone });
      if (!res.ok) return toast(res.error);
      toast("Profile updated!");
    });

    root.querySelectorAll(".edit-report-form").forEach((form) => {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const itemId = form.dataset.itemId;
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        if (name.length < 2) return toast("Item name must be at least 2 characters.");
        const res = await window.FOUNDIT.store.updateItemDetails(itemId, {
          name,
          colour: String(fd.get("colour") || ""),
          location: String(fd.get("location") || ""),
          description: String(fd.get("description") || ""),
          anonymous: form.querySelector("input[name='anonymous']")?.checked || false
        });
        if (!res.ok) return toast(res.error);
        editingItemId = null;
        toast("Report details updated!");
      });
    });
  }

  return {
    setTab,
    setNotifFilter,
    confirmHandover,
    markReturned,
    removeOwnReport,
    startEditReport,
    cancelEditReport,
    render
  };
})();
