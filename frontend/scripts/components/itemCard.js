/* FOUNDIT — Reusable Item Card, Item Details Modal & Claim Submission */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.itemCard = (() => {
  const { safe, statusTagClass, openModal, closeModal, toast } = window.FOUNDIT.helpers;

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
          </div>
        </div>
      </article>
    `;
  }

  function viewItem(id) {
    const state = window.FOUNDIT.store.getState();
    const x = state.items.find((i) => i.id === id) || state.myReports.find((i) => i.id === id);
    if (!x) return;

    const statusClass = statusTagClass(x.status);

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
      <div class="action-row" style="margin-top:16px">
        ${x.type === "found" && x.status === "Open"
          ? `<button type="button" class="btn" onclick="window.FOUNDIT.itemCard.openClaim('${safe(x.id)}')">This is mine — submit claim</button>`
          : ""}
        <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.flagListing('${safe(x.id)}')">Flag for moderation</button>
      </div>
    `;
    openModal("itemModal");
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
    flagListing,
    openClaim,
    bindClaimForm
  };
})();
