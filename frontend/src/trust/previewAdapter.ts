import { WalletApiError, type WalletClient } from "../wallet/client";
import type { AuditPage, CreditProfile, LimitsSummary, TrustApproval } from "./types";

// Fixed synthetic records for the signed-out preview; no Django request is made.
const profile: CreditProfile = {
  level: "FAIR", on_time: 4, late: 0, overdue: 0, as_of: "2026-10-11", limit_multiplier: "1.2",
  factors: [{ code: "ON_TIME_RECORDS", effect: "positive", count: 4 }],
  next_level: { level: "GOOD", on_time_needed: 2, late_records_must_age_out: false },
  evidence: [
    { source: "payment", id: "p-1", due_on: "2026-08-01", completed_on: "2026-07-30", status: "ON_TIME" },
    { source: "loan_installment", id: "l-1", due_on: "2026-09-01", completed_on: "2026-08-31", status: "ON_TIME" },
    { source: "remittance_order", id: "r-1", due_on: "2026-09-15", completed_on: "2026-09-12", status: "ON_TIME" },
    { source: "payment", id: "p-2", due_on: "2026-10-01", completed_on: "2026-10-01", status: "ON_TIME" },
  ],
  is_simulated: true,
  disclaimer: "Simulated on-time record inside StudyFlow. Not a credit score and not reported to or obtained from any credit bureau.",
};

const limits: LimitsSummary = {
  credit_level: "FAIR", limit_multiplier: "1.2", window_zone: "Asia/Bangkok", is_simulated: true,
  limits: [
    { currency: "CNY", base: { per_transaction: "10000.00", daily: "20000.00", monthly: "60000.00" },
      effective: { per_transaction: "12000.00", daily: "24000.00", monthly: "72000.00" }, usage: { daily: "5000.00", monthly: "15000.00" } },
    { currency: "THB", base: { per_transaction: "50000.00", daily: "100000.00", monthly: "300000.00" },
      effective: { per_transaction: "60000.00", daily: "120000.00", monthly: "360000.00" }, usage: { daily: "0.00", monthly: "48000.00" } },
  ],
};

const approvals: TrustApproval[] = [{
  id: "00000000-0000-4000-8000-0000000a7001", action: "remittance.submit", target_id: "00000000-0000-4000-8000-0000000a7002",
  amount: "15000.00", currency: "CNY", status: "PENDING", reason: "Semester tuition",
  expires_at: "2026-10-12T03:00:00Z", version: 1,
}];

const audit: AuditPage = {
  count: 4, next: null, previous: null,
  results: [
    { id: "a4", action: "approval.requested", entity_id: approvals[0].id, created_at: "2026-10-11T03:10:00Z",
      details: { actor_id: 1, action: "remittance.submit", amount: "15000.00", currency: "CNY" } },
    { id: "a3", action: "agent.action_confirmed", entity_id: "00000000-0000-4000-8000-0000000a6e05", created_at: "2026-10-11T03:05:00Z",
      details: { actor_id: 1, action: "remittance.submit" } },
    { id: "a2", action: "auth.step_up_granted", entity_id: "00000000-0000-4000-8000-0000000a7003", created_at: "2026-10-11T03:04:30Z",
      details: { actor_id: 1, action: "remittance.submit", amount: "5000.00", currency: "CNY" } },
    { id: "a1", action: "fx.live_quote_created", entity_id: "00000000-0000-4000-8000-0000000a7004", created_at: "2026-10-11T03:00:00Z",
      details: { actor_id: 1 } },
  ],
};

export function createTrustPreview(): WalletClient {
  const routes: Record<string, unknown> = {
    "credit/profile/": profile, "policy/limits/": limits, "audit/": audit,
    "approvals/": { count: approvals.length, next: null, previous: null, results: approvals },
  };
  return {
    async get<T>(path: string): Promise<T> {
      if (path in routes) return routes[path] as T;
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}
