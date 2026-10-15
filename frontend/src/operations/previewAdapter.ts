import { WalletApiError, type WalletClient } from "../wallet/client";
import { previewWorkbench } from "./previewWorkbench";
import type { OpsOrder, OpsPayment, OpsQueue } from "./types";

// Fixed synthetic queue for the read-only preview; no Django request is made.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student = { owner: 41, owner_username: "demo-student" };
const later = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

const tuition: OpsPayment = {
  ...student, id: id(1), event_id: "cost:tuition:2026-10-15", amount: "65000.00", currency: "THB", status: "authorized",
  due_on: "2026-10-15", submitted_at: null, beneficiary_name: "Synthetic University", beneficiary_verified: true,
  invoice_snapshot: { invoice_id: "DEMO-2026-1", issuer: "Synthetic University" }, payee_verified_by: 7,
};
const transfer: OpsOrder = {
  ...student, id: id(2), version: 1, status: "CREATED", effective_status: "CREATED", recipient: "BENEFICIARY",
  beneficiary_name: "Demo Condo", purpose: "living", send_amount: "15000.00", send_currency: "CNY",
  receive_amount: "73500.00", receive_currency: "THB", submitted_at: null, expected_latest: "2026-10-14", deadline: null,
  payee_verified_by: 8,
};

const queue: OpsQueue = {
  operator: { id: 8, username: "demo-approver" },
  approvals: [
    { ...student, id: id(10), action: "payment.submit", target_id: tuition.id, amount: "65000.00", currency: "THB",
      reason: "Semester tuition payment", status: "PENDING", version: 1, created_at: "2026-10-11T02:00:00Z", expires_at: later(23),
      decided_at: null, decision_note: "", requested_by_username: "demo-student", decided_by_username: null,
      can_decide: true, blocked_reason: null, target: { ...tuition, kind: "payment" } },
    { ...student, id: id(11), action: "remittance.submit", target_id: transfer.id, amount: "15000.00", currency: "CNY",
      reason: "Monthly living costs", status: "PENDING", version: 1, created_at: "2026-10-11T02:30:00Z", expires_at: later(2),
      decided_at: null, decision_note: "", requested_by_username: "demo-student", decided_by_username: null,
      can_decide: false, blocked_reason: "VERIFIED_PAYEE", target: { ...transfer, kind: "remittance_order" } },
  ],
  recent_decisions: [
    { ...student, id: id(12), action: "payment.submit", target_id: id(3), amount: "52000.00", currency: "THB",
      reason: "Deposit", status: "USED", version: 3, created_at: "2026-10-09T02:00:00Z", expires_at: "2026-10-10T02:00:00Z",
      decided_at: "2026-10-09T03:00:00Z", decision_note: "Invoice checked", requested_by_username: "demo-student",
      decided_by_username: "demo-approver", can_decide: false, blocked_reason: null, target: null },
    { ...student, id: id(13), action: "remittance.submit", target_id: id(4), amount: "30000.00", currency: "CNY",
      reason: "Rent", status: "REJECTED", version: 2, created_at: "2026-10-08T02:00:00Z", expires_at: "2026-10-09T02:00:00Z",
      decided_at: "2026-10-08T05:00:00Z", decision_note: "Payee name does not match the lease", requested_by_username: "demo-student",
      decided_by_username: "demo-approver", can_decide: false, blocked_reason: null, target: null },
  ],
  payments: [
    { ...tuition, id: id(5), event_id: "cost:tuition:2026-08-15", amount: "48000.00", status: "pending", submitted_at: "2026-10-11T01:00:00Z" },
    { ...student, owner: 42, owner_username: "uat-student", id: id(6), event_id: "rent", amount: "9000.00", currency: "THB", status: "unknown",
      due_on: "2026-10-20", submitted_at: "2026-10-10T09:00:00Z", beneficiary_name: "Demo Condo", beneficiary_verified: true, invoice_snapshot: {} },
  ],
  remittance_orders: [{ ...transfer, id: id(7), version: 3, status: "IN_TRANSIT", effective_status: "IN_TRANSIT", recipient: "SELF",
    beneficiary_name: null, purpose: "tuition", submitted_at: "2026-10-11T00:30:00Z" }],
  beneficiaries: [{ ...student, id: id(8), name: "New landlord", destination_label: "MOCK-ONLY", verified: false, created_at: "2026-10-11T01:30:00Z" }],
  applications: [
    { ...student, id: id(20), version: 2, status: "UNDER_REVIEW", created_at: "2026-10-10T03:00:00Z", decision_reason: "",
      assessment: { status: "INSUFFICIENT_DATA", missing_inputs: ["2027-03 income"] },
      quote: { currency: "THB", principal: "20000.00", net_proceeds: "18400.00", fees: "1600.00", total_repayment: "21324.00",
        maximum_installment: "1777.00", affordability_status: "INSUFFICIENT_DATA", months: 12, annual_rate: "0.08" } },
    { ...student, owner: 42, owner_username: "uat-student", id: id(21), version: 2, status: "APPROVED", created_at: "2026-10-09T03:00:00Z", decision_reason: "",
      assessment: { status: "AFFORDABLE" },
      quote: { currency: "THB", principal: "10000.00", net_proceeds: "10000.00", fees: "0.00", total_repayment: "10345.00",
        maximum_installment: "1725.00", affordability_status: "AFFORDABLE", months: 6, annual_rate: "0.12" } },
  ],
  is_simulated: true,
};

export function createOperationsPreview(): WalletClient {
  return {
    async get<T>(path: string): Promise<T> {
      if (path === "operations/queue/") return queue as T;
      const url = new URL(path, "https://preview.invalid/");
      if (url.pathname === "/operations/workbench/") return previewWorkbench(queue, url.searchParams) as T;
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}
