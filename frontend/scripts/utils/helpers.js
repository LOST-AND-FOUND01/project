/* FOUNDIT — Shared Helpers & UI Utilities */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.helpers = (() => {
  let toastTimer = null;

  function safe(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function uid(prefix = "id") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatDateTime(iso) {
    if (!iso) return "Just now";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safe(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toast(message) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.display = "none";
    }, 3000);
  }

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("show");
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("show");
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function validatePassword(pw) {
    const str = String(pw || "");
    if (str.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Za-z]/.test(str) || !/[0-9]/.test(str)) {
      return "Password must include at least one letter and one number.";
    }
    return "";
  }

  function readImageFile(file, onSuccess, onError) {
    if (!file) {
      onSuccess("");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      onError("Please choose a JPEG, PNG, or WebP image file.");
      return;
    }
    if (file.size > 2097152) {
      onError("Choose an image smaller than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onSuccess(reader.result);
    reader.onerror = () => onError("Could not read selected image.");
    reader.readAsDataURL(file);
  }

  function statusTagClass(status) {
    const s = String(status || "").toLowerCase();
    if (s === "returned" || s === "completed" || s === "approved" || s === "active") return "done";
    if (s === "pending" || s === "handover pending" || s === "under review") return "pending";
    if (s === "rejected" || s === "suspended" || s === "flagged" || s === "archived") return "rejected";
    return "";
  }

  return {
    safe,
    uid,
    formatDateTime,
    toast,
    openModal,
    closeModal,
    isValidEmail,
    validatePassword,
    readImageFile,
    statusTagClass
  };
})();
