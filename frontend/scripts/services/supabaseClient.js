/* FOUNDIT — Supabase Browser Client (Uses Public URL & Anon Key Only) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.supabaseClient = (() => {
  let client = null;

  function getClient() {
    if (client) return client;
    const cfg = window.FOUNDIT.SUPABASE_CONFIG;
    if (!cfg?.url || !cfg?.anonKey) {
      throw new Error("Missing Supabase public configuration (SUPABASE_CONFIG).");
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Supabase JS SDK not loaded.");
    }
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  return { getClient };
})();
