import { getAll } from "../backend/client";
import { getLang, translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { AuditEvent, Beneficiary, FundingRun, LedgerEntry, Payment, PaymentApproval, PaymentsSnapshot, ReadinessState } from "./types";

function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : translate(getLang(), "common.err.section");
}

/** Reads are independent, as in loadWallet: a failing audit page does not hide the payments. */
export async function loadPayments(client: WalletClient): Promise<PaymentsSnapshot> {
  const [state, plans, beneficiaries, payments, approvals, ledger, audit] = await Promise.allSettled([
    client.get<ReadinessState>("readiness/state/"),
    getAll<FundingRun>(client, "readiness/funding-plans/"),
    getAll<Beneficiary>(client, "beneficiaries/"),
    getAll<Payment>(client, "payments/"),
    getAll<PaymentApproval>(client, "approvals/"),
    getAll<LedgerEntry>(client, "ledger/"),
    // Newest page only; older events stay in the trust center's full audit log.
    client.get<{ results: AuditEvent[] }>("audit/"),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>, fallback: T) => result.status === "fulfilled" ? result.value : fallback;
  const failed = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? errorText(result.reason) : undefined;
  const errors = Object.fromEntries(Object.entries({
    state: failed(state), plans: failed(plans), beneficiaries: failed(beneficiaries), payments: failed(payments),
    approvals: failed(approvals), ledger: failed(ledger), audit: failed(audit),
  }).filter(([, text]) => text)) as PaymentsSnapshot["errors"];
  return {
    state: value(state, null),
    plans: value(plans, []).filter((run) => run.kind === "funding"),
    beneficiaries: value(beneficiaries, []),
    payments: value(payments, []),
    approvals: value(approvals, []),
    ledger: value(ledger, []),
    audit: value(audit, { results: [] }).results,
    errors,
  };
}
