/* FOUNDIT — Application Router & Bootstrap (Supabase Integrated) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.router = (() => {
  const pages = ["home", "browse", "report", "dashboard", "admin", "auth"];

  function showPage(id) {
    if (!pages.includes(id)) id = "home";

    document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");

    document.querySelectorAll("#mainNav button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === id);
    });

    document.getElementById("mainNav")?.classList.remove("open");

    renderPage(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderPage(id) {
    if (id === "home") window.FOUNDIT.homePage.render();
    if (id === "browse") window.FOUNDIT.browsePage.render();
    if (id === "report") window.FOUNDIT.reportPage.render();
    if (id === "dashboard") window.FOUNDIT.studentDashboard.render();
    if (id === "admin") window.FOUNDIT.adminDashboard.render();
    if (id === "auth") window.FOUNDIT.authPage.render();
  }

  function renderAll() {
    window.FOUNDIT.navbar.render();
    const active = document.querySelector(".page.active")?.id || "home";
    renderPage(active);
  }

  return {
    showPage,
    renderAll
  };
})();

document.addEventListener("DOMContentLoaded", async () => {
  const { router, store, navbar, itemCard, reportPage, aiAssistant } = window.FOUNDIT;

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("show");
    });
  });

  navbar.bindGlobalEvents();
  itemCard.bindClaimForm();
  reportPage.init();
  aiAssistant.init();

  const params = new URLSearchParams(window.location.search);
  const zone = params.get("location");
  if (zone && window.FOUNDIT.MOCK_DATA.CAMPUS_ZONES.includes(zone)) {
    router.showPage("report");
    const select = document.getElementById("itemLocation");
    if (select) select.value = zone;
  } else if (!window.location.hash.includes("type=recovery")) {
    router.showPage("home");
  }
  navbar.render();

  store.subscribe(() => {
    router.renderAll();
  });

  await store.init();
});
