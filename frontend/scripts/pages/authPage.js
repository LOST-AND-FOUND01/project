/* FOUNDIT — Student Authentication Flow (Supabase Auth)
 * Covers: Login, Registration, Email Verification, Forgot Password, Reset Password, Logout
 */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.authPage = (() => {
  const { safe, toast, isValidEmail, validatePassword } = window.FOUNDIT.helpers;
  let currentMode = "login"; // login | register | verify | forgot | reset
  let resendCooldown = 0;
  let cooldownTimer = null;

  function setMode(mode) {
    currentMode = mode;
    render();
  }

  function startResendCooldown() {
    resendCooldown = 30;
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      resendCooldown = Math.max(0, resendCooldown - 1);
      const btn = document.getElementById("resendVerifyBtn");
      if (btn) {
        btn.disabled = resendCooldown > 0;
        btn.textContent = resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : "Resend verification email";
      }
      if (resendCooldown === 0) clearInterval(cooldownTimer);
    }, 1000);
  }

  function render() {
    const root = document.getElementById("authContent");
    if (!root) return;

    const store = window.FOUNDIT.store;
    const state = store.getState();
    const user = store.getCurrentUser();

    const tabsHtml = `
      <div class="auth-tabs">
        <button type="button" class="${currentMode === "login" ? "active" : ""}" onclick="window.FOUNDIT.authPage.setMode('login')">Login</button>
        <button type="button" class="${currentMode === "register" ? "active" : ""}" onclick="window.FOUNDIT.authPage.setMode('register')">Register</button>
        <button type="button" class="${currentMode === "verify" ? "active" : ""}" onclick="window.FOUNDIT.authPage.setMode('verify')">Verify Email</button>
        <button type="button" class="${currentMode === "forgot" ? "active" : ""}" onclick="window.FOUNDIT.authPage.setMode('forgot')">Forgot Password</button>
        <button type="button" class="${currentMode === "reset" ? "active" : ""}" onclick="window.FOUNDIT.authPage.setMode('reset')">Reset Password</button>
      </div>
    `;

    const activeSessionBanner = user
      ? `
        <div class="notice" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <strong>Signed in as ${safe(user.name)}</strong> (${safe(user.email)} · ${safe(user.role.toUpperCase())})
            <span class="tag ${user.verified ? "done" : "pending"}">${user.verified ? "Email Verified" : "Unverified"}</span>
          </div>
          <div class="action-row" style="margin:0">
            <button type="button" class="btn btn-small" onclick="window.FOUNDIT.router.showPage('${user.role === "admin" ? "admin" : "dashboard"}')">Open Dashboard</button>
            <button type="button" class="btn btn-outline btn-small" onclick="window.FOUNDIT.navbar.handleLogout()">Logout</button>
          </div>
        </div>
      `
      : "";

    let bodyHtml = "";

    if (currentMode === "login") {
      bodyHtml = `
        <h2>Student &amp; Campus Login</h2>
        <p class="muted" style="margin:6px 0 16px">Sign in with your registered campus email and password.</p>
        <form id="authLoginForm">
          <div class="field">
            <label for="loginEmail">Email *</label>
            <input id="loginEmail" type="email" required placeholder="e.g. student@jcet.edu">
          </div>
          <div class="field">
            <label for="loginPassword">Password *</label>
            <input id="loginPassword" type="password" required placeholder="Enter password">
          </div>
          <button class="btn" type="submit" style="width:100%">Sign in</button>
        </form>
        <div class="auth-links">
          <button type="button" class="link-btn" onclick="window.FOUNDIT.authPage.setMode('forgot')">Forgot password?</button>
          <button type="button" class="link-btn" onclick="window.FOUNDIT.authPage.setMode('register')">Create student account</button>
        </div>
      `;
    } else if (currentMode === "register") {
      bodyHtml = `
        <h2>Student Registration</h2>
        <p class="muted" style="margin:6px 0 16px">Create your FOUNDIT student account. Admin privileges are assigned only through trusted administration.</p>
        <form id="authRegisterForm">
          <div class="form-grid">
            <div class="field"><label for="regName">Full Name *</label><input id="regName" required placeholder="e.g. Priya Sharma"></div>
            <div class="field"><label for="regUsn">Student USN / ID *</label><input id="regUsn" required placeholder="e.g. 2JC23CS045"></div>
            <div class="field"><label for="regEmail">Campus Email *</label><input id="regEmail" type="email" required placeholder="student@jcet.edu"></div>
            <div class="field"><label for="regDept">Department / Branch</label><input id="regDept" placeholder="e.g. Computer Science"></div>
            <div class="field"><label for="regPhone">Phone (optional)</label><input id="regPhone" placeholder="+91 98XXXXXXXX"></div>
            <div class="field"><label for="regPassword">Password *</label><input id="regPassword" type="password" required placeholder="Min 8 chars, letter + number"></div>
            <div class="field full"><label for="regConfirm">Confirm Password *</label><input id="regConfirm" type="password" required placeholder="Re-enter password"></div>
          </div>
          <button class="btn" type="submit" style="width:100%">Create Student Account</button>
        </form>
        <div class="auth-links">
          <span class="muted">Already registered?</span>
          <button type="button" class="link-btn" onclick="window.FOUNDIT.authPage.setMode('login')">Back to login</button>
        </div>
      `;
    } else if (currentMode === "verify") {
      const targetEmail = user?.email || state.pendingVerifyEmail || "";
      bodyHtml = `
        <h2>Email Verification</h2>
        <p class="muted" style="margin:6px 0 16px">Verify your email address via the confirmation link sent by Supabase Auth.</p>
        ${user?.verified ? `
          <div class="action-card">
            <p><strong>Account:</strong> ${safe(user.email)}</p>
            <p><strong>Status:</strong> <span class="tag done">Email Verified ✓</span></p>
            <div class="action-row">
              <button type="button" class="btn btn-small" onclick="window.FOUNDIT.router.showPage('dashboard')">Go to My Dashboard</button>
            </div>
          </div>
        ` : `
          <form id="authResendForm">
            <div class="field">
              <label for="verifyEmailAddr">Email Address *</label>
              <input id="verifyEmailAddr" type="email" required value="${safe(targetEmail)}" placeholder="Enter your registered email">
            </div>
            <div class="notice">Check your inbox (and spam folder) for the Supabase verification link. Click the link to confirm your account, then return and sign in.</div>
            <button type="submit" id="resendVerifyBtn" class="btn btn-outline" ${resendCooldown > 0 ? "disabled" : ""}>
              ${resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : "Resend verification email"}
            </button>
          </form>
        `}
      `;
    } else if (currentMode === "forgot") {
      bodyHtml = `
        <h2>Forgot Password</h2>
        <p class="muted" style="margin:6px 0 16px">Enter your registered email to receive a Supabase password reset link.</p>
        <form id="authForgotForm">
          <div class="field">
            <label for="forgotEmail">Registered Email *</label>
            <input id="forgotEmail" type="email" required placeholder="student@jcet.edu">
          </div>
          <button class="btn" type="submit" style="width:100%">Send Reset Link</button>
        </form>
        <div class="auth-links">
          <button type="button" class="link-btn" onclick="window.FOUNDIT.authPage.setMode('login')">Back to login</button>
        </div>
      `;
    } else if (currentMode === "reset") {
      bodyHtml = `
        <h2>Reset Password</h2>
        <p class="muted" style="margin:6px 0 16px">
          ${user
            ? `Updating password for <strong>${safe(user.email)}</strong>`
            : "Open this page from your password recovery email link (or sign in first) to set a new password."}
        </p>
        ${user ? `
          <form id="authResetForm">
            <div class="field">
              <label for="resetPassword">New Password *</label>
              <input id="resetPassword" type="password" required placeholder="Min 8 chars, letter + number">
            </div>
            <div class="field">
              <label for="resetConfirm">Confirm New Password *</label>
              <input id="resetConfirm" type="password" required placeholder="Re-enter new password">
            </div>
            <button class="btn" type="submit" style="width:100%">Update Password</button>
          </form>
        ` : `
          <button type="button" class="btn btn-outline" onclick="window.FOUNDIT.authPage.setMode('forgot')">Go to Forgot Password</button>
        `}
      `;
    }

    root.innerHTML = `${tabsHtml}${activeSessionBanner}<div class="panel">${bodyHtml}</div>`;
    bindForms();
  }

  function bindForms() {
    document.getElementById("authLoginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("loginEmail").value;
      const pw = document.getElementById("loginPassword").value;
      const btn = e.target.querySelector("button[type='submit']");
      if (btn) btn.disabled = true;

      const res = await window.FOUNDIT.store.loginUser(email, pw);
      if (btn) btn.disabled = false;
      if (!res.ok) return toast(res.error);

      const user = window.FOUNDIT.store.getCurrentUser();
      toast(`Welcome back, ${user?.name || "Student"}!`);
      window.FOUNDIT.router.showPage(user?.role === "admin" ? "admin" : "dashboard");
    });

    document.getElementById("authRegisterForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("regName").value.trim();
      const usn = document.getElementById("regUsn").value.trim();
      const email = document.getElementById("regEmail").value.trim();
      const department = document.getElementById("regDept").value.trim();
      const phone = document.getElementById("regPhone").value.trim();
      const password = document.getElementById("regPassword").value;
      const confirm = document.getElementById("regConfirm").value;

      if (name.length < 2) return toast("Please enter your full name.");
      if (usn.length < 4) return toast("Please enter a valid USN / Student ID.");
      if (!isValidEmail(email)) return toast("Please enter a valid email address.");
      const pwErr = validatePassword(password);
      if (pwErr) return toast(pwErr);
      if (password !== confirm) return toast("Passwords do not match.");

      const btn = e.target.querySelector("button[type='submit']");
      if (btn) btn.disabled = true;
      const res = await window.FOUNDIT.store.registerUser({ name, usn, email, department, phone, password });
      if (btn) btn.disabled = false;

      if (!res.ok) return toast(res.error);
      if (res.needsEmailConfirmation) {
        toast("Account created! Please check your email to verify your address.");
        setMode("verify");
      } else {
        toast("Account created and signed in!");
        window.FOUNDIT.router.showPage("dashboard");
      }
    });

    document.getElementById("authResendForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("verifyEmailAddr").value.trim();
      if (!isValidEmail(email)) return toast("Enter a valid email address.");
      const res = await window.FOUNDIT.store.resendVerification(email);
      if (!res.ok) return toast(res.error);
      toast("Verification email sent! Check your inbox.");
      startResendCooldown();
    });

    document.getElementById("authForgotForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("forgotEmail").value.trim();
      if (!isValidEmail(email)) return toast("Enter a valid email address.");
      const res = await window.FOUNDIT.store.requestPasswordReset(email);
      if (!res.ok) return toast(res.error);
      toast("Password reset link sent to your email.");
    });

    document.getElementById("authResetForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pw = document.getElementById("resetPassword").value;
      const confirm = document.getElementById("resetConfirm").value;
      const pwErr = validatePassword(pw);
      if (pwErr) return toast(pwErr);
      if (pw !== confirm) return toast("Passwords do not match.");
      const res = await window.FOUNDIT.store.resetPassword(pw);
      if (!res.ok) return toast(res.error);
      toast("Password updated! You can continue using your account.");
      window.FOUNDIT.router.showPage("dashboard");
    });
  }

  return {
    setMode,
    render
  };
})();
