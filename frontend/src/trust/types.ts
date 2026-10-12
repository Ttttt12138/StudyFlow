// Shapes from backend/finance/credit.py (profile), policy.py (limits_summary) and the audit read route.
export type CreditProfile = {
  level: string;
  on_time: number;
  late: number;
  overdue: number;
  as_of: string;
  limit_multiplier: string;
  factors: Array<{ code: string; effect: "positive" | "negative" | "neutral"; count: number }>;
  next_level: null | { level: string; on_time_needed?: number; late_records_must_age_out?: boolean; action?: string };
  evidence: Array<{ source: string; id: string; due_on: string; completed_on: string | null; status: string }>;
  is_simulated: boolean;
  disclaimer: string;
};

type Windows = { per_transaction: string; daily: string; monthly: string };
export type LimitsSummary = {
  credit_level: string;
  limit_multiplier: string;
  window_zone: string;
  limits: Array<{ currency: string; base: Windows; effective: Windows; usage: { daily: string; monthly: string } }>;
  is_simulated: boolean;
};

export type TrustApproval = {
  id: string;
  action: string;
  target_id: string;
  amount: string;
  currency: string;
  status: string;
  reason: string;
  expires_at: string;
  version: number;
};

export type AuditEvent = {
  id: string;
  action: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
};
export type AuditPage = { count: number; next: string | null; previous: string | null; results: AuditEvent[] };
