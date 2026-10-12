import { WalletApiError, type WalletClient } from "../wallet/client";
import type { SponsorClient } from "./client";
import type { SponsorPreview, SponsorRequest } from "./types";

// Fixed synthetic records for the previews; no Django request is made.
const id = (n: string) => `00000000-0000-4000-8000-0000000${n}`;
const source = (n: string, economic_key: string, currency: string, amount: string, available_on: string, certainty = "estimated", received = false) =>
  ({ id: id(`f${n}`), economic_key, kind: "family", currency, amount, available_on, certainty, received });

const requests: SponsorRequest[] = [
  { id: id("s001"), created_at: "2026-10-10T02:00:00Z", source: source("001", "family-rent-deposit-3f9a1c2e", "CNY", "8000.00", "2026-11-01"),
    purpose: "Rent deposit for the new semester", terms_version: 1, status: "PENDING", token_expires_at: null, confirmed_at: null },
  { id: id("s002"), created_at: "2026-10-08T02:00:00Z", source: source("002", "family-tuition-b2c4d6e8", "THB", "45000.00", "2026-10-25"),
    purpose: "Second tuition installment", terms_version: 2, status: "PENDING", token_expires_at: "2026-10-14T02:00:00Z", confirmed_at: null },
  { id: id("s003"), created_at: "2026-09-20T02:00:00Z", source: source("003", "family-living-costs-7e8f9a0b", "USD", "600.00", "2026-10-15", "confirmed"),
    purpose: "Living costs for October", terms_version: 1, status: "CONFIRMED", token_expires_at: "2026-09-23T02:00:00Z", confirmed_at: "2026-09-21T09:30:00Z" },
  { id: id("s004"), created_at: "2026-09-01T02:00:00Z", source: source("004", "family-laptop-1a2b3c4d", "JPY", "120000.00", "2026-09-10", "confirmed", true),
    purpose: "Laptop for coursework", terms_version: 1, status: "RECEIVED", token_expires_at: "2026-09-04T02:00:00Z", confirmed_at: "2026-09-02T11:00:00Z" },
];

export function createFamilyPreview(): WalletClient {
  return {
    async get<T>(path: string): Promise<T> {
      if (path === "sponsor-requests/") return requests as T;
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}

export const SPONSOR_PREVIEW: SponsorPreview = {
  request_id: id("s002"), terms_version: 2, amount: "45000.00", currency: "THB", available_on: "2026-10-25",
  purpose: "Second tuition installment", expires_at: "2026-10-14T02:00:00Z", is_simulated: true,
};

export const sponsorPreviewClient: SponsorClient = {
  async preview() { return SPONSOR_PREVIEW; },
  async decide() { throw new WalletApiError(0, { detail: "The preview is read-only." }); },
};
