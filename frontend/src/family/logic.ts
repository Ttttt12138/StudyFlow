import type { SponsorRequest } from "./types";

// Django's default STUDYFLOW_SUPPORTED_CURRENCIES (config/settings.py); THB first as the home currency.
export const CURRENCIES = ["THB", "CNY", "USD", "EUR", "GBP", "JPY"] as const;
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const TOKEN = /^[0-9a-f]{64}$/i;

/** Why an amount would be refused (MoneyField: 2 decimals, positive; JPY whole units), or null when it is fine. */
export function amountProblem(amount: string, currency: string): "format" | "positive" | "jpy" | null {
  const value = amount.trim();
  if (!MONEY.test(value)) return "format";
  if (Number(value) <= 0) return "positive";
  if (currency === "JPY" && !/^\d+(\.0{1,2})?$/.test(value)) return "jpy";
  return null;
}

/** Client-generated economic key; Django keeps it unique per student, so it doubles as the lookup after a lost response. */
export function newEconomicKey(purpose: string, random: () => string = () => crypto.randomUUID().slice(0, 8)): string {
  const slug = purpose.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "support";
  return `family-${slug}-${random()}`.slice(0, 100);
}

export const isSponsorToken = (value: string) => TOKEN.test(value);

/** The token from a location hash (`#token=…`), a pasted link, or the bare 64-hex value; null if none is found. */
export function extractToken(input: string): string | null {
  const text = input.trim();
  if (isSponsorToken(text)) return text.toLowerCase();
  const match = /(?:^|[#&?])token=([^&#\s]*)/.exec(text);
  const value = match ? decodeURIComponent(match[1]) : "";
  return isSponsorToken(value) ? value.toLowerCase() : null;
}

export type Step = "operator" | "family" | "expired" | "money" | "received" | "rejected" | "revoked";

/** Where a request is in the flow; a PENDING request has a link only once an operator issued one (expiry set). */
export function requestStep(request: Pick<SponsorRequest, "status" | "token_expires_at" | "source">): Step {
  switch (request.status) {
    case "RECEIVED": return "received";
    case "CONFIRMED": return request.source.received ? "received" : "money";
    case "REJECTED": return "rejected";
    case "REVOKED": return "revoked";
    case "EXPIRED": return "expired";
    default: return request.token_expires_at ? "family" : "operator";
  }
}

export const STEP_ORDER: Step[] = ["operator", "family", "money", "received"];

export function statusTone(status: string): "ok" | "pending" | "failed" | "used" {
  if (status === "CONFIRMED" || status === "RECEIVED") return "ok";
  if (status === "REJECTED" || status === "EXPIRED") return "failed";
  if (status === "REVOKED") return "used";
  return "pending";
}

export const canChange = (request: Pick<SponsorRequest, "status" | "source">) => request.status !== "RECEIVED" && !request.source.received;
export const canRevoke = (request: Pick<SponsorRequest, "status" | "source">) => canChange(request) && request.status !== "REVOKED";
