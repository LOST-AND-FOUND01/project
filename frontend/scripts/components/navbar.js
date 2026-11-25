/* FOUNDIT — Navbar, Auth Status Pill, Notification Bell & Dropdown */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.navbar = (() => {
  const { safe, formatDateTime, toast } = window.FOUNDIT.helpers;

  function render() {
    const store = window.FOUNDIT.store;
    const user = store.getCurrentUser();
    const notifications = store.getUserNotifications();
    const unreadCount = notifications.filter((n) => !n.read).length;

    const badgeEl = document.getElementById("notifBadge");
    if (badgeEl) {
      badgeEl.textContent = unreadCount;
      badgeEl.style.display = unreadCount > 0 ? "inline-block" : "none";
    }

    const listEl = document.getElementById("notifDropdownList");
    if (listEl) {
      listEl.innerHTML = notifications.length
        ? notifications.slice(0, 8).map((n) => `
          <div class="notif-item ${n.read ? "" : "unread"}" onclick="window.FOUNDIT.navbar.openNotification('${safe(n.id)}','${safe(n.actionPage || "dashboard")}')">
            <h4>${safe(n.title)}</h4>
            <p>${safe(n.message)}</p>
            <div class="notif-meta">
              <span>${safe(n.category.toUpperCase())}</span>
              <span>${formatDateTime(n.createdAt)}</span>
            </div>
          </div>
        `).join("")
        : '<div class="notif-item"><p class="muted">No notifications yet.</p></div>';
    }

    const authSlot = document.getElementById("navAuthSlot");
    if (authSlot) {
      if (user) {
        authSlot.innerHTML = `
          <span class="user-pill" title="${safe(user.email)} (${safe(user.role)})">
            ${safe(user.name.split(" ")[0])} ${user.verified ? "✓" : "· Unverified"}
          </span>
          <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.navbar.handleLogout()">Logout</button>
        `;
      } else {
        authSlot.innerHTML = `
          <button type="button" class="btn btn-small" onclick="window.FOUNDIT.router.showPage('auth')">Sign in</button>
        `;
      }
    }
  }

  function toggleNotifications(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById("notifDropdown");
    const btn = document.getElementById("notifBellBtn");
    if (dd) {
      const open = dd.classList.toggle("open");
      if (btn) btn.setAttribute("aria-expanded", String(open));
    }
  }

  async function openNotification(id, page) {
    await window.FOUNDIT.store.markNotificationRead(id);
    const dd = document.getElementById("notifDropdown");
    if (dd) dd.classList.remove("open");
    if (page === "dashboard") {
      window.FOUNDIT.studentDashboard?.setTab("notifications");
    }
    window.FOUNDIT.router.showPage(page || "dashboard");
  }

  async function markAllRead() {
    await window.FOUNDIT.store.markAllNotificationsRead();
    toast("All notifications marked as read.");
  }

  function toggleMobileMenu() {
    const nav = document.getElementById("mainNav");
    const btn = document.querySelector(".mobile-menu-btn");
    if (nav) {
      const open = nav.classList.toggle("open");
      if (btn) btn.setAttribute("aria-expanded", String(open));
    }
  }

  async function handleLogout() {
    try {
      await window.FOUNDIT.store.logout();
      toast("Signed out.");
      window.FOUNDIT.router.showPage("home");
    } catch (err) {
      toast(err.message || "Logout failed.");
    }
  }

  function bindGlobalEvents() {
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("notifDropdown");
      const btn = document.getElementById("notifBellBtn");
      if (dd && dd.classList.contains("open") && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
        dd.classList.remove("open");
      }
    });
  }

  return {
    render,
    toggleNotifications,
    openNotification,
    markAllRead,
    toggleMobileMenu,
    handleLogout,
    bindGlobalEvents
  };
})();
