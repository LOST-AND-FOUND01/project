/* FOUNDIT — Supabase Authentication & Profile Service */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.authService = (() => {
  const client = () => window.FOUNDIT.supabaseClient.getClient();

  async function getCurrentUserWithProfile() {
    const sb = client();
    const { data: sessionData } = await sb.auth.getSession();
    const session = sessionData?.session;
    if (!session?.user) return null;

    const uid = session.user.id;
    const [profRes, rolesRes] = await Promise.all([
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      sb.from("user_roles").select("role").eq("user_id", uid)
    ]);

    if (profRes.error) throw profRes.error;
    const profile = profRes.data;
    const roles = (rolesRes.data || []).map((r) => r.role);
    const role = roles.includes("admin") ? "admin" : "student";

    return {
      id: uid,
      email: profile?.email || session.user.email,
      name: profile?.full_name || session.user.user_metadata?.full_name || "Campus Member",
      usn: profile?.usn || session.user.user_metadata?.usn || "",
      department: profile?.department || "General",
      phone: profile?.phone || "",
      verified: Boolean(session.user.email_confirmed_at || profile?.email_verified),
      status: profile?.account_status || "Active",
      role
    };
  }

  async function register({ name, usn, email, department, phone, password }) {
    const sb = client();
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await sb.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          full_name: name.trim(),
          usn: usn.trim().toUpperCase(),
          department: department.trim() || "General",
          phone: phone.trim()
        }
      }
    });
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      needsEmailConfirmation: !data.session,
      user: data.user
    };
  }

  async function login(email, password) {
    const sb = client();
    const { data, error } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });
    if (error) return { ok: false, error: error.message };

    // Verify account is not suspended
    const { data: prof } = await sb
      .from("profiles")
      .select("account_status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (prof?.account_status === "Suspended") {
      await sb.auth.signOut();
      return { ok: false, error: "This account has been suspended by an administrator." };
    }
    return { ok: true, user: data.user };
  }

  async function logout() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  }

  async function resendVerificationEmail(email) {
    const { error } = await client().auth.resend({
      type: "signup",
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`
      }
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function sendPasswordReset(email) {
    const { error } = await client().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updatePassword(newPassword) {
    const { error } = await client().auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updateOwnProfile({ name, department, phone }) {
    const sb = client();
    const { data: userData } = await sb.auth.getUser();
    if (!userData?.user) return { ok: false, error: "Sign in required." };
    const { error } = await sb
      .from("profiles")
      .update({
        full_name: name.trim(),
        department: department.trim() || "General",
        phone: phone.trim()
      })
      .eq("id", userData.user.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  function onAuthChange(cb) {
    return client().auth.onAuthStateChange((event, session) => {
      cb(event, session);
    });
  }

  return {
    getCurrentUserWithProfile,
    register,
    login,
    logout,
    resendVerificationEmail,
    sendPasswordReset,
    updatePassword,
    updateOwnProfile,
    onAuthChange
  };
})();
