/* FOUNDIT — Privileged Admin Edge Function Service (No client-side trust) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.adminService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  async function callAdminOps(action, payload = {}) {
    const sb = client();
    const { data, error } = await sb.functions.invoke("admin-ops", {
      body: { action, payload }
    });
    if (error) {
      let message = error.message || "Admin request failed.";
      try {
        const ctx = await error.context?.json?.();
        if (ctx?.error) message = ctx.error;
      } catch (_) {}
      return { ok: false, error: message };
    }
    if (data?.error) return { ok: false, error: data.error };
    return { ok: true, data };
  }

  function fetchDashboardBundle() {
    return callAdminOps("get_dashboard_bundle");
  }

  function decideClaim(claimId, decision, note = "") {
    return callAdminOps("decide_claim", { claimId, decision, note });
  }

  function updateReportStatus(itemId, status) {
    return callAdminOps("update_report_status", { itemId, status });
  }

  function moderateReport(itemId, moderationAction) {
    return callAdminOps("moderate_report", { itemId, moderationAction });
  }

  function setUserStatus(targetUserId, accountStatus) {
    return callAdminOps("set_user_status", { targetUserId, accountStatus });
  }

  function publishAnnouncement(title, message) {
    return callAdminOps("publish_announcement", { title, message });
  }

  return {
    fetchDashboardBundle,
    decideClaim,
    updateReportStatus,
    moderateReport,
    setUserStatus,
    publishAnnouncement
  };
})();
