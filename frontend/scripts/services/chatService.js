/* FOUNDIT — Private Finder-Owner Chat Service (RLS-Protected Conversations & Messages) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.chatService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  async function fetchConversations() {
    const sb = client();
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) return [];

    const { data, error } = await sb.rpc("get_my_conversations");
    if (error) throw error;
    return data || [];
  }

  async function fetchMessages(conversationId) {
    const { data, error } = await client()
      .from("chat_messages")
      .select("id, conversation_id, sender_id, body, is_read, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async function sendMessage(conversationId, body) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return { ok: false, error: "Please sign in to send messages." };

    const clean = String(body || "").trim();
    if (!clean) return { ok: false, error: "Message cannot be empty." };

    const { data, error } = await sb
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: clean.slice(0, 1000)
      })
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, message: data };
  }

  async function markConversationRead(conversationId) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return;

    await sb
      .from("chat_messages")
      .update({ is_read: true })
      .eq("conversation_id", conversationId)
      .neq("sender_id", user.id)
      .eq("is_read", false);
  }

  return {
    fetchConversations,
    fetchMessages,
    sendMessage,
    markConversationRead
  };
})();
