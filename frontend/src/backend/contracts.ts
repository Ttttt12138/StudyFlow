export type Evidence = {
  source_id: string;
  field: string;
  quote: string;
  locator: string;
};
export type Cost = {
  cost_id: string;
  locked?: boolean;
  verified_at?: string | null;
  planned_overrides?: Array<{effective_on: string; amount: string}>;
  component?: string | null;
  category: string;
  currency?: string | null;
  amount?: string | null;
  lower?: string | null;
  upper?: string | null;
  period?: "once" | "monthly" | "semester" | "yearly" | null;
  due_date?: string | null;
  applicability?: "APPLICABLE" | "NOT_APPLICABLE";
  applicability_reason?: string | null;
  confidence_type?: "VERIFIED" | "INFERRED" | "UNCONFIRMED";
  evidence?: Evidence[];
  source_refs?: string[];
  conflict?: boolean;
  alternatives?: Record<string, unknown>[];
  paid?: boolean | null;
  [key: string]: unknown;
};
export type Draft = {
  profile: {
    school?: string | null;
    campus?: string | null;
    program?: string | null;
    semester?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    evidence?: Evidence[];
    [key: string]: unknown;
  };
  costs: Cost[];
  reserve?: string | null;
  required_categories?: string[];
};
export type Versions = {
  semester_id: string;
  state_version: number;
  budget_version: number;
  analysis_version?: number;
};
export type Semester = {
  id: string;
  draft: Draft;
  version: number;
  template_key?: string;
  template_version?: number;
  state_version?: number;
};
export type BackendState = Versions & {
  assets: {
    planning_balance: string;
    wallet_balance: string | null;
    currency: string;
    basis: string;
  };
  budget: BudgetResult;
  estimated_expenses: Cost[];
  expected_income: unknown[];
};
export type ImportRecord = {
  semester?: string;
  id: string;
  status: string;
  job_status: string | null;
  error_code: string | null;
  result: {
    draft?: Draft;
    proposed_draft?: Draft;
    merge_conflicts?: Record<string, unknown>;
    issues?: Array<{ code: string }>;
    requires_review?: boolean;
  };
  processing?: Record<string, unknown>;
};
export type BudgetResult = {
  low: string;
  base: string;
  high: string;
  remaining_base: string;
  gap: string;
  currency: string;
  complete: boolean;
  sufficient: boolean;
  issues: string[];
  assumptions: string[];
  state_version: number;
  budget_version: number;
  semester_id: string;
};
export type Run<T> = {
  semester?: string;
  id: string;
  state_version: number;
  budget_version: number;
  analysis_version?: number;
  result: T;
};
export type ForecastEvent = {
  id: string;
  date: string;
  label: string;
  kind: "expense" | "income";
  amount: string;
  certainty: string;
  balance_after: string;
  reserve_gap: string;
  source_type?: string;
};
export type ForecastResult = {
  currency: string;
  end_date: string;
  status: string;
  complete: boolean;
  conditional: boolean;
  timeline: ForecastEvent[];
  first_gap_date: string | null;
  maximum_reserve_gap: string;
  ending_balance: string;
  missing_event_ids: string[];
  excluded_unconfirmed_income: string[];
  budget_issues: string[];
  data_issues?: string[];
  assumptions: string[];
};
export type FundingResult = {
  recommended_borrowing_net: string;
  quote_required: boolean;
  assumptions: string[];
  is_recommendation_final: boolean;
  nonloan_plan: {
    validation: string;
    remaining_gap: string;
    conditions: string[];
    allocations: Array<{ source_id: string; amount: string }>;
    affordability: string;
  };
};
export type FundingSource = {
  id: string;
  kind: string;
  amount: string;
  currency: string;
  certainty: string;
  available_on: string;
  received: boolean;
  already_in_opening: boolean;
};
export type LoanQuote = {
  id: string;
  inputs?: {
    currency?: string;
    principal: string;
    annual_rate: string;
    fees: string;
    months: number;
    first_due_date: string;
  };
  result?: Record<string, unknown>;
};
export type Application = {
  id: string;
  status: string;
  version: number;
  assessment?: { status?: string; [key: string]: unknown };
  loan?: string;
  quote_id?: string;
};
export type Template = {
  key: string;
  version: number;
  profile: Draft["profile"];
  costs: Cost[];
  required_categories: string[];
};
