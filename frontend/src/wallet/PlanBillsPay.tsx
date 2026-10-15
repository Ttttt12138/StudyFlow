import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "../backend/presenters";
import { useI18n, type MessageKey } from "../i18n";
import { pick } from "../plan/format";
import type { SchoolPayee } from "../plan/assessmentTypes";
import { usePolicyAction } from "../services/usePolicyAction";
import { useToolRefresh, useWorkspace } from "../workspace/context";
import { PanelAlert, PanelEmpty, PanelSkeleton } from "../workspace/ToolPanel";
import { TopUpForm } from "./TopUpForm";
import { billItems, byDueDate, payTabSections, sumByCurrency, type BillItem, type LoanState, type PlanBillRow } from "./billGroups";
import { SessionWalletClient, type WalletBalances, type WalletClient } from "./client";

/** What a bill still needs, handed to the exchange view. */
export type ExchangeWant = { currency: string; short: string; name: string };

const LOAN_STATE: Record<LoanState, MessageKey> = {
  scheduled: "billpay.loanScheduled", paid: "billpay.loanPaid",
  awaitingApproval: "billpay.loanAwaiting", awaitingSigning: "billpay.loanAwaitingSigning",
};

/**
 * The wallet's pay tab. Each plan bill appears once: under "you pay" while the family still owes part of it (the
 * loan's share noted on the same row), otherwise under the loan's direct payments to the school, folded into one
 * line until opened. Paid bills live in the records. Payments need a password step-up; tuition waits while the
 * school's account is not verified.
 */
