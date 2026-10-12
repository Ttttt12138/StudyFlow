/**
 * Where to go after signing in: a same-origin path only. `https://this-site//evil.com` has this
 * site's origin but its pathname `//evil.com` would navigate off-site as a protocol-relative URL,
 * so paths that start with two slashes (or a slash and a backslash) fall back to "/".
 */
export function safeNext(raw: string | null | undefined, origin = window.location.origin): string {
  if (!raw) return "/";
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return "/";
    const path = `${url.pathname}${url.search}${url.hash}`;
    return /^\/[/\\]/.test(path) ? "/" : path;
  } catch {
    return "/";
  }
}
