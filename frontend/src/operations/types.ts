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
  target: (OpsPayment & { kind: "payment" }) | (OpsOrder & { kind: "remittance_order" }) | null;
};

export type OpsBeneficiary = Student & { id: string; name: string; destination_label: string; verified: boolean; created_at: string };

export type OpsApplication = Student & {
  id: string; version: number; status: "UNDER_REVIEW" | "APPROVED"; created_at: string; decision_reason: string;
  assessment: { status?: string; missing_inputs?: string[]; shortfall_months?: string[] } & Record<string, unknown>;
  quote: { currency: string; principal: string; net_proceeds: string; fees: string; total_repayment: string;
    maximum_installment: string; affordability_status?: string; months: number; annual_rate: string };
};

export type OpsSponsorRequest = Student & {
  id: string; status: "PENDING" | "EXPIRED" | "CONFIRMED"; terms_version: number; purpose: string; created_at: string;
  token_expires_at: string | null; confirmed_at: string | null;
  source: { id: string; amount: string; currency: string; available_on: string; received: boolean };
};

export type OpsQueue = {
  operator: { id: number; username: string };
  approvals: OpsApproval[];
  recent_decisions: OpsApproval[];
  payments: OpsPayment[];
  remittance_orders: OpsOrder[];
  beneficiaries: OpsBeneficiary[];
  applications: OpsApplication[];
  sponsor_requests: OpsSponsorRequest[];
  is_simulated: boolean;
};
