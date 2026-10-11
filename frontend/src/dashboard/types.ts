// Presentation contract for the four Django dashboard reads. Financial values are server supplied.
export type Versions = { state_version: number; budget_version: number; analysis_version: number };
export type Obligation = {
  id: string;
  label: string;
  date: string | null;
  amount: string | null;
  currency: string;
  status: string;
};
export type Briefing = Versions & {
  status: string;
  as_of: string;
  is_simulated: boolean;
  data_issues: string[];
  next_obligation: Obligation | null;
  earliest_risk_date: string | null;
  actions: Array<{ kind: string; reason: unknown }>;
  next_installment: { id: string; date: string; amount: string } | null;
};
export type Calendar = Versions & { as_of: string; is_simulated: boolean; calendar: Obligation[] };
export type Notification = {
  id: string;
  transition: string;
  payload: { kind?: string; details?: unknown };
  created_at: string;
  read_at: string | null;
  target?: { kind: string; id: string };
};
export type Notifications = {
  data: Notification[];
  unread_count: number;
  count: number;
  next: string | null;
  previous: string | null;
};
export type ReviewItem = {
  id: string;
  kind: string;
  status: string;
  details: Record<string, unknown>;
  updated_at: string;
};
export type Reviews = {
  data: { count: number; items: ReviewItem[]; next: string | null; previous: string | null };
};
export type DashboardData = {
  current: Versions;
  briefing: Briefing;
  calendar: Calendar;
  notifications: Notifications;
  reviews: Reviews;
};
export type DashboardScenario = "attention" | "clear" | "empty" | "stale" | "error" | "signed_out";