export function PlanBillsPay({ preview, mode = "pay", onExchange, onRecords }: { preview: boolean;
  /** Opens the wallet's exchange for a bill the balance does not cover. */
  onExchange?: (want: ExchangeWant) => void;
  /** Opens the wallet's bill payment records. */
  onRecords?: () => void;
  /** "history" lists only what was paid (from the wallet or by the loan), for the wallet's records. */
  mode?: "pay" | "history" }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const client = useMemo<WalletClient>(() => new SessionWalletClient(), []);
  const policy = usePolicyAction(client, preview);
  const [rows, setRows] = useState<PlanBillRow[] | null>(null);
  const [payee, setPayee] = useState<SchoolPayee | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [topUp, setTopUp] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (preview) { setRows([]); return; }
    const [listed, money] = await Promise.all([client.get<{ bills: PlanBillRow[]; school_payee?: SchoolPayee | null }>("planning/wallet-bills/"),
      client.get<WalletBalances>("demo/wallets/balances/").catch(() => null)]);
    setRows(listed.bills); setPayee(listed.school_payee ?? null); setBalances(money);
  }, [client, preview]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [load]);
  const stale = useToolRefresh(load);
  const items = useMemo(() => billItems(rows ?? []), [rows]);
  const label = (item: BillItem) => typeof item.label === "string" ? item.label : pick(item.label, lang);
  const money = (amount: number | string, currency: string) => formatMoney(typeof amount === "number" ? amount.toFixed(2) : amount, currency, lang);
  const totals = (list: { amount: number; currency: string }[]) => sumByCurrency(list).map(x => money(x.amount, x.currency)).join(" + ");
  const balance = (currency: string) => Number(balances?.balances.find(b => b.currency === currency)?.available_balance ?? 0);

  async function pay(item: BillItem, row: PlanBillRow) {
    setBusy(row.id); setError(""); setNotice("");
    try {
      await policy.run({ action: "bill.pay", target_id: row.id, amount: row.amount, currency: row.currency }, async token => {
        await client.post(`planning/bills/${row.id}/pay-from-wallet/`, {}, `bill-wallet-pay:${row.id}`,
          token ? { "X-Step-Up-Token": token } : {});
        setNotice(t("billpay.done", { name: label(item), amount: money(row.amount, row.currency) }));
        await load();
      });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }

  if (rows === null) return error ? <PanelAlert message={error} onRetry={() => void load().catch(e => setError(String(e)))} /> : <PanelSkeleton />;
  const { toPay, byLoan, done } = payTabSections(items);

  if (mode === "history") {
    const paid = [...done].reverse();
    return <section className="plan-bills-pay panel-body" aria-label={t("billpay.records")} tabIndex={0}>
      {stale}
      <div className="panel-card-head"><h2>{t("billpay.records")}</h2><span className="panel-tag">{t("plan.simulated")}</span></div>
      {error && <PanelAlert message={error} />}
      {paid.length === 0 ? <PanelEmpty title={t("billpay.noRecords")} /> : <ul className="bill-rows">{paid.map(item =>
        <li key={item.key}><span className="bill-name"><strong>{label(item)}</strong>
          <small>{item.due_date} · {t(item.loan && item.own ? "billpay.paidSplit" : item.loan ? "billpay.loanPaid" : "billpay.paidByWallet")}</small></span>
          <span className="bill-amount">{money(item.total, item.currency)}</span></li>)}</ul>}
    </section>;
  }

  const pending = byLoan.concat(toPay).find(item => item.loan?.state.startsWith("awaiting"))?.loan?.state;
  const owed = toPay.map(item => ({ amount: item.own!.amount, currency: item.currency }));
  const loanOwed = byLoan.map(item => ({ amount: item.loan!.amount, currency: item.currency }));
  const held = (item: BillItem) => item.kind === "tuition" && payee?.verified === false;
  const currencies = [...new Set(toPay.map(item => item.currency))];
  // Money the wallet is short of for everything listed, per currency (the warning above the list).
  const short = sumByCurrency(owed).map(x => ({ ...x, amount: x.amount - balance(x.currency) })).filter(x => x.amount > 0);

  return <section className="plan-bills-pay panel-body" aria-label={t("billpay.title")} tabIndex={0}>
    {stale}
    <div className="panel-card-head"><h2>{t("billpay.title")}</h2><span className="panel-tag">{t("plan.simulated")}</span></div>
    {error && <PanelAlert message={error} />}
    {notice && <p className="plan-visual-gap" role="status">{notice}</p>}
    {payee?.verified === false && <p className="life-warning" role="alert">{t("billpay.payeeUnverified")}</p>}
    {pending && <div className="panel-note plan-bills-loan-notice" role="status">
      <p>{t(pending === "awaitingSigning" ? "billpay.loanPendingSigning" : "billpay.loanPendingApproval")}</p>
      <button type="button" className="primary" disabled={preview || !!busy || policy.pending}
        onClick={() => workspace?.open({ kind: "funding" })}>{t("billpay.loanContinue")}</button></div>}

    {items.length === 0 ? <PanelEmpty title={t("billpay.none")} text={t("billpay.noneHint")} /> : <>
      <dl className="bill-summary">
        <div><dt>{t("billpay.sum.own")}</dt><dd>{owed.length ? totals(owed) : "—"}</dd><small>{t("billpay.count", { n: toPay.length })}</small></div>
        <div><dt>{t("billpay.sum.loan")}</dt><dd>{loanOwed.length ? totals(loanOwed) : "—"}</dd><small>{t("billpay.count", { n: byLoan.length })}</small></div>
        <div><dt>{t("billpay.sum.done")}</dt><dd>{t("billpay.count", { n: done.length })}</dd>
          {onRecords && done.length > 0 && <button type="button" className="link-button" onClick={onRecords}>{t("billpay.viewRecords")}</button>}</div>
      </dl>

      <section className="bill-section" aria-label={t("billpay.toPay")}>
        <div className="bill-section-head"><h3>{t("billpay.toPay")}</h3>
          {currencies.length > 0 && <small>{t("billpay.walletAvailable", { amount: currencies.map(c => money(balance(c), c)).join(" · ") })}</small>}</div>
        {short.length > 0 && <p className="life-warning">{t("billpay.shortTotal", { amount: totals(short) })}</p>}
        {toPay.length === 0 ? <p className="panel-muted">{t(byLoan.length ? "billpay.noWalletDue" : "billpay.allPaid")}</p>
          : byDueDate(toPay).map(([date, list]) => <div key={date} className="bill-date-group">
            <h4>{t("billpay.dueOn", { date })}</h4>
            <ul className="bill-rows">{list.map(item => {
              const own = item.own!, row = own.row;
              const lacking = !!row && balance(item.currency) < own.amount;
              return <li key={item.key}>
                <span className="bill-name"><strong>{label(item)}</strong>
                  {item.loan && <small>{t("billpay.split", { total: money(item.total, item.currency), loan: money(item.loan.amount, item.currency) })}</small>}</span>
                <span className="bill-amount">{money(own.amount, item.currency)}</span>
                <span className="bill-action">{!row ? <small className="panel-muted">{t("billpay.afterSigning")}</small>
                  : held(item) ? <button type="button" className="secondary" disabled>{t("billpay.waitPayee")}</button>
                  : lacking ? <>
                    <button type="button" className="secondary" disabled={preview} aria-expanded={topUp === row.id}
                      onClick={() => setTopUp(topUp === row.id ? null : row.id)}>{t("topup.title")}</button>
                    <button type="button" className="secondary" onClick={() => onExchange
                      ? onExchange({ currency: item.currency, name: label(item), short: (own.amount - balance(item.currency)).toFixed(2) })
                      : workspace?.open({ kind: "wallet", section: "convert" })}>{t("billpay.topUp")}</button></>
                  : <button type="button" className="primary" disabled={preview || !!busy || policy.pending} onClick={() => void pay(item, row)}>
                    {busy === row.id ? t("billpay.paying") : t("billpay.pay")}</button>}</span>
                {row && lacking && topUp === row.id && <div className="plan-bills-topup">
                  <TopUpForm client={client} preview={preview} currencies={[item.currency]} currency={item.currency}
                    amount={(own.amount - balance(item.currency)).toFixed(2)} onCancel={() => setTopUp(null)}
                    onDone={result => { setTopUp(null); setNotice(t("topup.doneBill", { amount: money(result.amount, result.currency), name: label(item) })); void load(); }} /></div>}
              </li>; })}</ul></div>)}
      </section>

      {byLoan.length > 0 && <details className="bill-section bill-loan">
        <summary><span><strong>{t("billpay.loanSection")}</strong>
          <small>{t("billpay.loanSummary", { n: byLoan.length, amount: totals(loanOwed), date: byLoan[0].due_date })}
            {" · "}{t(LOAN_STATE[byLoan[0].loan!.state])}</small></span></summary>
        {payee && <p className="panel-muted">{t("billpay.payee", { name: payee.name, account: payee.account })}</p>}
        {byDueDate(byLoan).map(([date, list]) => <div key={date} className="bill-date-group">
          <h4>{t("billpay.dueOn", { date })}</h4>
          <ul className="bill-rows is-quiet">{list.map(item => <li key={item.key}>
            <span className="bill-name"><strong>{label(item)}</strong></span>
            <span className="bill-amount">{money(item.loan!.amount, item.currency)}</span></li>)}</ul></div>)}
      </details>}
    </>}
    {policy.panel}
  </section>;
}
