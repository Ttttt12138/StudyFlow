// Shapes returned by /api/v2/agent/conversations/ and /api/v2/planning/ (backend/finance/planning).
export type Role = "parent" | "student";
export type Text = { en: string; zh: string };
export type Converted = { currency: string; amount: string; rate: string; rate_date: string | null; source: string | null } | null;

export type SchoolBrief = {
  key: string; name: Text; country: Text; city: Text; currency: string; program: Text; duration_years: number;
  intake: string; start_date: string; tuition_per_year: string; living_per_year: string; first_year_total: string;
  first_year_converted?: Converted; sample: true;
};

export type Place = { name: Text; kind: string; note: Text; distance_km: number | null; typical_cost: string | null; source_url: string | null };
export type CatalogCost = { cost_id: string; category: string; label: Text; period: string; amount: string | null; lower: string | null; upper: string | null; estimate: boolean; source_url: string | null };
export type CatalogEntry = {
  key: string; school: { name: Text; country: Text; city: Text; campus: string | null; currency: string; program: Text; language: string; website: string; duration_years: number | null };
  calendar: { intake: string; start_date: string; end_date: string };
  costs: CatalogCost[]; facilities: Place[]; food: Place[]; attractions: Place[];
  sources: { url: string; title: string; accessed: string }[]; notes: Text[];
};

export type CostLine = { cost_id: string; category: string; group: "tuition" | "living" | "essentials"; label: Text; period: string;
  amount: string; lower: string | null; upper: string | null; per_year: string; total: string; estimate: boolean; source_url: string | null };
export type Estimate = { school_key: string; currency: string; years: number; lines: CostLine[];
  groups: Record<"tuition" | "living" | "essentials", string>; first_year: string; total: string; total_low: string;
  total_high: string; estimated_share: string; converted?: Converted; sample: true };

export type Loan = { id: string; currency: string; principal: string; months: number; annual_rate: string; monthly_payment: string; total_repayment: string };
export type Plan = {
  id: string; status: "DRAFT" | "CONFIRMED" | "ENROLLED"; school_key: string; years: number; start_date: string; version: number;
  available_funds: string | null; funds_currency: string | null; school?: { name: Text; currency: string };
  total?: string; currency?: string; converted?: Converted; available?: string | null; gap?: string | null; loan?: Loan;
};

export type Bill = { id: string; kind: string; label: Text; due_date: string; amount: string; currency: string; status: "DUE" | "PAID"; paid_at: string | null };
export type Expense = { id: string; spent_on: string; category: string; amount: string; currency: string; note: string; via_agent: boolean };
export type Spending = { month: string; currency: string; spent: string; budget: string; remaining: string; over_budget: boolean;
  by_category: Record<string, string>; unconverted?: string[]; recent?: Expense[]; expense?: Expense };
export type SpendingPage = Spending & { entries: Expense[]; count: number; next_offset: number | null };

export type Card =
  | { type: "role"; role: Role | null; home_currency: string }
  | { type: "school_list"; schools: SchoolBrief[] }
  | { type: "school"; school: CatalogEntry | null }
  | { type: "comparison"; schools: SchoolBrief[]; home_currency: string }
  | { type: "cost"; school: { key: string; name: Text }; estimate: Estimate; notes: Text[] }
  | { type: "plan"; plan: Plan }
  | { type: "loan"; plan: Plan; gap: string; gap_currency: string }
  | { type: "confirmation"; action: string; pending_action_id: string; details: Record<string, unknown>; expires_at: string; plan?: Plan; amount?: string | null; currency?: string }
  | { type: "bills"; bills: Bill[] }
  | ({ type: "spending" } & Spending);

export type PendingAction = { id: string; action: string; status: string; expires_at: string; session: string };
export type Turn = { id: string; kind: "user" | "assistant"; goal: string; final_answer: string; status: string; error_code: string;
  created_at: string; cards: Card[]; pending_actions: PendingAction[] };
export type Conversation = { id: string; locale: "zh" | "en"; profile: { role: Role | null; home_currency: string };
  plan: Plan | null; turns: Turn[] };
export type ConversationSummary = { id: string; updated_at: string; turn_count: number };

export type InSchool = { enrolled: false } | { enrolled: true; today: string; plan: Plan; upcoming_bills: Bill[]; overdue: Bill[];
  bill_count: number; spending: Spending; bills?: Bill[] };
export type FamilyLink = { id: number; relation: "child" | "parent"; account: string; created_at: string; plan?: Plan | null; in_school?: InSchool };
