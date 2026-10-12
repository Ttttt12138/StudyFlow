export function signInUrl(next = window.location.href) {
  return `/auth?mode=signin&next=${encodeURIComponent(next)}`;
}
