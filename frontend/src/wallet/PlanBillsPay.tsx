import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "../backend/presenters";
import { useI18n } from "../i18n";
import { pick } from "../plan/format";
import type { Text } from "../plan/types";
import { usePolicyAction } from "../services/usePolicyAction";
import { useToolRefresh, useWorkspace } from "../workspace/context";
import { PanelAlert, PanelEmpty, PanelSkeleton } from "../workspace/ToolPanel";
import { TopUpForm } from "./TopUpForm";
import { SessionWalletClient, type WalletBalances, type WalletClient } from "./client";

/** What a bill still needs, handed to the exchange view. */
export type ExchangeWant = { currency: string; short: string; name: string };

type PlanBillRow = { id: string; kind: string; label: Text | string; due_date: string; amount: string; currency: string;
  status: "DUE" | "PAID"; paid_at: string | null; paid_by_loan: boolean };

/**
 * The wallet's pay tab: the study plan's bills (tuition, housing, insurance, visa), paid from the demo wallet in the
 * bill's currency after a password step-up. Bills the signed loan pays to the school are shown but not paid again.
 */
export function PlanBillsPay({ preview, mode = "pay", onExchange }: { preview: boolean;
  /** Opens the wallet's exchange for a bill the balance does not cover. */
  onExchange?: (want: ExchangeWant) => void;
  /** "history" lists only what was paid (from the wallet or by the loan), for the wallet's records. */
  mode?: "pay" | "history" }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const client = useMemo<WalletClient>(() => new SessionWalletClient(), []);
  const policy = usePolicyAction(client, preview);
  const [bills, setBills] = useState<PlanBillRow[] | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [topUp, setTopUp] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (preview) { setBills([]); return; }
    const [rows, money] = await Promise.all([client.get<{ bills: PlanBillRow[] }>("planning/wallet-bills/"),
      client.get<WalletBalances>("demo/wallets/balances/").catch(() => null)]);
    setBills(rows.bills); setBalances(money);
  }, [client, preview]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [load]);
  const stale = useToolRefresh(load);
  const label = (row: PlanBillRow) => typeof row.label === "string" ? row.label : pick(row.label, lang);
  const missing = (row: PlanBillRow) => Math.max(0, Number(row.amount) - Number(balance(row.currency))).toFixed(2);
  const balance = (currency: string) => balances?.balances.find(b => b.currency === currency)?.available_balance ?? "0";
  async function pay(row: PlanBillRow) {
    setBusy(row.id); setError(""); setNotice("");
    try {
      const ran = await policy.run({ action: "bill.pay", target_id: row.id, amount: row.amount, currency: row.currency }, async token => {
        await client.post(`planning/bills/${row.id}/pay-from-wallet/`, {}, `bill-wallet-pay:${row.id}`,
          token ? { "X-Step-Up-Token": token } : {});
        setNotice(t("billpay.done", { name: label(row), amount: formatMoney(row.amount, row.currency, lang) }));
        await load();
      });
      if (!ran) return;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  if (bills === null) return error ? <PanelAlert message={error} onRetry={() => void load().catch(e => setError(String(e)))} /> : <PanelSkeleton />;
  const history = mode === "history";
  const due = history ? [] : bills.filter(b => b.status === "DUE" && !b.paid_by_loan);
  const loan = bills.filter(b => b.paid_by_loan && (!history || b.status === "PAID"));
  const paid = bills.filter(b => b.status === "PAID" && !b.paid_by_loan);
  return <section className="plan-bills-pay" aria-label={t("billpay.title")}>
    {stale}
    <div className="panel-card-head"><h2>{t(history ? "billpay.records" : "billpay.title")}</h2><span className="panel-tag">{t("plan.simulated")}</span></div>
    {!history && <p className="panel-muted">{t("billpay.text")}</p>}
    {error && <PanelAlert message={error} />}
    {notice && <p className="plan-visual-gap" role="status">{notice}</p>}
    {(history ? loan.length + paid.length === 0 : bills.length === 0)
      ? <PanelEmpty title={t(history ? "billpay.noRecords" : "billpay.none")} text={history ? undefined : t("billpay.noneHint")} /> : <>
      {!history && <h3 className="panel-section-title">{t("billpay.due", { n: due.length })}</h3>}
      {history ? null : due.length === 0 ? <p className="panel-muted">{t("billpay.allPaid")}</p> : <ul className="plan-bills-list">{due.map(row => {
        const short = Number(balance(row.currency)) < Number(row.amount);
        return <li key={row.id}>
          <span><strong>{label(row)}</strong><small>{t("billpay.dueOn", { date: row.due_date })}</small>
            <small className={short ? "life-warning" : "panel-muted"}>{t("billpay.balance", { amount: formatMoney(balance(row.currency), row.currency, lang) })}</small></span>
          <span className="plan-bills-amount">{formatMoney(row.amount, row.currency, lang)}</span>
          {short ? <span className="plan-bills-actions">
            <button type="button" className="primary" disabled={preview} aria-expanded={topUp === row.id}
              onClick={() => setTopUp(topUp === row.id ? null : row.id)}>{t("topup.title")}</button>
            <button type="button" className="secondary" onClick={() => onExchange ? onExchange({ currency: row.currency, name: label(row), short: missing(row) })
              : workspace?.open({ kind: "wallet", section: "convert" })}>{t("billpay.topUp")}</button></span>
            : <button type="button" className="primary" disabled={preview || !!busy || policy.pending} onClick={() => void pay(row)}>
              {busy === row.id ? t("billpay.paying") : t("billpay.pay")}</button>}
          {short && topUp === row.id && <div className="plan-bills-topup">
            <TopUpForm client={client} preview={preview} currencies={[row.currency]} currency={row.currency} amount={missing(row)}
              onCancel={() => setTopUp(null)}
              onDone={result => { setTopUp(null); setNotice(t("topup.doneBill", { amount: formatMoney(result.amount, result.currency, lang), name: label(row) })); void load(); }} /></div>}
        </li>; })}</ul>}
      {loan.length > 0 && <><h3 className="panel-section-title">{t("billpay.loan", { n: loan.length })}</h3>
        <ul className="plan-bills-list is-quiet">{loan.map(row => <li key={row.id}><span><strong>{label(row)}</strong>
          <small>{row.due_date} · {t(row.status === "PAID" ? "billpay.loanPaid" : "billpay.loanScheduled")}</small></span>
          <span className="plan-bills-amount">{formatMoney(row.amount, row.currency, lang)}</span></li>)}</ul></>}
      {paid.length > 0 && <><h3 className="panel-section-title">{t("billpay.paid", { n: paid.length })}</h3>
        <ul className="plan-bills-list is-quiet">{paid.map(row => <li key={row.id}><span><strong>{label(row)}</strong>
          <small>{row.due_date} · {t("billpay.paidTag")}</small></span>
          <span className="plan-bills-amount">{formatMoney(row.amount, row.currency, lang)}</span></li>)}</ul></>}
    </>}
    {policy.panel}
  </section>;
}
