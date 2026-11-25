/* FOUNDIT — Reusable Item Card, Item Details Modal, Sightings/Found-It Updates & Claim Submission */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.itemCard = (() => {
  const { safe, statusTagClass, formatDateTime, openModal, closeModal, toast } = window.FOUNDIT.helpers;

  function isSafeImg(url) {
    return /^https:\/\/|^data:image\//i.test(String(url || ""));
  }

  function renderCard(item) {
    const image = isSafeImg(item.photo)
      ? `<img src="${safe(item.photo)}" alt="${safe(item.name)}" loading="lazy">`
      : `<span>${item.type === "lost" ? "⌖" : "✧"}</span>`;
    const statusClass = statusTagClass(item.status);

    return `
      <article class="card">
        <div class="card-image">${image}</div>
        <div class="card-body">
          <div>
            <span class="tag ${safe(item.type)}">${safe(item.type.toUpperCase())}</span>
            <span class="tag ${statusClass}">${safe(item.status)}</span>
            ${item.flagged ? '<span class="tag rejected">Flagged</span>' : ""}
          </div>
          <h3>${safe(item.name)}</h3>
          <p>${safe(item.category)} · ${safe(item.colour || "Colour not specified")}</p>
          <p>⌖ ${safe(item.location)} · ${safe(item.date)}</p>
          <p>${safe(item.description || "No description provided.")}</p>
          <div class="card-footer">
            <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View details</button>
            ${item.type === "found" && item.status === "Open"
              ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.itemCard.openClaim('${safe(item.id)}')">Claim</button>`
              : ""}
            ${item.type === "lost" && item.status === "Open"
              ? `<button type="button" class="btn btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}', true)">I found it / Update</button>`
              : ""}
          </div>
        </div>
      </article>
    `;
  }

  function sightingLabel(statusType) {
    if (statusType === "found_it") return { text: "I FOUND IT", cls: "found" };
    if (statusType === "spotted_it") return { text: "SPOTTED HERE", cls: "pending" };
    return { text: "HELPFUL TIP", cls: "" };
  }

  async function loadAndRenderSightings(itemId, defaultLocation) {
    const listEl = document.getElementById("itemSightingsList");
    if (!listEl) return;

    const user = window.FOUNDIT.store.getCurrentUser();
    if (!user) {
      listEl.innerHTML = '<p class="muted" style="font-size:12px">Sign in to view or post community sighting updates.</p>';
      return;
    }

    try {
      const sightings = await window.FOUNDIT.sightingsService.fetchForItem(itemId);
      if (!sightings.length) {
        listEl.innerHTML = '<p class="muted" style="font-size:12px">No location updates posted yet. If you spotted or found this item, leave an update below.</p>';
        return;
      }

      listEl.innerHTML = sightings.map((s) => {
        const lbl = sightingLabel(s.statusType);
        const canDelete = s.senderId === user.id || user.role === "admin";
        return `
          <div class="action-card" style="padding:12px;margin:8px 0">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <div>
                <span class="tag ${lbl.cls}">${lbl.text}</span>
                <strong style="font-size:12px">⌖ ${safe(s.foundLocation)}</strong>
              </div>
              <span class="muted" style="font-size:11px">${safe(s.senderName)} · ${formatDateTime(s.createdAt)}</span>
            </div>
            <p style="margin:6px 0 0;color:#7A2D43">${safe(s.message)}</p>
            ${canDelete ? `<div style="margin-top:6px"><button type="button" class="link-btn" style="font-size:11px" onclick="window.FOUNDIT.itemCard.removeSighting('${safe(s.id)}','${safe(itemId)}','${safe(defaultLocation)}')">Delete update</button></div>` : ""}
          </div>
        `;
      }).join("");
    } catch (err) {
      listEl.innerHTML = `<p class="muted" style="font-size:12px">Could not load updates: ${safe(err.message)}</p>`;
    }
  }

  async function removeSighting(sightingId, itemId, defaultLocation) {
    const res = await window.FOUNDIT.store.deleteSighting(sightingId);
    if (!res.ok) return toast(res.error);
    toast("Sighting update removed.");
    await loadAndRenderSightings(itemId, defaultLocation);
  }

  function viewItem(id, focusSighting = false) {
    const state = window.FOUNDIT.store.getState();
    const x = state.items.find((i) => i.id === id) || state.myReports.find((i) => i.id === id);
    if (!x) return;

    const user = window.FOUNDIT.store.getCurrentUser();
    const statusClass = statusTagClass(x.status);
    const zones = window.FOUNDIT.MOCK_DATA.CAMPUS_ZONES;

    const sightingFormHtml = x.status === "Open"
      ? (user
          ? `
            <form id="itemSightingForm" style="margin-top:12px">
              <div class="form-grid" style="gap:10px">
                <div class="field" style="margin-bottom:0">
                  <label for="sightingType">Update type *</label>
                  <select id="sightingType" required>
                    <option value="found_it">I have found this item</option>
                    <option value="spotted_it">I spotted it at a location</option>
                    <option value="info">Helpful note / did not find</option>
                  </select>
                </div>
                <div class="field" style="margin-bottom:0">
                  <label for="sightingLocation">Location *</label>
                  <select id="sightingLocation" required>
                    ${zones.map((z) => `<option value="${safe(z)}" ${z === x.location ? "selected" : ""}>${safe(z)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="field" style="margin-top:10px;margin-bottom:10px">
                <label for="sightingMessage">Message for the owner *</label>
                <textarea id="sightingMessage" required maxlength="600" style="min-height:70px" placeholder="e.g. Found near the 2nd floor reading table, handed to Library counter."></textarea>
              </div>
              <button type="submit" class="btn btn-small">Post location update ↗</button>
            </form>
          `
          : `
            <div class="notice" style="margin-top:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <span>Sign in to tell the owner where you spotted or found this item.</span>
              <button type="button" class="btn btn-small" onclick="window.FOUNDIT.helpers.closeModal('itemModal');window.FOUNDIT.router.showPage('auth')">Sign in</button>
            </div>
          `)
      : "";

    document.getElementById("itemDetails").innerHTML = `
      <div style="margin-bottom:10px">
        <span class="tag ${safe(x.type)}">${safe(x.type.toUpperCase())}</span>
        <span class="tag ${statusClass}">${safe(x.status)}</span>
      </div>
      <h2 style="margin-bottom:12px">${safe(x.name)}</h2>
      ${isSafeImg(x.photo) ? `<img src="${safe(x.photo)}" alt="${safe(x.name)}" style="width:100%;max-height:240px;object-fit:contain;border-radius:8px;margin-bottom:12px;border:1px solid #7A2D4320">` : ""}
      <p class="muted" style="margin:6px 0"><strong>Category:</strong> ${safe(x.category)} · <strong>Colour:</strong> ${safe(x.colour || "Not specified")}</p>
      <p class="muted" style="margin:6px 0"><strong>Location:</strong> ${safe(x.location)} · <strong>Date:</strong> ${safe(x.date)}</p>
      <p style="margin:12px 0;line-height:1.6">${safe(x.description || "No public description provided.")}</p>
      <p class="muted" style="font-size:12px"><strong>Reporter:</strong> ${x.anonymous ? "Anonymous" : safe(x.reporter || "Campus member")}</p>
      <div class="action-row" style="margin-top:14px">
        ${x.type === "found" && x.status === "Open"
          ? `<button type="button" class="btn" onclick="window.FOUNDIT.itemCard.openClaim('${safe(x.id)}')">This is mine — submit claim</button>`
          : ""}
        <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.flagListing('${safe(x.id)}')">Flag for moderation</button>
      </div>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #7A2D4320">
        <h3 style="font-size:16px;margin-bottom:6px">${x.type === "lost" ? "Found / Spotted Updates for Owner" : "Location Notes & Updates"}</h3>
        <div id="itemSightingsList"><p class="muted" style="font-size:12px">Loading updates...</p></div>
        ${sightingFormHtml}
      </div>
    `;

    openModal("itemModal");
    loadAndRenderSightings(x.id, x.location);

    const form = document.getElementById("itemSightingForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const statusType = document.getElementById("sightingType").value;
        const foundLocation = document.getElementById("sightingLocation").value;
        const message = document.getElementById("sightingMessage").value.trim();

        if (message.length < 3) {
          toast("Please enter at least 3 characters in your message.");
          return;
        }

        const btn = form.querySelector("button[type='submit']");
        if (btn) btn.disabled = true;
        const res = await window.FOUNDIT.store.postSighting({
          itemId: x.id,
          statusType,
          foundLocation,
          message
        });
        if (btn) btn.disabled = false;

        if (!res.ok) return toast(res.error);
        form.reset();
        document.getElementById("sightingLocation").value = x.location;
        toast("Location update posted! The item owner has been notified.");
        await loadAndRenderSightings(x.id, x.location);
      });
    }

    if (focusSighting) {
      setTimeout(() => {
        document.getElementById("sightingMessage")?.focus();
      }, 120);
    }
  }

  async function flagListing(id) {
    const user = window.FOUNDIT.store.getCurrentUser();
    if (!user) {
      closeModal("itemModal");
      toast("Please sign in to flag a listing.");
      window.FOUNDIT.router.showPage("auth");
      return;
    }
    const reason = window.prompt("Optional reason for flagging this listing:", "Contains sensitive details or duplicate entry");
    if (reason === null) return;
    const res = await window.FOUNDIT.store.flagItem(id, reason.trim() || "Flagged by campus user");
    if (!res.ok) return toast(res.error);
    closeModal("itemModal");
    toast("Listing flagged for administrator review.");
  }

  function openClaim(id) {
    closeModal("itemModal");
    const user = window.FOUNDIT.store.getCurrentUser();
    if (!user) {
      toast("Please sign in to submit an ownership claim.");
      window.FOUNDIT.router.showPage("auth");
      return;
    }

    const state = window.FOUNDIT.store.getState();
    const item = state.items.find((x) => x.id === id);
    if (!item) return;

    document.getElementById("claimItemId").value = id;
    document.getElementById("claimItemLabel").textContent = `Claiming: ${item.name} (${item.location})`;
    document.getElementById("claimName").value = user.name;
    document.getElementById("claimEmail").value = user.email;
    document.getElementById("claimHandoverPref").value = item.location;
    document.getElementById("claimMessage").value = "";
    openModal("claimModal");
  }

  function bindClaimForm() {
    const form = document.getElementById("claimForm");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const itemId = document.getElementById("claimItemId").value;
      const handoverPreference = document.getElementById("claimHandoverPref").value.trim();
      const message = document.getElementById("claimMessage").value.trim();

      if (message.length < 10) {
        toast("Please provide at least 10 characters explaining ownership.");
        return;
      }

      const btn = form.querySelector("button[type='submit']");
      if (btn) btn.disabled = true;
      const res = await window.FOUNDIT.store.submitClaim({ itemId, message, handoverPreference });
      if (btn) btn.disabled = false;

      if (!res.ok) {
        toast(res.error);
        return;
      }
      form.reset();
      closeModal("claimModal");
      toast("Claim submitted! Track its status in My Dashboard.");
    });
  }

  return {
    renderCard,
    viewItem,
    removeSighting,
    flagListing,
    openClaim,
    bindClaimForm
  };
})();
