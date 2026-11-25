/* FOUNDIT — Live Supabase-Backed State Store with Realtime Subscriptions */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.store = (() => {
  const listeners = new Set();
  let realtimeChannel = null;
  let realtimeUserId = "__init__";
  let refreshDebounce = null;
  let inFlightRefresh = null;

  const state = {
    loading: true,
    error: "",
    currentUser: null,
    items: [],
    myReports: [],
    mySightings: [],
    claims: [],
    notifications: [],
    announcements: [],
    adminBundle: {
      reports: [],
      claims: [],
      users: [],
      auditLogs: []
    },
    pendingVerifyEmail: null
  };

  function notifyListeners() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error("Store listener error:", err);
      }
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getState() {
    return state;
  }

  function getCurrentUser() {
    return state.currentUser;
  }

  function getUserNotifications() {
    return state.notifications;
  }

  function scheduleRealtimeRefresh() {
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(() => {
      refreshAll();
    }, 350);
  }

  async function cleanupRealtime() {
    if (realtimeChannel) {
      try {
        const sb = window.FOUNDIT.supabaseClient.getClient();
        await sb.removeChannel(realtimeChannel);
      } catch (_) {}
      realtimeChannel = null;
    }
  }

  async function setupRealtime(user) {
    const targetKey = user?.id || "anon";
    if (realtimeChannel && realtimeUserId === targetKey) return;

    await cleanupRealtime();
    realtimeUserId = targetKey;

    try {
      const sb = window.FOUNDIT.supabaseClient.getClient();
      const channel = sb.channel(`foundit-live-${targetKey}`);

      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_reports" },
        () => scheduleRealtimeRefresh()
      );

      if (user?.id) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "claims" },
          () => scheduleRealtimeRefresh()
        );
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table: "item_sightings" },
          () => scheduleRealtimeRefresh()
        );
        channel.on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          (payload) => {
            const row = payload.new;
            if (row && (row.is_broadcast || row.user_id === user.id)) {
              window.FOUNDIT.helpers.toast(`🔔 ${row.title}`);
              scheduleRealtimeRefresh();
            }
          }
        );
      }

      channel.subscribe();
      realtimeChannel = channel;
    } catch (err) {
      console.warn("Realtime setup skipped:", err?.message || err);
    }
  }

  async function refreshAll() {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async () => {
      const { authService, reportsService, claimsService, notificationsService, adminService } = window.FOUNDIT;
      state.loading = true;
      state.error = "";
      try {
        const [user, publicItems] = await Promise.all([
          authService.getCurrentUserWithProfile(),
          reportsService.fetchPublicListings()
        ]);

        state.currentUser = user;
        state.items = publicItems;

        if (user) {
          const [myReports, claims, notifs] = await Promise.all([
            reportsService.fetchMyReports(user.id),
            claimsService.fetchVisibleClaims(),
            notificationsService.fetchNotifications(user)
          ]);
          state.myReports = myReports;
          state.claims = claims;
          state.notifications = notifs;
          state.mySightings = myReports.length
            ? await window.FOUNDIT.sightingsService.fetchForMyItems(myReports.map((r) => r.id))
            : [];

          if (user.role === "admin") {
            const bundleRes = await adminService.fetchDashboardBundle();
            if (bundleRes.ok) {
              state.adminBundle = bundleRes.data;
            }
          } else {
            state.adminBundle = { reports: [], claims: [], users: [], auditLogs: [] };
          }
        } else {
          state.myReports = [];
          state.mySightings = [];
          state.claims = [];
          state.adminBundle = { reports: [], claims: [], users: [], auditLogs: [] };
          state.notifications = await notificationsService.fetchNotifications(null);
        }

        state.announcements = state.notifications
          .filter((n) => n.category === "announcement")
          .map((n) => ({ id: n.id, title: n.title, message: n.message, active: true, createdAt: n.createdAt }));

        await setupRealtime(user);
      } catch (err) {
        console.error("Refresh error:", err);
        state.error = err?.message || "Could not connect to Supabase. Please retry.";
      } finally {
        state.loading = false;
        inFlightRefresh = null;
        notifyListeners();
      }
    })();
    return inFlightRefresh;
  }

  async function init() {
    window.addEventListener("beforeunload", () => {
      cleanupRealtime();
    });

    await refreshAll();
    window.FOUNDIT.authService.onAuthChange(async (event) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      if (event === "PASSWORD_RECOVERY") {
        window.FOUNDIT.authPage.setMode("reset");
        window.FOUNDIT.router.showPage("auth");
      }
      await refreshAll();
    });
  }

  async function markNotificationRead(id) {
    const target = state.notifications.find((n) => n.id === id);
    if (!target || target.read) return;
    target.read = true;
    notifyListeners();
    await window.FOUNDIT.notificationsService.markRead(target, state.currentUser);
  }

  async function markAllNotificationsRead() {
    if (!state.currentUser) return;
    await window.FOUNDIT.notificationsService.markAllRead(state.notifications, state.currentUser);
    state.notifications.forEach((n) => { n.read = true; });
    notifyListeners();
  }

  async function registerUser(payload) {
    const res = await window.FOUNDIT.authService.register(payload);
    if (res.ok) {
      state.pendingVerifyEmail = payload.email.trim().toLowerCase();
      await refreshAll();
    }
    return res;
  }

  async function loginUser(email, password) {
    const res = await window.FOUNDIT.authService.login(email, password);
    if (res.ok) {
      await refreshAll();
    }
    return res;
  }

  async function logout() {
    await cleanupRealtime();
    await window.FOUNDIT.authService.logout();
    state.currentUser = null;
    await refreshAll();
  }

  async function resendVerification(email) {
    return window.FOUNDIT.authService.resendVerificationEmail(email);
  }

  async function requestPasswordReset(email) {
    return window.FOUNDIT.authService.sendPasswordReset(email);
  }

  async function resetPassword(newPassword) {
    return window.FOUNDIT.authService.updatePassword(newPassword);
  }

  async function updateProfile(payload) {
    const res = await window.FOUNDIT.authService.updateOwnProfile(payload);
    if (res.ok) await refreshAll();
    return res;
  }

  async function createItem(payload, imageFile) {
    const res = await window.FOUNDIT.reportsService.createReport(payload, imageFile);
    if (res.ok) await refreshAll();
    return res;
  }

  async function updateItemStatus(itemId, status) {
    const res = await window.FOUNDIT.reportsService.updateOwnReportStatus(itemId, status);
    if (res.ok) await refreshAll();
    return res;
  }

  async function updateItemDetails(itemId, details) {
    const res = await window.FOUNDIT.reportsService.updateOwnReportDetails(itemId, details);
    if (res.ok) await refreshAll();
    return res;
  }

  async function flagItem(itemId, reason) {
    const res = await window.FOUNDIT.reportsService.flagReport(itemId, reason);
    if (res.ok) await refreshAll();
    return res;
  }

  async function deleteItem(itemId) {
    const res = await window.FOUNDIT.reportsService.deleteOwnReport(itemId);
    if (res.ok) await refreshAll();
    return res;
  }

  async function submitClaim(payload) {
    const res = await window.FOUNDIT.claimsService.submitClaim(payload);
    if (res.ok) await refreshAll();
    return res;
  }

  async function postSighting(payload) {
    const res = await window.FOUNDIT.sightingsService.postSighting(payload);
    if (res.ok) await refreshAll();
    return res;
  }

  async function deleteSighting(sightingId) {
    const res = await window.FOUNDIT.sightingsService.deleteSighting(sightingId);
    if (res.ok) await refreshAll();
    return res;
  }

  async function confirmHandover(claimId, role) {
    const res = await window.FOUNDIT.claimsService.confirmHandover(claimId, role);
    if (res.ok) await refreshAll();
    return res;
  }

  async function decideClaim(claimId, decision, note = "") {
    const res = await window.FOUNDIT.adminService.decideClaim(claimId, decision, note);
    if (res.ok) await refreshAll();
    return res;
  }

  async function adminUpdateReportStatus(itemId, status) {
    const res = await window.FOUNDIT.adminService.updateReportStatus(itemId, status);
    if (res.ok) await refreshAll();
    return res;
  }

  async function adminModerateReport(itemId, action) {
    const res = await window.FOUNDIT.adminService.moderateReport(itemId, action);
    if (res.ok) await refreshAll();
    return res;
  }

  async function adminSetUserStatus(userId, accountStatus) {
    const res = await window.FOUNDIT.adminService.setUserStatus(userId, accountStatus);
    if (res.ok) await refreshAll();
    return res;
  }

  async function publishAnnouncement(title, message) {
    const res = await window.FOUNDIT.adminService.publishAnnouncement(title, message);
    if (res.ok) await refreshAll();
    return res;
  }

  return {
    init,
    refreshAll,
    cleanupRealtime,
    subscribe,
    getState,
    getCurrentUser,
    getUserNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    registerUser,
    loginUser,
    logout,
    resendVerification,
    requestPasswordReset,
    resetPassword,
    updateProfile,
    createItem,
    updateItemStatus,
    updateItemDetails,
    flagItem,
    deleteItem,
    submitClaim,
    postSighting,
    deleteSighting,
    confirmHandover,
    decideClaim,
    adminUpdateReportStatus,
    adminModerateReport,
    adminSetUserStatus,
    publishAnnouncement
  };
})();
