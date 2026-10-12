import { useState } from "react";
import "./auth.css";

type Mode = "signin" | "signup" | "forgot";
type SignInMethod = "code" | "password";
type ApiError = { message?: string; detail?: string; [key: string]: unknown };

function initialMode(): Mode {
  const value = new URLSearchParams(window.location.search).get("mode");
  return value === "signup" || value === "forgot" ? value : "signin";
}
function destination() {
  const raw = new URLSearchParams(window.location.search).get("next") || "/";
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

function errorText(data: ApiError) {
  if (typeof data.message === "string") return data.message;
  for (const value of Object.values(data)) {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && value.length) return String(value[0]);
  }
  return "Something went wrong. Please try again.";
}

async function post(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json() as ApiError;
  if (!response.ok) throw new Error(errorText(data));
  return data;
}

const copy = {
  signin: { eyebrow: "WELCOME BACK", title: "Sign in to StudyFlow", text: "Use an email code, or sign in with the demo account password.", action: "Email me a sign-in code", verify: "Verify and sign in" },
  signup: { eyebrow: "CREATE YOUR ACCOUNT", title: "Start your StudyFlow account", text: "Create your account, then verify that you own the email address.", action: "Email me a verification code", verify: "Verify and create account" },
  forgot: { eyebrow: "PASSWORD RECOVERY", title: "Reset your password", text: "Enter your account email and we’ll send a secure reset code.", action: "Email me a reset code", verify: "Verify and reset password" },
} as const;

export function AuthApp() {
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [signInMethod, setSignInMethod] = useState<SignInMethod>("code");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const purpose = mode === "signup" ? "sign_up" : mode === "forgot" ? "password_reset" : "sign_in";
  const text = copy[mode];

  function setMode(next: Mode) {
    setModeState(next); setSignInMethod("code"); setRequested(false); setCode(""); setPassword(""); setConfirmPassword(""); setError(""); setNotice("");
    const query = new URLSearchParams(window.location.search); query.set("mode", next);
    history.replaceState(null, "", `/auth?${query.toString()}`);
  }

  function validatePasswords() {
    if ((mode === "signup" || mode === "forgot") && password !== confirmPassword) {
      setError("The passwords do not match."); return false;
    }
    return true;
  }

  async function requestCode() {
    if (!validatePasswords()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post("/api/auth/otp/request/", { email, purpose });
      setRequested(true); setNotice(String(result.message || "Code sent."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function verifyCode() {
    if (!validatePasswords()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await post("/api/auth/otp/verify/", { email, purpose, code, full_name: fullName, password });
      setNotice(mode === "signup" ? "Account created. Opening StudyFlow…" : mode === "forgot" ? "Password reset. Opening StudyFlow…" : "Signed in. Opening StudyFlow…");
      window.setTimeout(() => window.location.assign(destination()), 450);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function passwordSignIn() {
    setBusy(true); setError(""); setNotice("");
    try {
      await post("/api/auth/password/sign-in/", { email, password });
      setNotice("Signed in. Opening StudyFlow…");
      window.setTimeout(() => window.location.assign(destination()), 450);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="auth-shell">
    <aside className="auth-story">
      <a className="brand" href="/"><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
      <div className="auth-story-copy"><span className="eyebrow">STUDY WITH CLARITY</span><h1>Your plan, protected by your email.</h1><p>One-time codes keep account access simple while your saved study plan remains connected to Django.</p></div>
      <div className="auth-trust"><span aria-hidden="true">✓</span><div><strong>Short-lived verification</strong><small>Codes expire after 10 minutes and can only be used once.</small></div></div>
    </aside>
    <main className="auth-main">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-tabs" aria-label="Account access">
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Sign up</button>
        </div>
        <span className="eyebrow">{text.eyebrow}</span>
        <h2 id="auth-title">{text.title}</h2>
        <p>{text.text}</p>
        {mode === "signin" && !requested && <div className="auth-method" aria-label="Sign-in method"><button className={signInMethod === "code" ? "active" : ""} onClick={() => { setSignInMethod("code"); setPassword(""); setError(""); }}>Email code</button><button className={signInMethod === "password" ? "active" : ""} onClick={() => { setSignInMethod("password"); setError(""); }}>Password</button></div>}
        <form onSubmit={(event) => { event.preventDefault(); void (mode === "signin" && signInMethod === "password" ? passwordSignIn() : requested ? verifyCode() : requestCode()); }}>
          {mode === "signup" && <label>Full name<input autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} required disabled={requested}/></label>}
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={requested} placeholder="you@example.com"/></label>
          {mode === "signin" && signInMethod === "password" && <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label>}
          {(mode === "signup" || mode === "forgot") && <><label>{mode === "forgot" ? "New password" : "Password"}<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required/></label></>}
          {requested && <label>Six-digit code<input className="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus placeholder="000000"/></label>}
          {error && <div className="auth-message auth-error" role="alert">{error}</div>}
          {notice && <div className="auth-message" role="status">{notice}</div>}
          <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" && signInMethod === "password" ? "Sign in" : requested ? text.verify : text.action}<span aria-hidden="true">→</span></button>
        </form>
        {mode === "signin" && signInMethod === "password" && !requested && <button className="auth-demo" onClick={() => { setEmail("admin@gmail.com"); setPassword("Admin123"); setError(""); }}>Use demo account <span>admin@gmail.com</span></button>}
        {requested ? <button className="auth-link" onClick={() => { setRequested(false); setCode(""); setNotice(""); }}>Use a different email or resend</button> : mode === "signin" ? <button className="auth-link" onClick={() => setMode("forgot")}>Forgot your password?</button> : mode === "forgot" ? <button className="auth-link" onClick={() => setMode("signin")}>Back to sign in</button> : null}
      </section>
    </main>
  </div>;
}
