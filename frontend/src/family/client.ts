import { getAll } from "../backend/client";
import { acceptLanguage, getLang, translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { FamilySnapshot, SponsorDecision, SponsorPreview, SponsorRequest, SponsorResult } from "./types";

function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : translate(getLang(), "common.err.section");
}

export async function loadFamily(client: WalletClient): Promise<FamilySnapshot> {
  const [requests] = await Promise.allSettled([getAll<SponsorRequest>(client, "sponsor-requests/")]);
  return {
    requests: requests.status === "fulfilled" ? requests.value : [],
    errors: requests.status === "rejected" ? { requests: errorText(requests.reason) } : {},
  };
}

/** The sponsor's client: anonymous, no session cookie or CSRF (ConfirmationView has no authentication classes). */
export interface SponsorClient {
  preview(token: string): Promise<SponsorPreview>;
  decide(token: string, body: { terms_version: number; decision: SponsorDecision }, key: string): Promise<SponsorResult>;
}

async function call<T>(token: string, init: { method: "GET" | "POST"; body?: unknown; key?: string }): Promise<T> {
  const headers: Record<string, string> = { "Accept": "application/json", "Accept-Language": acceptLanguage(), "X-Sponsor-Token": token };
  if (init.method === "POST") Object.assign(headers, { "Content-Type": "application/json", "Idempotency-Key": init.key! });
  let response: Response;
  try {
    response = await fetch("/api/v2/sponsor-confirmation/", { method: init.method, credentials: "omit", cache: "no-store", headers,
      body: init.method === "POST" ? JSON.stringify(init.body) : undefined });
  } catch { throw new WalletApiError(0, { detail: translate(getLang(), "common.err.unreachable") }); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new WalletApiError(response.status, payload);
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new WalletApiError(response.status, { detail: translate(getLang(), "common.err.notJson") });
  return (payload as { data: T }).data;
}

export const sponsorClient: SponsorClient = {
  preview: (token) => call<SponsorPreview>(token, { method: "GET" }),
  decide: (token, body, key) => call<SponsorResult>(token, { method: "POST", body, key }),
};
