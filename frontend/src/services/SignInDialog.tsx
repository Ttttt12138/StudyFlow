import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../i18n";

const LOGIN_PATH = "/api/auth/login/";

/**
 * Floating sign-in window. Every "Sign in to StudyFlow" link points at Django's login page
 * (/api/auth/login/?next=…); a plain click opens this dialog instead, which posts the same
 * form to the same view, so Django still owns the credentials check, CSRF and the session.
 * Modified clicks (new tab, etc.) and the "full sign-in page" link still go to Django's page.
 */
export function SignInDialog() {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const [href, setHref] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(`a[href^="${LOGIN_PATH}"]`);
      if (!link || link.hasAttribute("data-full-sign-in")) return;
      event.preventDefault();
      setHref(link.getAttribute("href"));
      setError("");
      setPassword("");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (href && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => userRef.current?.focus()); }
    if (!href && dialog.open) dialog.close();
  }, [href]);

  const next = href ? new URL(href, window.location.origin).searchParams.get("next") ?? "/" : "/";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await fetch("/api/auth/session/", { credentials: "same-origin" }).then((r) => r.json());
      const body = new URLSearchParams({ username, password, next, csrfmiddlewaretoken: session.csrf_token ?? "" });
      await fetch(`${LOGIN_PATH}?next=${encodeURIComponent(next)}`, {
        method: "POST", credentials: "same-origin", body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      // Django answers a failed login with the form again (200) and a good one with a redirect,
      // so the session endpoint is the reliable signal.
      const after = await fetch("/api/auth/session/", { credentials: "same-origin" }).then((r) => r.json());
      if (after.authenticated) { window.location.assign(next); return; }
      setError(t("signin.invalid"));
    } catch {
      setError(t("common.err.unreachable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="signin-dialog" aria-labelledby="signin-title" onClose={() => setHref(null)}
      onClick={(event) => { if (event.target === dialogRef.current) setHref(null); }}>
      {/* Rendered only while open, so its fields never shadow the page's own (e.g. a step-up password). */}
      {href && <form className="signin-card" onSubmit={submit}>
        <div className="signin-head">
          <span className="brand-icon" aria-hidden="true">S</span>
          <div>
            <h2 id="signin-title">{t("signin.title")}</h2>
            <p>{t("signin.text")}</p>
          </div>
          <button type="button" className="signin-close" aria-label={t("signin.close")} onClick={() => setHref(null)}>✕</button>
        </div>
        <label>{t("signin.username")}
          <input ref={userRef} name="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>{t("signin.password")}
          <input name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button type="submit" className="primary signin-submit" disabled={busy}>{busy ? t("common.loading") : t("signin.submit")}</button>
        <p className="signin-foot">
          <span>{t("signin.simulated")}</span>
          {href && <a href={href} data-full-sign-in="">{t("signin.full")}</a>}
        </p>
      </form>}
    </dialog>
  );
}
