/* FOUNDIT — Item Sightings / "I Found It" Location Updates Service */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.sightingsService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  function mapRow(r) {
    return {
      id: r.id,
      itemId: r.item_id,
      senderId: r.sender_id,
      senderName: r.sender_name || "Campus member",
      statusType: r.status_type,
      foundLocation: r.found_location,
      message: r.message,
      createdAt: r.created_at
    };
  }

  async function fetchForItem(itemId) {
    const sb = client();
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData?.session) return [];

    const { data, error } = await sb
      .from("public_item_sightings")
      .select("*")
      .eq("item_id", itemId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map(mapRow);
  }

  async function fetchForMyItems(itemIds) {
    if (!itemIds.length) return [];
    const sb = client();
    const { data, error } = await sb
      .from("public_item_sightings")
      .select("*")
      .in("item_id", itemIds)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []).map(mapRow);
  }

  async function postSighting({ itemId, statusType, foundLocation, message }) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return { ok: false, error: "Please sign in to post a sighting or found update." };

    const { data, error } = await sb
      .from("item_sightings")
      .insert({
        item_id: itemId,
        sender_id: user.id,
        status_type: statusType,
        found_location: foundLocation,
        message: message.trim()
      })
      .select("*")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, sighting: mapRow(data) };
  }

  async function deleteSighting(sightingId) {
    const { error } = await client()
      .from("item_sightings")
      .delete()
      .eq("id", sightingId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return {
    fetchForItem,
    fetchForMyItems,
    postSighting,
    deleteSighting
  };
})();
