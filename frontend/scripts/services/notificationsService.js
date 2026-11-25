/* FOUNDIT — Notifications & Broadcast Announcements Service */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.notificationsService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  async function fetchNotifications(user) {
    const sb = client();
    const { data: rows, error } = await sb
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    const list = rows || [];

    let readBroadcastIds = new Set();
    if (user?.id) {
      const { data: reads } = await sb
        .from("notification_reads")
        .select("notification_id")
        .eq("user_id", user.id);
      readBroadcastIds = new Set((reads || []).map((r) => r.notification_id));
    }

    return list.map((n) => ({
      id: n.id,
      recipient: n.is_broadcast ? "all" : n.user_id,
      isBroadcast: Boolean(n.is_broadcast),
      category: n.category,
      title: n.title,
      message: n.message,
      actionPage: n.action_page || "dashboard",
      read: n.is_broadcast ? readBroadcastIds.has(n.id) : Boolean(n.is_read),
      createdAt: n.created_at
    }));
  }

  async function markRead(notification, user) {
    if (!user?.id) return;
    const sb = client();
    if (notification.isBroadcast) {
      await sb.from("notification_reads").upsert(
        { notification_id: notification.id, user_id: user.id },
        { onConflict: "notification_id,user_id" }
      );
    } else {
      await sb
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notification.id)
        .eq("user_id", user.id);
    }
  }

  async function markAllRead(notifications, user) {
    if (!user?.id) return;
    const unread = notifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => markRead(n, user)));
  }

  return {
    fetchNotifications,
    markRead,
    markAllRead
  };
})();
