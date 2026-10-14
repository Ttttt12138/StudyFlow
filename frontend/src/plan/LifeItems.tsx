import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useState } from "react";
import { useI18n, type Lang, type MessageKey } from "../i18n";
import { formatMoney } from "../backend/presenters";
import { usePolicyAction } from "../services/usePolicyAction";
import { useWorkspace } from "../workspace/context";
import type { LifeControl } from "./useStudyLife";
import type { LifeItem } from "./lifeTypes";
import { pick } from "./format";

const titleOf = (item: LifeItem, lang: Lang) => typeof item.title === "string" ? item.title : pick(item.title, lang);

/** Whether the money is there when the item falls due: the wallet once it exists, the plan forecast before. */
function MoneyCheck({ item, gapDate }: { item: LifeItem; gapDate: string | null }) {
  const { t, lang } = useI18n();
  if (item.done || item.amount === null) return null;
  if (item.paid_by_loan) return <p className="panel-muted">{t("life.loanCovers")}</p>;
  if (item.shortfall_basis === "wallet") return Number(item.shortfall) > 0
    ? <p className="life-warning">{t("life.short", { amount: formatMoney(item.shortfall, item.currency, lang) })}</p>
    : <p className="panel-muted">{t("life.covered")}</p>;
  if (item.shortfall_basis === "forecast" && item.at_risk) return <p className="life-warning">{t("life.atRisk", { date: gapDate ?? "" })}</p>;
  return null;
}

function Meta({ item }: { item: LifeItem }) {
  const { t } = useI18n();
  return <span className="life-item-meta">{item.due_date ? `${item.due_date} · ` : ""}
    {t(item.done ? "life.completed" : item.due_date ? `life.${item.stage}` as MessageKey : "life.unknown")}</span>;
}

/** One line in the list: title, amount, date and status, and whether the money is there. Opens the item's page. */
export function LifeItemRow({ item, gapDate, onSelect }: { item: LifeItem; gapDate: string | null; onSelect: (item: LifeItem) => void }) {
  const { t, lang } = useI18n();
  return <article className={`life-item is-${item.done ? "done" : item.stage}`} data-source={item.source_key}>
    <button type="button" className="life-item-main" onClick={() => onSelect(item)}>
      <span className="life-item-title">{item.unread && !item.done && <i className="life-bell-new" aria-label={t("life.new")} />}{titleOf(item, lang)}</span>
      {item.amount !== null && <strong className="life-item-amount">{formatMoney(item.amount, item.currency, lang)}</strong>}
      <CaretRight className="life-item-go" size={16} aria-hidden="true" />
      <Meta item={item} />
      <MoneyCheck item={item} gapDate={gapDate} />
    </button>
  </article>;
}

