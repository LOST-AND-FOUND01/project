/* FOUNDIT — Browse & Smart Matches Page */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.browsePage = (() => {
  const { safe } = window.FOUNDIT.helpers;
  const PAGE_SIZE = 9;
  let visibleLimit = PAGE_SIZE;

  function loadMore() {
    visibleLimit += PAGE_SIZE;
    render(false);
  }

  function populateSelects() {
    const { CATEGORIES, CAMPUS_ZONES } = window.FOUNDIT.MOCK_DATA;
    const catSelect = document.getElementById("categoryFilter");
    const locSelect = document.getElementById("locationFilter");

    if (catSelect && catSelect.options.length <= 1) {
      CATEGORIES.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        catSelect.appendChild(opt);
      });
    }

    if (locSelect && locSelect.options.length <= 1) {
      CAMPUS_ZONES.forEach((z) => {
        const opt = document.createElement("option");
        opt.value = z;
        opt.textContent = z;
        locSelect.appendChild(opt);
      });
    }
  }

  function clearFilters() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    set("searchBox", "");
    set("typeFilter", "all");
    set("categoryFilter", "all");
    set("locationFilter", "all");
    set("statusFilter", "active");
    set("sortFilter", "newest");
    render();
  }

  function render(resetLimit = true) {
    if (resetLimit) visibleLimit = PAGE_SIZE;
    populateSelects();
    const state = window.FOUNDIT.store.getState();

    const search = (document.getElementById("searchBox")?.value || "").trim().toLowerCase();
    const type = document.getElementById("typeFilter")?.value || "all";
    const category = document.getElementById("categoryFilter")?.value || "all";
    const location = document.getElementById("locationFilter")?.value || "all";
    const status = document.getElementById("statusFilter")?.value || "active";
    const sort = document.getElementById("sortFilter")?.value || "newest";

    let results = state.items.filter((x) => {
      if (x.status === "Closed" && status !== "Closed" && status !== "all") return false;
      const matchesType = type === "all" || x.type === type;
      const matchesCat = category === "all" || x.category === category;
      const matchesLoc = location === "all" || x.location === location;
      const matchesStatus = status === "all"
        ? true
        : status === "active"
          ? !["Returned", "Closed"].includes(x.status)
          : x.status === status;
      const haystack = `${x.name} ${x.description} ${x.colour} ${x.location} ${x.specificLocation || ""} ${x.category}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesType && matchesCat && matchesLoc && matchesStatus && matchesSearch;
    });

    if (sort === "newest") {
      results = [...results].sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    } else if (sort === "oldest") {
      results = [...results].sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));
    } else if (sort === "name") {
      results = [...results].sort((a, b) => a.name.localeCompare(b.name));
    }

    const countEl = document.getElementById("browseResultCount");
    if (countEl) {
      countEl.textContent = `Showing ${results.length} report${results.length === 1 ? "" : "s"}`;
    }

    const grid = document.getElementById("browseGrid");
    if (grid) {
      if (state.loading && !state.items.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><strong>Loading reports...</strong>Connecting to Supabase.</div>';
      } else if (state.error && !state.items.length) {
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>Unable to load listings</strong><p class="muted" style="margin-bottom:10px">${safe(state.error)}</p><button type="button" class="btn btn-small" onclick="window.FOUNDIT.store.refreshAll()">Retry</button></div>`;
      } else {
        const sliced = results.slice(0, visibleLimit);
        const cardsHtml = sliced.map(window.FOUNDIT.itemCard.renderCard).join("");
        const moreBtn = results.length > visibleLimit
          ? `<div style="grid-column:1/-1;text-align:center;margin-top:10px"><button type="button" class="btn btn-outline" onclick="window.FOUNDIT.browsePage.loadMore()">Show more (${results.length - visibleLimit} remaining)</button></div>`
          : "";
        grid.innerHTML = results.length
          ? cardsHtml + moreBtn
          : '<div class="empty" style="grid-column:1/-1"><strong>No matching reports</strong>Try changing your search or clearing filters.</div>';
      }
    }

    renderSmartMatches();
  }

  function renderSmartMatches() {
    const items = window.FOUNDIT.store.getState().items;
    const activeStatuses = ["Available", "Claim Requested"];
    const lostItems = items.filter((x) => x.type === "lost" && activeStatuses.includes(x.status));
    const foundItems = items.filter((x) => x.type === "found" && activeStatuses.includes(x.status));
    const output = [];

    lostItems.forEach((lost) => {
      const matches = foundItems.filter(
        (found) => found.category === lost.category && found.location === lost.location
      );
      matches.forEach((found) => {
        output.push(`
          <div class="action-card">
            <span class="tag">Possible match</span>
            <p><b>Lost:</b> ${safe(lost.name)} · ${safe(lost.location)}</p>
            <p><b>Found:</b> ${safe(found.name)} · ${safe(found.location)}</p>
            <p class="muted">Same category (${safe(lost.category)}) and campus location. Suggestion only — not proof of ownership.</p>
            <button class="btn btn-outline btn-small" onclick="window.FOUNDIT.itemCard.viewItem('${safe(found.id)}')">View found item</button>
          </div>
        `);
      });
    });

    const el = document.getElementById("smartMatches");
    if (el) {
      el.innerHTML = output.length
        ? output.join("")
        : '<div class="empty">No possible matches yet. New reports may create matches.</div>';
    }
  }

  return {
    render,
    clearFilters,
    loadMore
  };
})();
