import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, DjangoClient, errorMessage, getAll, type StudyFlowClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("errorMessage", () => {
  it("prefers Django's message or detail", () => {
    expect(errorMessage({ message: "Quote expired", code: "QUOTE_EXPIRED" }, 409)).toBe("Quote expired");
    expect(errorMessage({ detail: "Not found." }, 404)).toBe("Not found.");
    expect(errorMessage("plain text", 500)).toBe("plain text");
  });

  it("flattens DRF field errors instead of showing JSON", () => {
    expect(errorMessage({ amount: ["Ensure this value is positive."], currency: "Unknown" }, 400))
      .toBe("amount: Ensure this value is positive.; currency: Unknown");
  });

  it("falls back to the status for empty bodies", () => {
    expect(errorMessage(null, 502)).toBe("Request failed (HTTP 502).");
    expect(errorMessage({}, 400)).toBe("Request failed (HTTP 400).");
  });

  it("is the ApiError message", () => {
    expect(new ApiError(403, { detail: "Forbidden" }).message).toBe("Forbidden");
  });
});

describe("getAll", () => {
  const pages = (responses: Record<string, unknown>): StudyFlowClient => ({
    get: async <T,>(path: string) => {
      if (!(path in responses)) throw new Error(`unexpected ${path}`);
      return responses[path] as T;
    },
    post: async () => { throw new Error("not used"); },
  });

  it("follows same-host pagination links", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example", host: "app.example" } });
    const api = pages({
      "orders/": { results: [1, 2], next: "https://app.example/api/v2/orders/?page=2" },
      // Behind a TLS proxy Django can build http:// links for the same host.
      "orders/?page=2": { results: [3], next: "http://app.example/api/v2/orders/?page=3" },
      "orders/?page=3": { results: [4], next: null },
    });
    expect(await getAll<number>(api, "orders/")).toEqual([1, 2, 3, 4]);
  });

  it("returns plain array responses as they are", async () => {
    expect(await getAll<number>(pages({ "runs/": [7, 8] }), "runs/")).toEqual([7, 8]);
  });

  it("refuses links to another host or outside the API", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example", host: "app.example" } });
    await expect(getAll(pages({ "a/": { results: [], next: "https://evil.example/api/v2/a/?page=2" } }), "a/"))
      .rejects.toThrow("Unexpected API pagination destination.");
    await expect(getAll(pages({ "a/": { results: [], next: "https://app.example/admin/" } }), "a/"))
      .rejects.toThrow("Unexpected API pagination destination.");
  });

  it("stops on a repeated page", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example", host: "app.example" } });
    const api = pages({ "a/": { results: [1], next: "https://app.example/api/v2/a/" } });
    await expect(getAll(api, "a/")).rejects.toThrow("Repeated API pagination page.");
  });
});

describe("DjangoClient", () => {
  it("unwraps data envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { data: { id: 1 } })));
    expect(await new DjangoClient("token").get("thing/")).toEqual({ id: 1 });
  });

  it("rejects a successful response that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>proxy page</html>", { status: 200 })));
    await expect(new DjangoClient("token").get("thing/")).rejects.toThrow(/not JSON/);
  });

  it("renews the CSRF token once and resends with the same idempotency key", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      if (url === "/api/auth/session/") return json(200, { authenticated: true, username: "s", csrf_token: "fresh" });
      return calls.filter((c) => c.url === url).length === 1
        ? json(403, { detail: "CSRF Failed: CSRF token incorrect." })
        : json(201, { data: { ok: true } });
    }));
    expect(await new DjangoClient("stale").post("orders/", { a: 1 }, "key-1")).toEqual({ ok: true });
    const posts = calls.filter((c) => c.url === "/api/v2/orders/");
    expect(posts.map((c) => c.headers["X-CSRFToken"])).toEqual(["stale", "fresh"]);
    expect(posts.map((c) => c.headers["Idempotency-Key"])).toEqual(["key-1", "key-1"]);
  });

  it("does not retry other 403 responses", async () => {
    const fetch = vi.fn(async () => json(403, { detail: "You do not have permission to perform this action." }));
    vi.stubGlobal("fetch", fetch);
    await expect(new DjangoClient("token").post("orders/", {}, "k")).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
