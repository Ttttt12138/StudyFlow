// Shapes Django returns for family support (finance/sponsorship.public_record, token_preview, confirm_token).

export type SponsorStatus = "PENDING" | "EXPIRED" | "CONFIRMED" | "REJECTED" | "REVOKED" | "RECEIVED";
export const SPONSOR_STATUSES: SponsorStatus[] = ["PENDING", "EXPIRED", "CONFIRMED", "REJECTED", "REVOKED", "RECEIVED"];

export type FundingSourceRecord = {
  id: string; economic_key: string; kind: string; currency: string; amount: string; available_on: string;
  certainty: string; received: boolean;
};

export type SponsorRequest = {
  id: string; created_at: string; source: FundingSourceRecord; purpose: string; terms_version: number; status: SponsorStatus;
  token_expires_at: string | null; confirmed_at: string | null; is_simulated?: boolean;
};

export type FamilySnapshot = { requests: SponsorRequest[]; errors: Partial<Record<"requests", string>> };

export type SponsorPreview = {
  request_id: string; terms_version: number; amount: string; currency: string; available_on: string; purpose: string;
  expires_at: string; is_simulated: boolean;
};

export type SponsorDecision = "confirm" | "reject";
export type SponsorResult = { request_id: string; status: "CONFIRMED" | "REJECTED"; is_simulated?: boolean };
