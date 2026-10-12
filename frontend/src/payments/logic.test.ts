import { describe, expect, it } from "vitest";
import { currentPlan, payability, paymentAudit, paymentStage, railState, MILESTONES } from "./logic";
import type { AuditEvent, Beneficiary, Cost, FundingRun, Obligation, Payment, PaymentStatus, ReadinessState } from "./types";

const versions = { state_version: 4, budget_version: 2, analysis_version: 1 };
const state = { ...versions, semester_id: "s1" } as ReadinessState;
const payee: Beneficiary = { id: "b1", name: "Uni", destination_label: "MOCK", verified: true };
const tuition: Cost = { cost_id: "tuition", category: "tuition", invoice_id: "INV-1", issuer: "Uni", confidence_type: "VERIFIED" };
const bill: Obligation = { id: "cost:tuition:2026-10-15", kind: "expense", amount: "48000.00", date: "2026-10-15", certainty: "confirmed", beneficiary_id: "b1" };

function payment(status: PaymentStatus, extra: Partial<Payment> = {}): Payment {
  return { id: "p1", created_at: "2026-10-11T00:00:00Z", plan: null, readiness_plan: "r1", beneficiary: "b1",
    event_id: bill.id, amount: "48000.00", due_on: "2026-10-15", status, authorized_until: null, submitted_at: null,
    receipt: null, invoice_snapshot: {}, is_simulated: true, ...extra };
}

describe("paymentStage", () => {
  const now = Date.parse("2026-10-11T00:00:00Z");
  it("maps each backend status to the next student step", () => {
    expect(paymentStage(payment("draft"), now)).toBe("authorize");
    expect(paymentStage(payment("pending"), now)).toBe("awaiting_adapter");
    expect(paymentStage(payment("settled"), now)).toBe("reconcile");
    expect(paymentStage(payment("reconciliation_exception"), now)).toBe("exception");
    expect(paymentStage(payment("reconciled"), now)).toBe("done");
    expect(paymentStage(payment("expired"), now)).toBe("cancelled");
  });
  it("treats an authorization past its deadline as expired, as submit() would", () => {
    expect(paymentStage(payment("authorized", { authorized_until: "2026-10-11T00:15:00Z" }), now)).toBe("submit");
    expect(paymentStage(payment("authorized", { authorized_until: "2026-10-10T23:59:00Z" }), now)).toBe("authorization_expired");
    expect(paymentStage(payment("authorized"), now)).toBe("authorization_expired");
  });
});

describe("railState", () => {
  const rail = (p: Payment) => MILESTONES.map((_, n) => railState(p, n));
  it("marks reached milestones done and the next one current", () => {
    expect(rail(payment("draft"))).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(rail(payment("pending"))).toEqual(["done", "done", "done", "current", "todo"]);
    expect(rail(payment("reconciled"))).toEqual(["done", "done", "done", "done", "done"]);
  });
  it("stops where a closed or mismatched payment ended", () => {
    expect(rail(payment("failed", { submitted_at: "2026-10-11T00:01:00Z" }))).toEqual(["done", "done", "done", "stopped", "todo"]);
    expect(rail(payment("cancelled"))).toEqual(["done", "stopped", "todo", "todo", "todo"]);
    expect(rail(payment("reconciliation_exception"))).toEqual(["done", "done", "done", "done", "stopped"]);
  });
});

describe("currentPlan", () => {
  const run = (id: string, created_at: string, extra: Partial<FundingRun> = {}): FundingRun =>
    ({ id, created_at, kind: "funding", ...versions, result: { validation: "VALID" }, ...extra });
  it("uses the newest run and requires matching versions and a valid result", () => {
    expect(currentPlan([], state)).toEqual({ plan: null, issue: "NONE" });
    const older = run("a", "2026-10-10T00:00:00Z"), newer = run("b", "2026-10-11T00:00:00Z");
    expect(currentPlan([older, newer], state)).toEqual({ plan: newer, issue: "" });
    expect(currentPlan([run("c", "2026-10-11T00:00:00Z", { budget_version: 1 })], state).issue).toBe("STALE");
    expect(currentPlan([run("d", "2026-10-11T00:00:00Z", { result: { validation: "INCOMPLETE" } })], state).issue).toBe("INVALID");
    expect(currentPlan([newer], null).issue).toBe("STALE");
  });
});

describe("payability", () => {
  it("is ready only for a verified tuition invoice with a verified payee and no active payment", () => {
    expect(payability(bill, [tuition], [payee], [])).toBe("READY");
    expect(payability(bill, [tuition], [payee], [payment("cancelled")])).toBe("READY");
    expect(payability(bill, [tuition], [payee], [payment("pending")])).toBe("HAS_PAYMENT");
    expect(payability({ ...bill, settled_sequence: 3 }, [tuition], [payee], [])).toBe("SETTLED");
    expect(payability({ ...bill, amount: null }, [tuition], [payee], [])).toBe("NO_AMOUNT");
    expect(payability(bill, [{ ...tuition, confidence_type: "USER_ENTERED" }], [payee], [])).toBe("INVOICE_REQUIRED");
    expect(payability({ ...bill, id: "cost:rent:2026-10-20" }, [tuition, { cost_id: "rent", category: "housing" }], [payee], [])).toBe("INVOICE_REQUIRED");
    expect(payability(bill, [tuition], [], [])).toBe("NO_BENEFICIARY");
    expect(payability(bill, [tuition], [{ ...payee, verified: false }], [])).toBe("BENEFICIARY_UNVERIFIED");
  });
  it("does not confuse cost ids that share a prefix", () => {
    expect(payability({ ...bill, id: "cost:tuition_extra:2026-10-15" }, [tuition], [payee], [])).toBe("INVOICE_REQUIRED");
  });
});

describe("paymentAudit", () => {
  const event = (id: string, action: string, entity_id: string, details: Record<string, unknown> = {}): AuditEvent =>
    ({ id, action, entity_id, details, created_at: "2026-10-11T00:00:00Z" });
  it("keeps the payment's own, step-up and approval events", () => {
    const rows = [event("1", "payment.created", "p1"), event("2", "auth.step_up_granted", "g1", { target_id: "p1" }),
      event("3", "approval.requested", "ap1"), event("4", "payment.created", "p2"), event("5", "approval.requested", "ap2")];
    const approvals = [{ id: "ap1", action: "payment.submit", target_id: "p1", amount: "1", currency: "THB", status: "PENDING", expires_at: "", version: 1 }];
    expect(paymentAudit(payment("pending"), rows, approvals).map((row) => row.id)).toEqual(["1", "2", "3"]);
  });
});
