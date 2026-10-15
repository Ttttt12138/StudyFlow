// Shape of GET operations/queue/ (backend/finance/operations_api.py). Staff only.
type Student = { owner: number; owner_username: string };

export type OpsPayment = Student & {
  id: string; kind?: "payment"; event_id: string; amount: string; currency: string; status: string; due_on: string;
  submitted_at: string | null; beneficiary_name: string; beneficiary_verified: boolean;
  invoice_snapshot: { invoice_id?: string; issuer?: string }; payee_verified_by?: number | null;
};

export type OpsOrder = Student & {
  id: string; kind?: "remittance_order"; version: number; status: string; effective_status: string;
  recipient: "SELF" | "BENEFICIARY"; beneficiary_name: string | null; purpose: string;
  send_amount: string; send_currency: string; receive_amount: string; receive_currency: string;
  submitted_at: string | null; expected_latest: string | null; deadline: string | null; payee_verified_by?: number | null;
};

export type OpsApproval = Student & {
  id: string; action: string; target_id: string; amount: string; currency: string; reason: string;
  status: string; version: number; created_at: string; expires_at: string; decided_at: string | null; decision_note: string;
  requested_by_username: string; decided_by_username: string | null;
  can_decide: boolean; blocked_reason: null | "OWN_REQUEST" | "VERIFIED_PAYEE";
  activity_at?: string;
  target: (OpsPayment & { kind: "payment" }) | (OpsOrder & { kind: "remittance_order" }) | null;
};

export type OpsBeneficiary = Student & { id: string; name: string; destination_label: string; verified: boolean; created_at: string };

export type OpsApplication = Student & {
  id: string; version: number; status: "UNDER_REVIEW" | "APPROVED"; created_at: string; decision_reason: string;
  assessment: { status?: string; missing_inputs?: string[]; shortfall_months?: string[] } & Record<string, unknown>;
  quote: { currency: string; principal: string; net_proceeds: string; fees: string; total_repayment: string;
    maximum_installment: string; affordability_status?: string; months: number; annual_rate: string };
};

export type OpsQueue = {
  operator: { id: number; username: string };
  approvals: OpsApproval[];
  recent_decisions: OpsApproval[];
  payments: OpsPayment[];
  remittance_orders: OpsOrder[];
  beneficiaries: OpsBeneficiary[];
  applications: OpsApplication[];
  is_simulated: boolean;
};

export type OpsGroup = "approvals" | "transactions" | "payees" | "loans";
export type OpsAttention = "all" | "expiring" | "unknown";
export type OpsNavigation = { view: "overview" | "tasks" | "history"; kind: OpsGroup | "all"; attention: OpsAttention };
export type OpsFilters = { student: string; kind: OpsGroup | "all"; attention: OpsAttention; page: number };
type OpsRecords = { approval: OpsApproval; payment: OpsPayment; order: OpsOrder; payee: OpsBeneficiary; loan: OpsApplication };
export type OpsItem = { [K in keyof OpsRecords]: { kind: K; record: OpsRecords[K]; queued_at: string; attention: Exclude<OpsAttention, "all"> | null } }[keyof OpsRecords];
export type OpsSummary = { total: number; expiring: number; unknown: number; unverified: number; by_kind: Record<OpsGroup, number> };
export type OpsWorkbench = {
  operator: OpsQueue["operator"]; summary: OpsSummary; items: OpsItem[]; recent_decisions: OpsApproval[];
  pagination: { page: number; page_size: number; total: number; pages: number };
  generated_at: string; is_simulated: boolean;
};
