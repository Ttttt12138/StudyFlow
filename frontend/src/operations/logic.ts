import type { OpsOrder, OpsPayment } from "./types";

// Adapter outcomes the backend accepts from each status (execution_services.payment_event,
// remittance_orders.TRANSITIONS); offering only these keeps the buttons honest.
export type PaymentOutcome = "settled" | "failed" | "unknown";
export type OrderOutcome = "dispatched" | "delivered" | "failed" | "unknown";

export function paymentOutcomes(payment: Pick<OpsPayment, "status">): PaymentOutcome[] {
  if (payment.status === "pending") return ["settled", "failed", "unknown"];
  if (payment.status === "unknown") return ["settled", "failed"];
  return [];
}

export function orderOutcomes(order: Pick<OpsOrder, "status">): OrderOutcome[] {
  if (order.status === "SUBMITTED") return ["dispatched", "delivered", "failed", "unknown"];
  if (order.status === "IN_TRANSIT") return ["delivered", "failed", "unknown"];
  if (order.status === "UNKNOWN") return ["delivered", "failed"];
  return [];
}

/** Minutes left before an approval request expires (negative when already past). */
export function minutesLeft(expiresAt: string, now = Date.now()) {
  return Math.floor((Date.parse(expiresAt) - now) / 60_000);
}
