/* FOUNDIT — Item Reports & Private Storage Service */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.reportsService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

  function mapListingRow(row, photoMap = {}) {
    return {
      id: row.id,
      reporterId: row.reporter_id,
      name: row.title,
      type: row.report_type,
      category: row.category,
      colour: row.colour || "",
      location: row.location,
      specificLocation: row.specific_location || "",
      date: row.incident_date,
      description: row.description || "",
      anonymous: Boolean(row.is_anonymous),
      reporter: row.reporter_display_name || "Campus member",
      status: row.status,
      flagged: Boolean(row.is_flagged),
      photo: photoMap[row.id] || "",
      createdAt: row.created_at
    };
  }

  async function fetchSignedPhotoUrls(itemIds) {
    if (!itemIds.length) return {};
    try {
      const sb = client();
      const { data, error } = await sb.functions.invoke("get-photo-urls", {
        body: { itemIds }
      });
      if (error || !data?.urls) return {};
      return data.urls;
    } catch (_) {
      return {};
    }
  }

  async function fetchPublicListings() {
    const sb = client();
    const { data, error } = await sb
      .from("public_item_listings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = data || [];
    const photoMap = await fetchSignedPhotoUrls(rows.map((r) => r.id));
    return rows.map((r) => mapListingRow(r, photoMap));
  }

  async function fetchMyReports(userId) {
    const sb = client();
    const { data, error } = await sb
      .from("item_reports")
      .select("*")
      .eq("reporter_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const photoMap = await fetchSignedPhotoUrls(rows.map((r) => r.id));
    return rows.map((r) =>
      mapListingRow({ ...r, reporter_display_name: "You" }, photoMap)
    );
  }

  async function createReport(payload, imageFile) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return { ok: false, error: "Please sign in to submit a report." };

    if (imageFile) {
      if (!ALLOWED_TYPES.includes(imageFile.type)) {
        return { ok: false, error: "Only JPEG, PNG, and WebP images are allowed." };
      }
      if (imageFile.size > MAX_BYTES) {
        return { ok: false, error: "Image must be 2 MB or smaller." };
      }
    }

    const { data: inserted, error: insErr } = await sb
      .from("item_reports")
      .insert({
        reporter_id: user.id,
        title: payload.name.trim(),
        report_type: payload.type,
        category: payload.category,
        colour: payload.colour.trim(),
        location: payload.location,
        specific_location: (payload.specificLocation || "").trim(),
        incident_date: payload.date || new Date().toISOString().slice(0, 10),
        description: payload.description.trim(),
        is_anonymous: Boolean(payload.anonymous)
      })
      .select("*")
      .single();

    if (insErr) return { ok: false, error: insErr.message };

    if (imageFile) {
      const ext = imageFile.type === "image/png" ? "png" : imageFile.type === "image/webp" ? "webp" : "jpg";
      const fileName = `${window.FOUNDIT.helpers.uid("img")}.${ext}`;
      const storagePath = `${user.id}/${inserted.id}/${fileName}`;

      const { error: upErr } = await sb.storage
        .from("item-photos")
        .upload(storagePath, imageFile, {
          contentType: imageFile.type,
          upsert: false
        });

      if (upErr) {
        return {
          ok: true,
          item: mapListingRow(inserted),
          warning: `Report saved, but image upload failed: ${upErr.message}`
        };
      }

      const { error: metaErr } = await sb.from("item_images").insert({
        item_id: inserted.id,
        uploader_id: user.id,
        storage_bucket: "item-photos",
        storage_path: storagePath,
        mime_type: imageFile.type,
        byte_size: imageFile.size
      });

      if (metaErr) {
        await sb.storage.from("item-photos").remove([storagePath]);
        return {
          ok: true,
          item: mapListingRow(inserted),
          warning: `Report saved, but image metadata error: ${metaErr.message}`
        };
      }
    }

    return { ok: true, item: mapListingRow(inserted) };
  }

  async function updateOwnReportStatus(itemId, status) {
    const { error } = await client()
      .from("item_reports")
      .update({ status })
      .eq("id", itemId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updateOwnReportDetails(itemId, { name, colour, location, specificLocation, description, anonymous }) {
    const { error } = await client()
      .from("item_reports")
      .update({
        title: name.trim(),
        colour: colour.trim(),
        location,
        specific_location: (specificLocation || "").trim(),
        description: description.trim(),
        is_anonymous: Boolean(anonymous)
      })
      .eq("id", itemId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function confirmItemReturned(itemId) {
    const { data, error } = await client().rpc("confirm_item_returned", { p_item_id: itemId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, status: data?.status || "Returned" };
  }

  async function deleteOwnReport(itemId) {
    const sb = client();
    const { data: imgs } = await sb
      .from("item_images")
      .select("storage_path")
      .eq("item_id", itemId);

    if (imgs?.length) {
      await sb.storage.from("item-photos").remove(imgs.map((x) => x.storage_path));
    }

    const { error } = await sb.from("item_reports").delete().eq("id", itemId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function flagReport(itemId, reason) {
    const { error } = await client().rpc("flag_item_report", {
      p_item_id: itemId,
      p_reason: reason || "Flagged for moderator review"
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return {
    fetchPublicListings,
    fetchMyReports,
    createReport,
    updateOwnReportStatus,
    updateOwnReportDetails,
    confirmItemReturned,
    deleteOwnReport,
    flagReport
  };
})();
