/* FOUNDIT — Claims & Two-Party Handover Service */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.claimsService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  function mapClaimRow(row) {
    const item = Array.isArray(row.item_reports) ? row.item_reports[0] : row.item_reports;
    return {
      id: row.id,
      itemId: row.item_id,
      claimantId: row.claimant_id,
      itemName: row.item_title || item?.title || "Campus Item",
      itemLocation: row.item_location || item?.location || "",
      itemSpecificLocation: row.item_specific_location || "",
      itemStatus: row.item_status || item?.status || "",
      finderId: row.finder_id || item?.reporter_id || null,
      finderName: row.finder_name || "Campus Member",
      message: row.ownership_explanation,
      handoverPreference: row.handover_preference || "",
      status: row.status,
      adminNote: row.admin_note || "",
      finderConfirmed: Boolean(row.finder_confirmed),
      claimantConfirmed: Boolean(row.claimant_confirmed),
      completedAt: row.completed_at,
      history: Array.isArray(row.history) ? row.history : [],
      createdAt: row.created_at
    };
  }

  async function fetchVisibleClaims() {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return [];

    const { data, error } = await sb.rpc("get_my_claims_with_finder");
    if (error) throw error;
    return (data || []).map(mapClaimRow);
  }

  async function submitClaim({ itemId, message, handoverPreference }) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return { ok: false, error: "Please sign in to submit a claim." };

    const { data, error } = await sb
      .from("claims")
      .insert({
        item_id: itemId,
        claimant_id: user.id,
        ownership_explanation: message.trim(),
        handover_preference: (handoverPreference || "").trim(),
        history: [{ status: "Pending", at: new Date().toISOString(), note: "Ownership explanation submitted" }]
      })
      .select("*, item_reports(title, location, status)")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, claim: mapClaimRow(data) };
  }

  async function confirmHandover(claimId, role) {
    const { data, error } = await client().rpc("confirm_handover", {
      p_claim_id: claimId,
      p_role: role
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, completed: Boolean(data?.completed), status: data?.status };
  }

  async function finderDecideClaim(claimId, decision, note = "") {
    const { data, error } = await client().rpc("finder_decide_claim", {
      p_claim_id: claimId,
      p_decision: decision,
      p_note: note
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, decision: data?.decision, conversationId: data?.conversation_id };
  }

  return {
    fetchVisibleClaims,
    submitClaim,
    confirmHandover,
    finderDecideClaim
  };
})();
