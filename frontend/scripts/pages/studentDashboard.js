/* FOUNDIT — Student Dashboard (Finder Manage Claims, Owner My Claims, Private Chat, Return Confirmation, Notifications, Profile) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.studentDashboard = (() => {
  const { safe, formatDateTime, statusTagClass, toast } = window.FOUNDIT.helpers;
  let activeTab = "found"; // found | lost | claims | chat | notifications | profile
  let notifFilter = "all";
  let editingItemId = null;
  let activeConversationId = null;
  let loadedMessages = [];
  let loadingMessages = false;

  function setTab(tab) {
    activeTab = tab;
    render();
    if (tab === "chat" && activeConversationId) {
      openConversation(activeConversationId);
    }
  }

  function setNotifFilter(cat) {
    notifFilter = cat;
    render();
  }

  function renderTimeline(claim) {
    const isRejected = claim.status === "Rejected";
    const steps = [
      { label: "1. Claim Requested", done: true },
      { label: "2. Finder Review", done: claim.status !== "Pending", current: claim.status === "Pending" },
      {
        label: isRejected ? "3. Rejected" : "3. Claim Approved",
        done: claim.status === "Completed",
        current: claim.status === "Approved" || claim.status === "Handover Pending",
        rejected: isRejected
      },
      { label: "4. Returned", done: claim.status === "Completed" }
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

  async function finderDecideClaim(claimId, decision) {
    const note = window.prompt(`Optional note for ${decision.toLowerCase()} this claim:`, "") ?? "";
    const res = await window.FOUNDIT.store.finderDecideClaim(claimId, decision, note.trim());
    if (!res.ok) return toast(res.error);
    toast(decision === "Approved"
      ? "Claim approved! Private Finder–Owner Chat is now unlocked."
      : "Claim rejected.");
    if (decision === "Approved" && res.conversationId) {
      activeConversationId = res.conversationId;
    }
  }

  async function confirmItemReturned(itemId) {
    if (!window.confirm("Confirm Item Handed Over?\n\nOnly confirm after the item has been physically handed back to the owner. Returned items cannot be claimed again.")) {
      return;
    }
    const res = await window.FOUNDIT.store.confirmItemReturned(itemId);
    if (!res.ok) return toast(res.error);
    toast("Item marked as Returned!");
  }

  async function confirmHandover(claimId, role) {
    const msg = role === "finder"
      ? "Confirm that you have physically handed over this item?"
      : "Confirm that you have physically received this item?";
    if (!window.confirm(msg)) return;
    const res = await window.FOUNDIT.store.confirmHandover(claimId, role);
    if (!res.ok) return toast(res.error);
    toast(res.completed ? "Item successfully marked Returned!" : "Receipt confirmation saved.");
  }

  async function changeOwnStatus(itemId, status) {
    if (status === "Returned") {
      await confirmItemReturned(itemId);
      return;
    }
    const res = await window.FOUNDIT.store.updateItemStatus(itemId, status);
    if (!res.ok) return toast(res.error);
    toast(`Status updated to ${status}.`);
  }

  async function removeOwnReport(itemId) {
    if (!window.confirm("Delete this report and any uploaded photo?")) return;
    const res = await window.FOUNDIT.store.deleteItem(itemId);
    if (!res.ok) return toast(res.error);
    toast("Report deleted.");
  }

  function startEditReport(itemId) {
    editingItemId = itemId;
    render();
  }

  function cancelEditReport() {
    editingItemId = null;
    render();
  }

  async function openConversation(conversationId) {
    activeConversationId = conversationId;
    activeTab = "chat";
    loadingMessages = true;
    render();
    try {
      loadedMessages = await window.FOUNDIT.chatService.fetchMessages(conversationId);
      await window.FOUNDIT.chatService.markConversationRead(conversationId);
      // Update unread count locally
      const conv = (window.FOUNDIT.store.getState().conversations || []).find((c) => c.id === conversationId);
      if (conv) conv.unread_count = 0;
    } catch (err) {
      toast(err.message || "Could not load conversation.");
    } finally {
      loadingMessages = false;
      render();
      const box = document.getElementById("chatMessagesBox");
      if (box) box.scrollTop = box.scrollHeight;
    }
  }

  async function openChatForItemOrClaim(itemId, claimId = null) {
    const convs = window.FOUNDIT.store.getState().conversations || [];
    const match = convs.find((c) => (claimId && c.claim_id === claimId) || c.item_id === itemId);
    if (!match) {
      toast("Private chat unlocks once a claim is approved.");
      return;
    }
    await openConversation(match.id);
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
          <div class="field"><label>Specific Spot (optional)</label><input name="specificLocation" maxlength="200" value="${safe(item.specificLocation || "")}"></div>
          <div class="field full"><label>Description</label><textarea name="description" maxlength="500">${safe(item.description || "")}</textarea></div>
          <div class="field full" style="justify-content:center">
            <label style="display:flex;align-items:center;gap:8px;font-weight:400">
              <input type="checkbox" name="anonymous" ${item.anonymous ? "checked" : ""}> Anonymous listing
            </label>
          </div>
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
          <p class="muted" style="margin-bottom:14px">Log in or register to manage your lost/found reports, review claims, chat privately after claim approval, and track handovers.</p>
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
    const conversations = state.conversations || [];
    const unreadChatTotal = conversations.reduce((sum, c) => sum + Number(c.unread_count || 0), 0);

    const statsHtml = `
      <div class="stats">
        <div class="stat"><strong>${myFound.length}</strong><small>Found posts (Finder)</small></div>
        <div class="stat"><strong>${myLost.length}</strong><small>Lost posts</small></div>
        <div class="stat"><strong>${myClaims.length}</strong><small>My claims (Owner)</small></div>
        <div class="stat"><strong>${returnedCount}</strong><small>Returned items</small></div>
      </div>
    `;

    const tabsHtml = `
      <div class="subtabs">
        <button type="button" class="${activeTab === "found" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('found')">Found Posts &amp; Manage Claims (${myFound.length})</button>
        <button type="button" class="${activeTab === "lost" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('lost')">My Lost Reports (${myLost.length})</button>
        <button type="button" class="${activeTab === "claims" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('claims')">My Claims (${myClaims.length})</button>
        <button type="button" class="${activeTab === "chat" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('chat')">Private Chat (${conversations.length}${unreadChatTotal ? ` · ${unreadChatTotal} new` : ""})</button>
        <button type="button" class="${activeTab === "notifications" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('notifications')">Notifications (${unreadNotifs})</button>
        <button type="button" class="${activeTab === "profile" ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.setTab('profile')">Profile</button>
      </div>
    `;

    let panelHtml = "";

    if (activeTab === "found") {
      panelHtml = myFound.length
        ? myFound.map((item) => {
            const itemClaims = (state.claims || []).filter((c) => c.itemId === item.id);
            const pendingClaims = itemClaims.filter((c) => c.status === "Pending");
            const approvedClaim = itemClaims.find((c) => ["Approved", "Handover Pending", "Completed"].includes(c.status));

            return `
              <div class="action-card">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                  <div>
                    <span class="tag found">FOUND</span>
                    <span class="tag ${statusTagClass(item.status)}">${safe(item.status)}</span>
                  </div>
                  <span class="muted" style="font-size:12px">⌖ ${safe(item.location)}${item.specificLocation ? ` — ${safe(item.specificLocation)}` : ""} · ${safe(item.date)}</span>
                </div>
                <h3 style="margin:8px 0">${safe(item.name)}</h3>
                <p>${safe(item.description || "No description provided.")}</p>

                ${pendingClaims.length ? `
                  <div style="margin-top:12px;padding-top:10px;border-top:1px solid #7A2D4320">
                    <strong style="font-size:13px">Manage Incoming Claims (${pendingClaims.length} pending)</strong>
                    ${pendingClaims.map((claim) => `
                      <div class="action-card" style="background:#FFF9F7;margin:8px 0">
                        <p><strong>Ownership Proof:</strong> ${safe(claim.message)}</p>
                        <p class="muted">Preferred handover spot: ${safe(claim.handoverPreference || item.location)} · ${formatDateTime(claim.createdAt)}</p>
                        <div class="action-row">
                          <button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.finderDecideClaim('${safe(claim.id)}','Approved')">Approve Claim</button>
                          <button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.studentDashboard.finderDecideClaim('${safe(claim.id)}','Rejected')">Reject</button>
                        </div>
                      </div>
                    `).join("")}
                  </div>
                ` : ""}

                ${approvedClaim ? `
                  <div class="action-card" style="background:#FFF9F7;margin-top:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                      <strong>Approved Claim</strong>
                      <span class="tag ${statusTagClass(approvedClaim.status)}">${safe(approvedClaim.status)}</span>
                    </div>
                    <p>Proof: ${safe(approvedClaim.message)}</p>
                    <div class="action-row">
                      <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.openChatForItemOrClaim('${safe(item.id)}','${safe(approvedClaim.id)}')">Open Private Chat 💬</button>
                      ${item.status === "Claim Approved"
                        ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.confirmItemReturned('${safe(item.id)}')">Confirm Item Handed Over ✓</button>`
                        : ""}
                    </div>
                  </div>
                ` : ""}

                <div class="action-row" style="align-items:center">
                  <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View details</button>
                  ${["Available", "Claim Requested"].includes(item.status) ? `<button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.startEditReport('${safe(item.id)}')">Edit</button>` : ""}
                  ${item.status !== "Returned" ? `
                    <select aria-label="Update item return status" onchange="window.FOUNDIT.studentDashboard.changeOwnStatus('${safe(item.id)}', this.value)" style="width:auto;padding:6px 10px;font-size:12px">
                      <option value="Available" ${item.status === "Available" ? "selected" : ""}>Status: Available</option>
                      <option value="Claim Requested" ${item.status === "Claim Requested" ? "selected" : ""}>Status: Claim Requested</option>
                      <option value="Claim Approved" ${item.status === "Claim Approved" ? "selected" : ""}>Status: Claim Approved</option>
                      ${item.status === "Claim Approved" ? `<option value="Returned">Mark Returned...</option>` : ""}
                      <option value="Closed" ${item.status === "Closed" ? "selected" : ""}>Status: Closed</option>
                    </select>
                  ` : ""}
                  ${["Available", "Claim Requested"].includes(item.status) ? `<button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.studentDashboard.removeOwnReport('${safe(item.id)}')">Delete</button>` : ""}
                </div>
                ${editingItemId === item.id ? renderEditForm(item) : ""}
              </div>
            `;
          }).join("")
        : '<div class="empty"><strong>No found posts yet</strong>Post a found item to help return it to its owner.</div>';
    } else if (activeTab === "lost") {
      panelHtml = myLost.length
        ? myLost.map((item) => {
            const sightings = (state.mySightings || []).filter((s) => s.itemId === item.id);
            return `
            <div class="action-card">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                <div>
                  <span class="tag lost">LOST</span>
                  <span class="tag ${statusTagClass(item.status)}">${safe(item.status)}</span>
                </div>
                <span class="muted" style="font-size:12px">⌖ ${safe(item.location)}${item.specificLocation ? ` — ${safe(item.specificLocation)}` : ""} · ${safe(item.date)}</span>
              </div>
              <h3 style="margin:8px 0">${safe(item.name)}</h3>
              <p>${safe(item.description || "No description provided.")}</p>
              ${sightings.length ? `
                <div style="margin-top:10px;padding-top:8px;border-top:1px solid #7A2D4320">
                  <strong style="font-size:12px">Community Sightings / Found Updates (${sightings.length})</strong>
                  ${sightings.map((s) => `
                    <div class="action-card" style="background:#FFF9F7;padding:10px;margin:6px 0">
                      <span class="tag ${s.statusType === "found_it" ? "found" : "pending"}">${s.statusType === "found_it" ? "FOUND IT" : s.statusType === "spotted_it" ? "SPOTTED" : "TIP"}</span>
                      <strong style="font-size:12px">⌖ ${safe(s.foundLocation)}</strong>
                      <span class="muted" style="font-size:11px"> · ${safe(s.senderName)} · ${formatDateTime(s.createdAt)}</span>
                      <p style="margin:4px 0 0">${safe(s.message)}</p>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
              <div class="action-row">
                <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View details</button>
                ${["Available", "Claim Requested"].includes(item.status) ? `<button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.startEditReport('${safe(item.id)}')">Edit</button>` : ""}
                ${item.status !== "Returned" ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.confirmItemReturned('${safe(item.id)}')">Confirm Item Returned</button>` : ""}
                ${["Available", "Claim Requested"].includes(item.status) ? `<button type="button" class="btn btn-danger btn-small" onclick="window.FOUNDIT.studentDashboard.removeOwnReport('${safe(item.id)}')">Delete</button>` : ""}
              </div>
              ${editingItemId === item.id ? renderEditForm(item) : ""}
            </div>
          `;
          }).join("")
        : '<div class="empty"><strong>No lost reports yet</strong>Use Report Item if you misplaced something on campus.</div>';
    } else if (activeTab === "claims") {
      panelHtml = myClaims.length
        ? myClaims.map((claim) => `
            <div class="action-card">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                <h3>${safe(claim.itemName)}</h3>
                <span class="tag ${statusTagClass(claim.status)}">${safe(claim.status)}</span>
              </div>
              ${renderTimeline(claim)}
              <p><strong>Your ownership proof:</strong> ${safe(claim.message)}</p>
              <p class="muted">Preferred handover: ${safe(claim.handoverPreference || claim.itemLocation || "Campus Welfare Desk")}</p>
              ${claim.adminNote ? `<p class="status-line">Reviewer note: ${safe(claim.adminNote)}</p>` : ""}
              ${["Approved", "Handover Pending", "Completed"].includes(claim.status) ? `
                <div class="action-row">
                  <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.studentDashboard.openChatForItemOrClaim('${safe(claim.itemId)}','${safe(claim.id)}')">Open Private Finder–Owner Chat 💬</button>
                  ${["Approved", "Handover Pending"].includes(claim.status) && !claim.claimantConfirmed && claim.itemStatus !== "Returned"
                    ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.confirmHandover('${safe(claim.id)}','claimant')">Confirm Item Received</button>`
                    : ""}
                </div>
              ` : ""}
              <details style="margin-top:10px;font-size:12px">
                <summary style="cursor:pointer;color:#7A2D43;font-weight:700">Claim history (${(claim.history || []).length})</summary>
                <div style="margin-top:6px">
                  ${(claim.history || []).map((h) => `<p class="muted">• <b>${safe(h.status)}</b> (${formatDateTime(h.at)}) — ${safe(h.note)}</p>`).join("")}
                </div>
              </details>
            </div>
          `).join("")
        : '<div class="empty"><strong>No claims submitted</strong>Browse Found items and submit a claim if you recognise yours.</div>';
    } else if (activeTab === "chat") {
      if (!conversations.length) {
        panelHtml = '<div class="empty"><strong>No private conversations yet</strong>Private Finder–Owner Chat unlocks automatically once a claim is approved.</div>';
      } else {
        const selectedConv = conversations.find((c) => c.id === activeConversationId) || conversations[0];
        if (selectedConv && activeConversationId !== selectedConv.id) {
          activeConversationId = selectedConv.id;
          setTimeout(() => openConversation(selectedConv.id), 0);
        }

        panelHtml = `
          <div class="chat-shell">
            <div class="chat-list">
              ${conversations.map((c) => `
                <button type="button" class="chat-conv-btn ${selectedConv?.id === c.id ? "active" : ""}" onclick="window.FOUNDIT.studentDashboard.openConversation('${safe(c.id)}')">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
                    <strong style="font-size:13px">${safe(c.item_title)}</strong>
                    ${Number(c.unread_count) > 0 ? `<span class="badge-count">${Number(c.unread_count)}</span>` : ""}
                  </div>
                  <div class="muted" style="font-size:11px;margin-top:3px">With ${safe(c.other_user_name)} (${c.my_role === "finder" ? "Owner" : "Finder"}) · ${safe(c.item_status)}</div>
                  ${c.last_message ? `<div class="muted" style="font-size:11px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${safe(c.last_message)}</div>` : ""}
                </button>
              `).join("")}
            </div>
            <div class="panel chat-thread-box">
              ${selectedConv ? `
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;border-bottom:1px solid #7A2D4320;padding-bottom:10px">
                  <div>
                    <h3 style="font-size:16px">${safe(selectedConv.item_title)}</h3>
                    <p class="muted" style="font-size:12px">
                      Chatting with <strong>${safe(selectedConv.other_user_name)}</strong> · ⌖ ${safe(selectedConv.item_location)}${selectedConv.item_specific_location ? ` — ${safe(selectedConv.item_specific_location)}` : ""}
                    </p>
                  </div>
                  <div class="action-row" style="margin:0">
                    <span class="tag ${statusTagClass(selectedConv.item_status)}">${safe(selectedConv.item_status)}</span>
                    ${selectedConv.my_role === "finder" && selectedConv.item_status === "Claim Approved"
                      ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.studentDashboard.confirmItemReturned('${safe(selectedConv.item_id)}')">Confirm Item Handed Over</button>`
                      : ""}
                  </div>
                </div>
                <div class="notice" style="margin:8px 0 0;padding:8px 10px;font-size:11px">Privacy: Coordinate campus pickup location &amp; time here without sharing private phone numbers or emails.</div>
                <div id="chatMessagesBox" class="chat-messages">
                  ${loadingMessages
                    ? '<p class="muted">Loading messages...</p>'
                    : loadedMessages.length
                      ? loadedMessages.map((m) => `
                          <div class="chat-bubble ${m.sender_id === user.id ? "me" : "them"}">
                            <div>${safe(m.body)}</div>
                            <time>${formatDateTime(m.created_at)}</time>
                          </div>
                        `).join("")
                      : '<p class="muted">No messages yet. Send a message below to coordinate campus handover.</p>'}
                </div>
                <form id="privateChatForm" class="chat-send-row">
                  <input id="privateChatInput" required maxlength="1000" placeholder="Suggest pickup spot & time on campus..." autocomplete="off">
                  <button type="submit" class="btn btn-small">Send</button>
                </form>
              ` : ""}
            </div>
          </div>
        `;
      }
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
              <div class="field"><label for="profPhone">Phone (private)</label><input id="profPhone" value="${safe(user.phone || "")}"></div>
              <div class="field"><label>Student USN (protected)</label><input value="${safe(user.usn || "Not set")}" disabled></div>
            </div>
            <div class="action-row">
              <button class="btn" type="submit">Save Profile</button>
              <button type="button" class="btn btn-danger" onclick="window.FOUNDIT.navbar.handleLogout()">Logout</button>
            </div>
          </form>
        </div>
      `;
    }

    root.innerHTML = `${statsHtml}${tabsHtml}${panelHtml}`;

    document.getElementById("privateChatForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("privateChatInput");
      const text = input?.value?.trim() || "";
      if (!text || !activeConversationId) return;
      input.disabled = true;
      const res = await window.FOUNDIT.store.sendChatMessage(activeConversationId, text);
      input.disabled = false;
      if (!res.ok) return toast(res.error);
      input.value = "";
      await openConversation(activeConversationId);
    });

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
          specificLocation: String(fd.get("specificLocation") || ""),
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
    finderDecideClaim,
    confirmItemReturned,
    confirmHandover,
    changeOwnStatus,
    removeOwnReport,
    startEditReport,
    cancelEditReport,
    openConversation,
    openChatForItemOrClaim,
    render
  };
})();
