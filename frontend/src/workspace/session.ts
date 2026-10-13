/** Ends the Django session (CSRF-checked POST) and reloads home, which clears every in-memory draft. */
export async function signOut() {
  try {
    const session = await fetch("/api/auth/session/", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
    const token = session?.csrf_token ?? "";
    await fetch("/api/auth/logout/", { method: "POST", credentials: "same-origin",
      headers: { "X-CSRFToken": token, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfmiddlewaretoken: token }) });
  } finally { window.location.assign("/"); }
}

export type FriendlyError = { kind: "account" | "offline" | "signin" | "other"; detail: string };

/** Classifies a raw API error line ("HTTP 400: …") so panels can say what to do next. */
export function classifyError(text: string): FriendlyError {
  const detail = text.replace(/^HTTP \d+:\s*/, "");
  if (/demo wallet|演示钱包/i.test(text)) return { kind: "account", detail };
  if (/^HTTP (0|5\d\d)\b|Failed to fetch|NetworkError|unreachable|无法连接/i.test(text)) return { kind: "offline", detail };
  if (/^HTTP (401|403)\b/.test(text)) return { kind: "signin", detail };
  return { kind: "other", detail };
}
