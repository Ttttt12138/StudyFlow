import type { DashboardData, DashboardScenario } from "./types";

// Synthetic, fixed responses shaped like Django's briefing, calendar, notifications and review queue.
// No balances, risk labels, amounts or dates are calculated in the browser.
const attention: DashboardData = {
  current: { state_version: 7, budget_version: 4, analysis_version: 2 },
  briefing: {
    state_version: 7, budget_version: 4, analysis_version: 2,
    status: "NEEDS_INFORMATION", as_of: "2026-10-08", is_simulated: true,
    data_issues: ["MISSING:food", "MISSING_PROFILE:student_type"],
    next_obligation: { id: "cost:tuition", label: "Tuition payment", date: "2026-11-15", amount: "41000.00", currency: "THB", status: "due" },
    earliest_risk_date: "2026-11-15",
    actions: [{ kind: "missing_information", reason: { issues: ["MISSING:food"] } }],
    next_installment: null,
  },
  calendar: {
    state_version: 7, budget_version: 4, analysis_version: 2, as_of: "2026-10-08", is_simulated: true,
    calendar: [
      { id: "cost:tuition", label: "Tuition payment", date: "2026-11-15", amount: "41000.00", currency: "THB", status: "due" },
      { id: "cost:housing", label: "Housing", date: "2026-12-01", amount: "9000.00", currency: "THB", status: "due" },
    ],
  },
  notifications: {
    data: [
      { id: "notice-1", transition: "created", payload: { kind: "missing_information" }, created_at: "2026-10-08T09:00:00Z", read_at: null, target: { kind: "risk", id: "risk-1" } },
      { id: "notice-2", transition: "changed", payload: { kind: "semester_gap" }, created_at: "2026-10-07T09:00:00Z", read_at: "2026-10-07T10:00:00Z", target: { kind: "risk", id: "risk-2" } },
    ],
    unread_count: 1, count: 2, next: null, previous: null,
  },
  reviews: {
    data: { count: 1, items: [{ id: "review-1", kind: "document_conflict", status: "OPEN", details: { label: "Tuition source conflict" }, updated_at: "2026-10-08T08:00:00Z" }], next: null, previous: null },
  },
};

export async function loadDashboardPreview(scenario: DashboardScenario): Promise<DashboardData> {
  // Keep an observable loading state for the preview; no network request is made.
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (scenario === "error") throw new Error("The demo dashboard could not load. Try again.");
  const data = structuredClone(attention);
  if (scenario === "clear") {
    data.briefing.status = "SAFE";
    data.briefing.data_issues = [];
    data.briefing.actions = [];
    data.briefing.earliest_risk_date = null;
    data.notifications = { data: [], unread_count: 0, count: 0, next: null, previous: null };
    data.reviews = { data: { count: 0, items: [], next: null, previous: null } };
  }
  if (scenario === "empty") {
    data.briefing.status = "NEEDS_INFORMATION";
    data.briefing.data_issues = [];
    data.briefing.actions = [];
    data.briefing.next_obligation = null;
    data.briefing.earliest_risk_date = null;
    data.calendar.calendar = [];
    data.notifications = { data: [], unread_count: 0, count: 0, next: null, previous: null };
    data.reviews = { data: { count: 0, items: [], next: null, previous: null } };
  }
  if (scenario === "stale") {
    data.current.budget_version = 5;
  }
  return data;
}
