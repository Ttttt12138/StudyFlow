// Shapes returned by finance/copilot (scenarios.view, preview, apply), readiness/state and the review/notification routes.

export type Cost = {
  cost_id: string; category?: string; label?: string; component?: string; amount?: string | null; lower?: string | null; upper?: string | null;
  currency: string; period?: string; due_date?: string | null; paid?: boolean; applicability?: string; locked?: boolean; conflict?: boolean;
  confidence_type?: string; planned_overrides?: { amount: string; effective_on: string }[];
};
export type FundingSource = { id: string; kind: string; amount: string; currency: string; available_on: string; received?: boolean; already_in_opening?: boolean; certainty?: string; label?: string };
export type ReadinessState = {
  state_version: number; budget_version: number; analysis_version: number; semester_id: string;
  assets?: { balance_as_of?: string; currency?: string };
  estimated_expenses: Cost[]; expected_income?: FundingSource[]; reserve?: string | null;
};

export type LoanTerms = { currency: "THB"; principal: string; annual_rate: string; fees: string; months: number; first_due_date: string };
export type ScenarioInput = {
  name: string; costs?: { cost_id: string; amount: string; effective_on: string }[];
  family_support?: { source_id?: string | null; amount: string; available_on: string }[];
  allow_new_loan: boolean; loan?: LoanTerms | null; loan_available_on?: string | null;
};

export type Repayment = { number: number; due_date: string; amount: string; principal?: string; interest?: string };
export type Affordability = { status: "AFFORDABLE" | "UNAFFORDABLE" | "INSUFFICIENT_DATA"; missing_inputs?: string[]; shortfall_months?: string[] };
export type LoanResult = {
  principal: string; net_proceeds: string; fees: string; total_interest: string; total_repayment: string; repayments: Repayment[];
  maximum_installment?: string; affordability?: Affordability;
};
export type Month = { month: string; ending_balance: string; minimum_balance: string };
export type Metrics = {
  maximum_reserve_gap: string; minimum_balance: string; first_below_reserve: string | null; first_negative_date: string | null;
  remaining_expenses: string; semester_funding_gap: string; complete: boolean; monthly?: Month[]; issues?: unknown[];
};
export type DeltaKey = "maximum_reserve_gap" | "minimum_balance" | "remaining_expenses" | "loan_needed";
export type ScenarioResult = Metrics & {
  name: string; conditional: boolean; conditions: string[]; confirmed: Metrics; loan: LoanResult | null;
  loan_needed: string; unmet_gap: string; assumptions?: ScenarioInput; delta?: Record<DeltaKey, string>;
};
export type WhatIfRun = {
  id: string; baseline: ScenarioResult; scenarios: ScenarioResult[]; stale: boolean; applied_index: number | null;
  application: ApplyResult | Record<string, never>; dependencies?: Record<string, unknown>;
};

export type DiffKind = "cost" | "family_support" | "loan_draft" | "allow_new_loan";
export type DiffEntry = { kind: DiffKind; id?: string | null; before: unknown; after: unknown };
export type Blocker = { code: string; cost_id: string; before: Cost; proposed: { cost_id: string; amount: string; effective_on: string } };
export type ApplyPreview = { scenario_index: number; diff: DiffEntry[]; blockers: Blocker[]; confirmation: string | null; expires_in_seconds: number };
export type ApplyResult = {
  status: "APPLIED"; run_id: string; before: Record<string, unknown>; after: Record<string, unknown>; diff: DiffEntry[];
  support_requests: { id: string; amount?: string; status?: string; available_on?: string }[];
  loan: { quote: { id: string }; application: { id: string; status?: string } } | null;
};

export type Layer = {
  status?: string; calls?: { provider?: string; mode?: string; purpose?: string; error_code?: string }[]; outcome?: unknown; inputs?: unknown;
  formulas?: Record<string, string>; decision?: string | null; rules?: unknown; next_action?: string; events?: { action: string; timestamp: string; decision?: string | null }[];
  error_code?: string; route?: string; http_status?: number; engine_version?: string; calls_are_original?: boolean;
};
export type Explanation = { trace_id: string; entity_id: string; created_at: string; layers: Partial<Record<"jev" | "llm" | "deterministic" | "policy", Layer>> };

export type ReviewStatus = "OPEN" | "IN_PROGRESS" | "WAITING_INFORMATION" | "RESOLVED" | "REJECTED";
export type ReviewItem = { id: string; key: string; kind: string; entity_id: string; status: ReviewStatus; version: number; assignee: number | null; details: Record<string, unknown>; updated_at: string; created_at?: string };
export type ReviewHistory = { id: string; action: string; reason: string; created_at: string; before?: { status?: string }; after?: { status?: string } };
export type ReviewPage = { count: number; items: ReviewItem[]; next: string | null; previous: string | null };

export type Notification = { id: string; created_at: string; transition: string; read_at: string | null; payload: { kind?: string; details?: unknown }; target?: { kind: string; id: string } };

export type CopilotSnapshot = {
  state: ReadinessState | null; reviews: ReviewItem[]; notifications: Notification[];
  errors: Partial<Record<"state" | "reviews" | "notifications", string>>;
};
