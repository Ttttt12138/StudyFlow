import { getLang, translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { Briefing, CheckJob, InsightsSnapshot, Page, ReadinessState, RecurringExpense, RiskCard, Transaction, TransactionImport } from "./types";

export function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : translate(getLang(), "common.err.section");
}

/** Newest page of a list route (ReadView paginates; some readiness routes return plain arrays). */
export async function newest<T>(client: WalletClient, path: string): Promise<T[]> {
  const page = await client.get<Page<T> | T[]>(path);
  return Array.isArray(page) ? page : page.results;
}

/** Reads are independent, as in loadPayments: a failing risk list does not hide the import review. */
export async function loadInsights(client: WalletClient): Promise<InsightsSnapshot> {
  const [state, wallets, imports, recurring, risks, checks, briefing] = await Promise.allSettled([
    client.get<ReadinessState>("readiness/state/"),
    newest<{ clock: string }>(client, "demo/wallets/"),
    newest<TransactionImport>(client, "readiness/transaction-imports/"),
    newest<RecurringExpense>(client, "readiness/recurring-expenses/"),
    newest<RiskCard>(client, "readiness/risks/"),
    newest<CheckJob>(client, "readiness/checks/"),
    client.get<Briefing>("readiness/briefing/"),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>, fallback: T) => result.status === "fulfilled" ? result.value : fallback;
  const failed = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? errorText(result.reason) : undefined;
  const errors = Object.fromEntries(Object.entries({
    state: failed(state), imports: failed(imports), recurring: failed(recurring), risks: failed(risks), checks: failed(checks), briefing: failed(briefing),
  }).filter(([, text]) => text)) as InsightsSnapshot["errors"];
  const stateValue = value(state, null), briefingValue = value(briefing, null);
  // Django's business date is the demo wallet clock; the briefing and state carry it too.
  const clock = value(wallets, [])[0]?.clock ?? briefingValue?.as_of ?? stateValue?.assets.balance_as_of ?? null;
  return {
    state: stateValue, clock, imports: value(imports, []), recurring: value(recurring, []).filter((item) => item.active),
    risks: value(risks, []), checks: value(checks, []), briefing: briefingValue, errors,
  };
}

export function transactionsPath(category: string) {
  return `readiness/transactions/${category ? `?category=${encodeURIComponent(category)}` : ""}`;
}

export function loadTransactions(client: WalletClient, path: string) {
  return client.get<Page<Transaction>>(path);
}

export async function sha256(file: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}
