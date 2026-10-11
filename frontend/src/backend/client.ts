// Readable text for Django error bodies: a message/detail string, or DRF field errors.
export function errorMessage(details: unknown, status: number): string {
  if (typeof details === "string") return details;
  if (!details || typeof details !== "object") return `Request failed (HTTP ${status}).`;
  const body = details as Record<string, unknown>;
  for (const key of ["message", "detail"])
    if (typeof body[key] === "string") return body[key] as string;
  const fields = Object.entries(body)
    .map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : JSON.stringify(value)}`);
  return fields.length ? fields.join("; ") : `Request failed (HTTP ${status}).`;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public details: unknown,
  ) {
    super(errorMessage(details, status));
  }
}
export type StudyFlowClient = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown, key?: string): Promise<T>;
};
export class DjangoClient {
  constructor(private csrfToken: string) {}
  async request<T>(
    path: string,
    options: { method?: "GET" | "POST"; body?: unknown; key?: string; raw?: boolean; headers?: Record<string,string> } = {},
  ): Promise<T> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = { ...options.headers };
    if (method === "POST") {
      headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
      if (!(options.body instanceof FormData))
        headers["Content-Type"] = "application/json";
    }
    const send = async () => {
      try {
        return await fetch(`/api/v2/${path}`, {
          method,
          credentials: "same-origin",
          headers: method === "POST" ? { ...headers, "X-CSRFToken": this.csrfToken } : headers,
          body:
            method === "POST"
              ? options.body instanceof FormData
                ? options.body
                : JSON.stringify(options.body)
              : undefined,
        });
      } catch {
        throw new ApiError(
          0,
          "Could not reach Django. Check that the server is running on port 8000.",
        );
      }
    };
    let response = await send();
    let payload: unknown = await response.json().catch(() => undefined);
    // Django rotates the CSRF secret at login. After signing in again in another tab, fetch the
    // new token once and resend; Django rejects CSRF before the view runs, so nothing was applied.
    if (method === "POST" && response.status === 403 && /CSRF/i.test(errorMessage(payload, 403)) && await this.renewCsrf()) {
      response = await send();
      payload = await response.json().catch(() => undefined);
    }
    if (!response.ok) throw new ApiError(response.status, payload ?? null);
    if (payload === undefined && response.status !== 204)
      throw new ApiError(response.status, "Django returned a response that is not JSON. Please retry.");
    return !options.raw && payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: T }).data
      : (payload as T);
  }
  private async renewCsrf(): Promise<boolean> {
    const response = await fetch("/api/auth/session/", { credentials: "same-origin" }).catch(() => null);
    const identity = response?.ok ? await response.json().catch(() => null) : null;
    if (!identity?.authenticated || typeof identity.csrf_token !== "string") return false;
    this.csrfToken = identity.csrf_token;
    return true;
  }
  rawGet<T>(path: string) {
    return this.request<T>(path, { raw: true });
  }
  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string, body: unknown, key?: string) {
    return this.request<T>(path, { method: "POST", body, key });
  }
}

/** Resource routes paginate, readiness histories use data arrays. */
export async function getAll<T>(api: StudyFlowClient, path: string): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let next: string | null = path;
  while (next) {
    if (seen.has(next)) throw new Error("Repeated API pagination page.");
    seen.add(next);
    const page: {results: T[]; next?: string | null} | T[] = await api.get(next);
    if (Array.isArray(page)) return rows.concat(page);
    if (!Array.isArray(page.results)) throw new Error("Unexpected API list response.");
    rows.push(...page.results);
    if (!page.next) break;
    const url: URL = new URL(page.next, window.location.origin);
    // Compare the host only: behind a TLS-terminating proxy Django may build http:// links.
    if (url.host !== window.location.host || !url.pathname.startsWith("/api/v2/"))
      throw new Error("Unexpected API pagination destination.");
    next = url.pathname.slice("/api/v2/".length) + url.search;
  }
  return rows;
}
