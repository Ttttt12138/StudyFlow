// Shapes from backend/finance/consumption (imports.py, analysis.py, monitoring.py) and
// backend/finance/readiness (services.financial_state, RiskCard, ReadinessJob). Records use Django field names.
export const CATEGORIES = ["Rent", "Food", "Transport", "Mobile", "Utilities", "Subscription", "Transfer", "Income", "Refund", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type SourceType = "user_uploaded" | "synthetic";

export type PreviewRow = {
  locator: string; transaction_id: string | null; account_id: string; date: string; amount: string; currency: string;
  counterparty: string; description: string; status?: string; duplicate: boolean; suspected_duplicate: boolean;
  classification: { category: Category; basis: string; confidence: number; rule_version?: string; source_type?: string };
};
export type RowIssue = { code: string; locator: string | null; field?: string | null; message: string };

export type Coverage = { account_id: string; start: string; end: string; complete: boolean };
export type TransactionImport = {
  id: string; created_at: string; sha256: string; source_type: SourceType; status: "NEEDS_REVIEW" | "COMMITTED" | string;
  preview: { rows: PreviewRow[]; issues: RowIssue[] };
  confirmation: Partial<{ selected_rows: string[]; keep_similar_rows: string[]; coverage: Coverage[] }>;
  analysis_version?: number;
};

export type Transaction = {
  id: string; created_at: string; account: string; batch: string; external_id: string | null; locator: string;
  date: string; amount: string; currency: string; counterparty: string; description: string; category: Category;
  classification: { category?: string; basis?: string; confidence?: number; source_type?: string };
  needs_review: boolean; cost_id: string; refund_of: string | null;
};

export type RecurringExpense = {
  id: string; created_at: string; account: string; merchant_key: string; decision: "inferred" | "accepted" | "ignored" | string;
  cost_id: string; active: boolean;
  result: { category?: string; counterparty?: string; amount?: string; currency?: string; frequency?: string;
    expected_next_date?: string; confidence_type?: string; basis?: string; supporting_transaction_ids?: string[] };
};

export type CostChange = {
  cost_id: string; category: string; original_amount: string | null; actual_amount?: string; suggested_monthly: string | null;
  forecast_amount: string | null; applied: boolean; reason: "MONTHLY_MEDIAN" | "LOCKED_OR_CONTRACTUAL" | "INSUFFICIENT_COMPLETE_MONTHS" | string;
  sample_months: number; synthetic?: boolean;
};
export type Briefing = {
  status: "SAFE" | "AT_RISK" | "NEEDS_INFORMATION"; as_of: string; state_version: number; budget_version: number; analysis_version: number;
  earliest_risk_date: string | null; risks: Record<string, unknown>;
  forecast_changes: Partial<{ costs: CostChange[]; complete_months: string[]; unresolved_transactions: boolean; as_of: string }>;
};

export type RiskCard = { id: string; created_at: string; updated_at: string; kind: string; active: boolean; details: Record<string, unknown> };
export type CheckJob = {
  id: string; created_at: string; kind: string; status: "QUEUED" | "RUNNING" | "DONE" | "RETRY" | string; attempts: number;
  error_code: string; payload: { trigger?: string; analysis_version?: number; state_version?: number; budget_version?: number };
};

export type Cost = { cost_id: string; category: string; amount?: string | null; period?: string };
export type ReadinessState = {
  state_version: number; budget_version: number; analysis_version: number; semester_id: string;
  assets: { currency: string; balance_as_of?: string; wallet_balance?: string | null };
  estimated_expenses: Cost[];
};
export type Versions = Pick<ReadinessState, "semester_id" | "state_version" | "budget_version" | "analysis_version">;

export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type InsightsSnapshot = {
  state: ReadinessState | null; clock: string | null; imports: TransactionImport[]; recurring: RecurringExpense[];
  risks: RiskCard[]; checks: CheckJob[]; briefing: Briefing | null;
  errors: Partial<Record<"state" | "imports" | "recurring" | "risks" | "checks" | "briefing", string>>;
};
