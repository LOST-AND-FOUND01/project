/* FOUNDIT — Interactive Isometric JCET Campus Map */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.campusMap = (() => {
  const { safe } = window.FOUNDIT.helpers;
  let selectedZone = "Academic Block";

  function selectZone(zone, buttonEl) {
    selectedZone = zone;
    document.querySelectorAll(".map-building").forEach((el) => el.classList.remove("selected"));
    if (buttonEl) {
      buttonEl.classList.add("selected");
    } else {
      const match = [...document.querySelectorAll(".map-building")].find(
        (b) => b.dataset.zone === zone
      );
      if (match) match.classList.add("selected");
    }

    const titleEl = document.getElementById("mapZoneTitle");
    const countEl = document.getElementById("mapZoneCount");
    const reportsEl = document.getElementById("mapZoneReports");
    if (!titleEl || !countEl || !reportsEl) return;

    const items = window.FOUNDIT.store.getState().items.filter(
      (item) => item.location === zone && item.status !== "Archived"
    );
    titleEl.textContent = zone;
    countEl.textContent = `${items.length} report${items.length === 1 ? "" : "s"} here`;
    reportsEl.innerHTML = items.length
      ? items.slice(0, 4).map((item) => `
          <div class="map-report">
            <b>${safe(item.name)}</b>
            <p class="muted">${safe(item.type.toUpperCase())} · ${safe(item.status)}</p>
            <button class="btn btn-outline btn-small" style="margin-top:6px" onclick="window.FOUNDIT.itemCard.viewItem('${safe(item.id)}')">View item</button>
          </div>
        `).join("")
      : '<p class="muted">No reports in this area yet.</p>';
  }

  function reportAtSelectedZone() {
    window.FOUNDIT.router.showPage("report");
    const loc = document.getElementById("itemLocation");
    if (loc) loc.value = selectedZone;
  }

  function render() {
    selectZone(selectedZone);
  }

  return {
    selectZone,
    reportAtSelectedZone,
    render
  };
})();
