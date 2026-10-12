import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { safeNext } from "./safeNext";
import "./auth.css";

const ERROR_CODES = ["OTP_INVALID", "OTP_LOCKED", "OTP_COOLDOWN", "ACCOUNT_EXISTS", "EMAIL_UNAVAILABLE", "CSRF_FAILED"] as const;

type Mode = "signin" | "signup" | "forgot";
type Method = "password" | "code";
type Reply = { detail?: unknown; message?: unknown; [field: string]: unknown };

class AuthError extends Error {
  constructor(readonly status: number, readonly data: Reply) { super(String(data.detail ?? status)); }
}

/** POST JSON with the session's CSRF token; the auth views reject requests without it. */
async function post(path: string, body: Record<string, string>) {
  const session = await fetch("/api/auth/session/", { credentials: "same-origin" }).then((r) => r.json());
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRFToken": session.csrf_token ?? "" },
  });
  const data = await response.json().catch(() => ({})) as Reply;
  if (!response.ok) throw new AuthError(response.status, data);
  return data;
}

function modeFromUrl(): Mode {
  const value = new URLSearchParams(window.location.search).get("mode");
  return value === "signup" || value === "forgot" ? value : "signin";
}

/**
 * /auth — StudyFlow's sign-in page. Signs in with a password (email or username) or a one-time
 * email code, creates an account or resets a password through Django's auth API, which owns the
 * credential checks, CSRF and the session. `next` is where to return, same-origin only.
 */
export function AuthApp() {
  const { t } = useI18n();
  const firstRef = useRef<HTMLInputElement>(null);
  const [mode, setModeState] = useState<Mode>(modeFromUrl);
  const [method, setMethod] = useState<Method>("password");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  const usesCode = mode !== "signin" || method === "code";
  const purpose = mode === "signup" ? "sign_up" : mode === "forgot" ? "password_reset" : "sign_in";
  const needsNewPassword = mode !== "signin";

  useEffect(() => { firstRef.current?.focus(); }, [mode, method, requested]);

  function setMode(nextMode: Mode, nextMethod: Method = nextMode === "signin" ? "password" : "code") {
    setModeState(nextMode); setMethod(nextMethod); setRequested(false);
    setPassword(""); setConfirm(""); setCode(""); setError(""); setNotice("");
    const query = new URLSearchParams(window.location.search);
    query.set("mode", nextMode);
    history.replaceState(null, "", `${window.location.pathname}?${query}`);
  }

  function describe(reason: unknown) {
    if (!(reason instanceof AuthError)) return t("common.err.unreachable");
    const { status, data } = reason;
    if (typeof data.detail === "string" && (ERROR_CODES as readonly string[]).includes(data.detail)) return t(`signin.err.${data.detail}` as MessageKey);
    if (data.detail === "INVALID_CREDENTIALS") return t("signin.invalid");
    if (status === 429) return t("signin.err.throttled");
    // Field errors, e.g. a password the validators reject.
    for (const value of Object.values(data)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
    return typeof data.message === "string" ? data.message : t("common.err.unreachable");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (needsNewPassword && password !== confirm) { setError(t("signin.mismatch")); return; }
    setBusy(true); setError("");
    try {
      if (!usesCode) {
        await post("/api/auth/password/sign-in/", { login, password });
      } else if (!requested) {
        await post("/api/auth/otp/request/", { email, purpose });
        setRequested(true); setNotice(t("signin.codeSent"));
        return;
      } else {
        await post("/api/auth/otp/verify/", { email, purpose, code, full_name: fullName, password });
      }
      setNotice(t("signin.done"));
      window.location.assign(next);
    } catch (reason) {
      setError(describe(reason));
    } finally {
      setBusy(false);
    }
  }

  const copy = {
    signin: { eyebrow: t("signin.eyebrowSignIn"), title: t("signin.title"), text: t("signin.text") },
    signup: { eyebrow: t("signin.eyebrowSignUp"), title: t("signin.signupTitle"), text: t("signin.signupText") },
    forgot: { eyebrow: t("signin.eyebrowForgot"), title: t("signin.forgotTitle"), text: t("signin.forgotText") },
  }[mode];
  const action = !usesCode ? t("signin.submit") : !requested ? t("signin.sendCode")
    : mode === "signup" ? t("signin.verifySignUp") : mode === "forgot" ? t("signin.verifyReset") : t("signin.verifySignIn");

  return <div className="auth-shell">
    <aside className="auth-story">
      <a className="brand" href="/" aria-label={t("signin.home")}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
      <div className="auth-story-copy">
        <span className="eyebrow">{t("signin.storyEyebrow")}</span>
        <h1>{t("signin.storyTitle")}</h1>
        <p>{t("signin.storyText")}</p>
      </div>
      <div className="auth-trust"><span aria-hidden="true">✓</span><div><strong>{t("signin.trustTitle")}</strong><small>{t("signin.trustText")}</small></div></div>
    </aside>
    <main className="auth-main">
      <section className="auth-card" aria-labelledby="auth-title">
        {mode !== "forgot" && !requested && <div className="auth-tabs" role="group" aria-label={t("signin.accessLabel")}>
          <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>{t("signin.tabSignIn")}</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>{t("signin.tabSignUp")}</button>
        </div>}
        <span className="eyebrow">{copy.eyebrow}</span>
        <h2 id="auth-title">{copy.title}</h2>
        <p>{copy.text}</p>
        {mode === "signin" && !requested && <div className="auth-method" role="group" aria-label={t("signin.methodLabel")}>
          <button type="button" aria-pressed={method === "password"} onClick={() => setMode("signin", "password")}>{t("signin.methodPassword")}</button>
          <button type="button" aria-pressed={method === "code"} onClick={() => setMode("signin", "code")}>{t("signin.methodCode")}</button>
        </div>}

        <form onSubmit={submit}>
          {!usesCode && <>
            <label>{t("signin.login")}
              <input ref={firstRef} name="username" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
            </label>
            <label>{t("signin.password")}
              <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>}
          {usesCode && !requested && <>
            {mode === "signup" && <label>{t("signin.fullName")}
              <input ref={firstRef} autoComplete="name" required maxLength={150} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>}
            <label>{t("signin.email")}
              <input ref={mode === "signup" ? undefined : firstRef} type="email" autoComplete="email" required placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {needsNewPassword && <>
              <label>{mode === "forgot" ? t("signin.newPassword") : t("signin.password")}
                <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>{t("signin.confirmPassword")}
                <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            </>}
          </>}
          {requested && <label>{t("signin.code")}
            <input ref={firstRef} className="auth-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
              placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </label>}

          {error && <div className="auth-message auth-error" role="alert">{error}</div>}
          {notice && !error && <div className="auth-message" role="status">{notice}</div>}
          <button className="primary auth-submit" type="submit" disabled={busy}>{busy ? t("common.loading") : action}<span aria-hidden="true">→</span></button>
        </form>

        {requested ? <button type="button" className="auth-link" onClick={() => { setRequested(false); setCode(""); setNotice(""); setError(""); }}>{t("signin.restart")}</button>
          : mode === "signin" ? <button type="button" className="auth-link" onClick={() => setMode("forgot")}>{t("signin.forgot")}</button>
          : mode === "forgot" ? <button type="button" className="auth-link" onClick={() => setMode("signin")}>{t("signin.back")}</button> : null}
        <p className="auth-foot">{t("signin.simulated")}</p>
      </section>
    </main>
  </div>;
}
