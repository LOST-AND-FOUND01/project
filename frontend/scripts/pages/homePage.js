/* FOUNDIT — Home Page */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.homePage = (() => {
  const { safe } = window.FOUNDIT.helpers;

  function render() {
    const state = window.FOUNDIT.store.getState();
    const visibleItems = state.items.filter((x) => x.status !== "Closed");
    const activeItems = visibleItems.filter((x) => x.status !== "Returned");

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setVal("totalCount", visibleItems.length);
    setVal("lostCount", visibleItems.filter((x) => x.type === "lost").length);
    setVal("foundCount", visibleItems.filter((x) => x.type === "found").length);
    setVal("returnedCount", visibleItems.filter((x) => x.status === "Returned").length);

    const annWrap = document.getElementById("homeAnnouncement");
    if (annWrap) {
      const latest = state.announcements.find((a) => a.active);
      annWrap.innerHTML = latest
        ? `
          <div class="announcement-bar">
            <div>
              <strong>📢 ${safe(latest.title)}:</strong>
              <span class="muted">${safe(latest.message)}</span>
            </div>
            <button class="btn btn-outline btn-small" onclick="window.FOUNDIT.router.showPage('browse')">Explore listings</button>
          </div>
        `
        : "";
    }

    const recent = [...activeItems].slice(0, 3);
    const grid = document.getElementById("recentGrid");
    if (grid) {
      if (state.loading && !visibleItems.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>Loading campus reports...</strong>Fetching live data from Supabase.</div>';
      } else if (state.error && !visibleItems.length) {
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Connection issue</strong><p class="muted" style="margin-bottom:10px">${safe(state.error)}</p><button type="button" class="btn btn-small" onclick="window.FOUNDIT.store.refreshAll()">Retry</button></div>`;
      } else {
        grid.innerHTML = recent.length
          ? recent.map(window.FOUNDIT.itemCard.renderCard).join("")
          : '<div class="empty" style="grid-column:1/-1"><strong>No reports yet</strong>Be the first to report an item.</div>';
      }
    }

    window.FOUNDIT.campusMap.render();
  }

  return { render };
})();
