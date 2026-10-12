import type { AuditEvent, Beneficiary, Cost, FundingRun, Obligation, Payment, PaymentApproval, PaymentStatus, ReadinessState } from "./types";

// Statuses that still hold an expense (backend: one_active_or_settled_payment_per_event).
const CLOSED: PaymentStatus[] = ["failed", "cancelled", "expired"];

/** What the student can do next with a payment; mirrors the guards in execution_services.py. */
export type Stage =
  | "authorize" | "submit" | "authorization_expired" | "awaiting_adapter" | "unknown"
  | "reconcile" | "exception" | "done" | "failed" | "cancelled";

export function paymentStage(payment: Payment, now = Date.now()): Stage {
  switch (payment.status) {
    case "draft": return "authorize";
    case "authorized":
      return payment.authorized_until && Date.parse(payment.authorized_until) > now ? "submit" : "authorization_expired";
    case "pending": return "awaiting_adapter";
    case "unknown": return "unknown";
    case "settled": return "reconcile";
    case "reconciliation_exception": return "exception";
    case "reconciled": return "done";
    case "failed": return "failed";
    default: return "cancelled";
  }
}

/** The five milestones shown as a progress rail; `failed` marks where a closed payment stopped. */
export const MILESTONES = ["created", "authorized", "submitted", "settled", "reconciled"] as const;
export type Milestone = (typeof MILESTONES)[number];

export function milestoneReached(payment: Payment): number {
  const order: Partial<Record<PaymentStatus, number>> = {
    draft: 0, authorized: 1, pending: 2, unknown: 2, settled: 3, reconciliation_exception: 3, reconciled: 4,
  };
  if (payment.status in order) return order[payment.status]!;
  // Closed payments: submitted ones failed at the adapter; others were cancelled before submission.
  return payment.submitted_at ? 2 : payment.authorized_until ? 1 : 0;
}

/** Milestones up to the last one reached are done; the next is current, or stopped if the payment cannot continue. */
export function railState(payment: Payment, index: number): "done" | "current" | "stopped" | "todo" {
  const reached = milestoneReached(payment);
  if (index <= reached) return "done";
  if (index > reached + 1) return "todo";
  return CLOSED.includes(payment.status) || payment.status === "reconciliation_exception" ? "stopped" : "current";
}

/** Latest readiness funding plan, and whether it still matches the current versions (payment_bridge.evaluate_payment). */
export function currentPlan(plans: FundingRun[], state: ReadinessState | null): { plan: FundingRun | null; issue: "" | "NONE" | "STALE" | "INVALID" } {
  const latest = [...plans].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  if (!latest) return { plan: null, issue: "NONE" };
  if (!state || latest.state_version !== state.state_version || latest.budget_version !== state.budget_version
    || latest.analysis_version !== state.analysis_version) return { plan: latest, issue: "STALE" };
  if (latest.result?.validation !== "VALID") return { plan: latest, issue: "INVALID" };
  return { plan: latest, issue: "" };
}

export type Payability = "READY" | "SETTLED" | "HAS_PAYMENT" | "NO_AMOUNT" | "NO_BENEFICIARY" | "BENEFICIARY_UNVERIFIED" | "INVOICE_REQUIRED";

function costFor(event: Obligation, costs: Cost[]): Cost | undefined {
  return costs.find((cost) => event.id.startsWith(`cost:${cost.cost_id}:`));
}

/** Client-side preview of payment_bridge.create's checks; Django still decides. */
export function payability(event: Obligation, costs: Cost[], beneficiaries: Beneficiary[], payments: Payment[]): Payability {
  if (event.settled_sequence !== undefined) return "SETTLED";
  if (payments.some((p) => p.event_id === event.id && !CLOSED.includes(p.status))) return "HAS_PAYMENT";
  if (!event.amount || Number(event.amount) <= 0 || !event.date) return "NO_AMOUNT";
  const cost = costFor(event, costs);
  if (!cost || cost.category !== "tuition" || !cost.invoice_id || !cost.issuer || cost.confidence_type !== "VERIFIED") return "INVOICE_REQUIRED";
  const beneficiary = beneficiaries.find((b) => b.id === event.beneficiary_id);
  if (!beneficiary) return "NO_BENEFICIARY";
  if (!beneficiary.verified) return "BENEFICIARY_UNVERIFIED";
  return "READY";
}

export function invoiceOf(event: Obligation, costs: Cost[]) {
  const cost = costFor(event, costs);
  return cost?.invoice_id ? { invoice_id: cost.invoice_id, issuer: cost.issuer ?? "" } : null;
}

export function paymentApproval(payment: Payment, approvals: PaymentApproval[]): PaymentApproval | null {
  return approvals.find((a) => a.action === "payment.submit" && a.target_id === payment.id) ?? null;
}

/** Audit rows for this payment: its own events plus step-up and approval events that name it. */
export function paymentAudit(payment: Payment, events: AuditEvent[], approvals: PaymentApproval[]): AuditEvent[] {
  const approvalIds = new Set(approvals.filter((a) => a.target_id === payment.id).map((a) => a.id));
  return events.filter((event) => event.entity_id === payment.id || approvalIds.has(event.entity_id)
    || event.details?.target_id === payment.id);
}
