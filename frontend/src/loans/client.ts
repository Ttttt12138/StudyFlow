import { getAll } from "../backend/client";
import { getLang, translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { AffordabilityProfile, DemoWallet, Disbursement, LoanAccount, LoanApplication, LoanQuote, LoansSnapshot } from "./types";

function errorText(error: unknown) {
  return error instanceof WalletApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : translate(getLang(), "common.err.section");
}

/** Reads are independent, as in loadPayments: a failing disbursement list does not hide the loan accounts. */
export async function loadLoans(client: WalletClient): Promise<LoansSnapshot> {
  const [applications, quotes, profile, accounts, disbursements, wallets] = await Promise.allSettled([
    getAll<LoanApplication>(client, "applications/"),
    getAll<LoanQuote>(client, "loans/"),
    client.get<AffordabilityProfile>("affordability-profile/"),
    getAll<LoanAccount>(client, "loan-accounts/"),
    getAll<Disbursement>(client, "disbursements/"),
    getAll<DemoWallet>(client, "demo/wallets/"),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>, fallback: T) => result.status === "fulfilled" ? result.value : fallback;
  const failed = (result: PromiseSettledResult<unknown>) => result.status === "rejected" ? errorText(result.reason) : undefined;
  const errors = Object.fromEntries(Object.entries({
    applications: failed(applications), quotes: failed(quotes), profile: failed(profile), accounts: failed(accounts),
    disbursements: failed(disbursements), wallet: failed(wallets),
  }).filter(([, text]) => text)) as LoansSnapshot["errors"];
  return {
    applications: value(applications, []),
    quotes: value(quotes, []),
    profile: value(profile, null),
    accounts: value(accounts, []),
    disbursements: value(disbursements, []),
    wallet: value(wallets, [])[0] ?? null,
    errors,
  };
}
