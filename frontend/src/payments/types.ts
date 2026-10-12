// Shapes from backend/finance/execution_services.py (payments), readiness/services.py
// (financial_state) and readiness/api.py (funding runs). Records use Django field names.
export type PaymentStatus =
  | "draft" | "authorized" | "pending" | "unknown" | "settled"
  | "reconciled" | "reconciliation_exception" | "failed" | "cancelled" | "expired";

export type Receipt = {
  reference: string; operation_key: string; event_id: string; amount: string; currency: string;
  beneficiary_id: string; is_simulated: boolean; settled_on: string; invoice_id?: string; issuer?: string;
};

export type Payment = {
  id: string; created_at: string; plan: string | null; readiness_plan: string | null;
  beneficiary: string; event_id: string; amount: string; due_on: string; status: PaymentStatus;
  authorized_until: string | null; submitted_at: string | null; receipt: Receipt | null;
  invoice_snapshot: Partial<Record<"invoice_id" | "issuer" | "currency" | "amount" | "due_date", string>>;
  is_simulated: boolean;
};

export type Obligation = {
  id: string; label?: string; kind: string; amount: string | null; date: string | null;
  certainty: string; beneficiary_id?: string; settled_sequence?: number;
};

export type Cost = {
  cost_id: string; category: string; label?: string; amount?: string | null; currency?: string;
  invoice_id?: string; issuer?: string; confidence_type?: string; beneficiary_id?: string;
};

export type ReadinessState = {
  state_version: number; budget_version: number; analysis_version: number; semester_id: string;
  assets: { wallet_balance: string | null; currency: string; balance_as_of: string };
  confirmed_obligations: Obligation[];
  estimated_expenses: Cost[];
};

export type FundingRun = {
  id: string; created_at: string; kind: string; state_version: number; budget_version: number;
  analysis_version: number; result: { validation?: string } & Record<string, unknown>;
};

export type Beneficiary = { id: string; name: string; destination_label: string; verified: boolean };

export type LedgerEntry = { id: string; sequence: number; payment: string | null; amount: string; currency: string; created_at: string };

export type PaymentApproval = {
  id: string; action: string; target_id: string; amount: string; currency: string;
  status: string; expires_at: string; version: number;
};

export type AuditEvent = { id: string; action: string; entity_id: string; details: Record<string, unknown>; created_at: string };

export type PaymentsSnapshot = {
  state: ReadinessState | null;
  plans: FundingRun[];
  beneficiaries: Beneficiary[];
  payments: Payment[];
  approvals: PaymentApproval[];
  ledger: LedgerEntry[];
  audit: AuditEvent[];
  errors: Partial<Record<"state" | "plans" | "beneficiaries" | "payments" | "approvals" | "ledger" | "audit", string>>;
};
