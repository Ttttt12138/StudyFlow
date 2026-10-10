export class ApiError extends Error {
  constructor(
    public status: number,
    public details: unknown,
  ) {
    super(typeof details === "string" ? details :
      details && typeof details === "object" && "message" in details && typeof details.message === "string"
        ? details.message : JSON.stringify(details));
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
      headers["X-CSRFToken"] = this.csrfToken;
      headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
      if (!(options.body instanceof FormData))
        headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await fetch(`/api/v2/${path}`, {
        method,
        credentials: "same-origin",
        headers,
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
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, payload);
    return !options.raw && payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: T }).data
      : (payload as T);
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
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/v2/"))
      throw new Error("Unexpected API pagination destination.");
    next = url.pathname.slice("/api/v2/".length) + url.search;
  }
  return rows;
}