/** The item's own page: notes, the original notice and every action. */
export function LifeItemDetail({ item, control, preview, onOpen }: {
  item: LifeItem; control: LifeControl; preview: boolean; onOpen: (item: LifeItem) => void;
}) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const [mode, setMode] = useState<"snooze" | "reschedule" | "amount" | null>(null);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    try { await control.run("planning/life/actions/", { source_key: item.source_key, expected_token: item.token, action,
      ...(action === "snooze" || action === "reschedule" ? { date } : {}), ...extra }); setMode(null); } catch { /* shown by control */ }
  };
  const disabled = preview || control.busy;
  // The month's budget is only reported once the plan is ENROLLED, which is also when the wallet can pay.
  // The signed loan pays this bill to the school on its date, so the student has nothing to pay or change.
  const byLoan = item.kind === "bill" && !item.done && !!item.paid_by_loan;
  const canPay = item.kind === "bill" && !item.done && !byLoan && !!control.data?.budget;
  const editable = !item.done && !byLoan && (item.kind === "bill" || item.kind === "task");
  // Pay later: an unpaid bill in the credit line's currency can be paid from the line if enough of it is available.
  const credit = control.data?.credit;
  const canCredit = !!credit && item.kind === "bill" && !item.done && !byLoan && item.amount !== null && item.currency === credit.currency;
  const enoughCredit = canCredit && Number(credit.available) >= Number(item.amount);
  const payWithCredit = async () => {
    try { await control.run("planning/credit/pay/", { source_key: item.source_key, expected_token: item.token }); } catch { /* shown by control */ }
  };
  // Credit is paid back from the wallet after the password; that repayment is what counts toward the on-time record.
  const policy = usePolicyAction(control.client, preview);
  const [repaying, setRepaying] = useState(false), [repayError, setRepayError] = useState("");
  const repay = async () => {
    const id = item.source_key.split(":", 2)[1];
    setRepaying(true); setRepayError("");
    try {
      await policy.run({ action: "credit.repay", target_id: id, amount: item.amount ?? "0", currency: item.currency }, async token => {
        await control.client.post(`planning/credit/charges/${id}/repay/`, {}, `credit-repay:${id}`, token ? { "X-Step-Up-Token": token } : {});
        await control.refresh();
      });
    } catch (e) { setRepayError(e instanceof Error ? e.message : String(e)); }
    finally { setRepaying(false); }
  };
  return <div className={`life-detail is-${item.done ? "done" : item.stage}`} data-source={item.source_key}>
    <div className="life-detail-head">
      {item.amount !== null && <strong className="life-detail-amount">{formatMoney(item.amount, item.currency, lang)}</strong>}
      <Meta item={item} />
      <MoneyCheck item={item} gapDate={control.data?.funding.first_gap_date ?? null} />
    </div>
    {item.amount_confirmed && item.catalog_amount && <p className="panel-muted">{t("life.amountFrom", { amount: formatMoney(item.catalog_amount, item.currency, lang) })}</p>}
    {item.paid_by_loan && <p className="plan-visual-gap">{t(item.done ? "life.paidByLoan" : "life.loanWillPay", {
      amount: formatMoney(item.paid_by_loan, "THB", lang), date: item.due_date ?? "" })}</p>}
    {item.estimated && <p className="panel-muted">{t("life.estimate")}</p>}
    {item.template && !item.done && <p className="panel-muted">{t("life.template")}</p>}
    {item.snoozed && <p>{t("life.snoozed", { date: item.snoozed_until ?? "" })}</p>}
    {item.source_text && <blockquote className="life-source">{item.source_text}</blockquote>}
    <div className="life-actions">
      {!item.done && (item.kind === "enrollment" || item.kind === "loan") && <button className="primary" disabled={disabled}
        onClick={() => onOpen(item)}>{t(item.kind === "loan" ? "life.repay" : "life.enroll")}</button>}
      {canPay && <button className="primary" disabled={preview} onClick={() => workspace?.open({ kind: "wallet", section: "pay" })}>{t("life.payNow")}</button>}
      {canCredit && <button className="secondary" disabled={disabled || !enoughCredit} onClick={() => void payWithCredit()}>{t("life.creditPay")}</button>}
      {!item.done && item.kind === "credit" && <button className="primary" disabled={disabled || repaying || policy.pending}
        onClick={() => void repay()}>{t("life.repaid")}</button>}
      {!item.done && !byLoan && ["task", "bill"].includes(item.kind) && <button className="secondary" disabled={disabled}
        onClick={() => void act("complete")}>{t(item.kind === "bill" ? "life.paid" : "life.done")}</button>}
      {item.done && item.kind === "task" && <button className="secondary" disabled={disabled} onClick={() => void act("reopen")}>{t("life.reopen")}</button>}
      {!item.done && <>
        <button className="link-button" disabled={disabled} onClick={() => { setMode("snooze"); setDate(""); }}>{t("life.snooze")}</button>
        {item.kind !== "loan" && item.kind !== "credit" && !byLoan && <button className="link-button" disabled={disabled} onClick={() => { setMode("reschedule"); setDate(item.due_date ?? ""); }}>{t("life.reschedule")}</button>}
        {editable && <button className="link-button" disabled={disabled} onClick={() => { setMode("amount"); setAmount(item.amount ?? ""); }}>{t("life.setAmount")}</button>}
        {item.unread && <button className="link-button" disabled={disabled} onClick={() => void act("acknowledge")}>{t("life.ack")}</button>}
      </>}
    </div>
    {canCredit && <small className={enoughCredit ? "panel-muted" : "life-warning"}>{t(enoughCredit ? "life.creditHint" : "life.creditShort",
      { available: formatMoney(credit.available, credit.currency, lang), days: credit.term_days })}</small>}
    {item.kind === "credit" && !item.done && <small className="panel-muted">{t("life.creditRepayHint")}</small>}
    {repayError && <p role="alert">{repayError}</p>}
    {policy.panel}
    {item.kind === "bill" && !item.done && !byLoan && <small className="panel-muted">{t("life.paidHint")}</small>}
    {mode === "amount" ? <form className="life-form" onSubmit={e => { e.preventDefault(); void act("set_amount", { amount: Number(amount).toFixed(2) }); }}>
      <label>{t("life.amountActual")} ({item.currency})<input required inputMode="decimal" value={amount}
        onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} /></label>
      <button className="primary" disabled={disabled || amount === "" || Number.isNaN(Number(amount))}>{t("life.save")}</button>
      {item.amount_confirmed && <button type="button" className="secondary" disabled={disabled}
        onClick={() => void act("set_amount", { amount: null })}>{t("life.amountReset")}</button>}
      <button type="button" className="secondary" onClick={() => setMode(null)}>{t("life.cancel")}</button></form>
    : mode && <form className="life-form" onSubmit={e => { e.preventDefault(); void act(mode); }}>
      <label>{t(mode === "snooze" ? "life.snooze" : "life.reschedule")}<input required type="date" value={date}
        onChange={e => setDate(e.target.value)} /></label>
      <button className="primary" disabled={disabled}>{t("life.save")}</button>
      <button type="button" className="secondary" onClick={() => setMode(null)}>{t("life.cancel")}</button></form>}
  </div>;
}

export { titleOf };
