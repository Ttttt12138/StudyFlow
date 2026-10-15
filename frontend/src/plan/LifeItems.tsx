import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useState } from "react";
import { useI18n, type Lang, type MessageKey } from "../i18n";
import { formatMoney } from "../backend/presenters";
import { useWorkspace } from "../workspace/context";
import type { LifeControl } from "./useStudyLife";
import type { LifeItem } from "./lifeTypes";
import { pick } from "./format";

const titleOf = (item: LifeItem, lang: Lang) => typeof item.title === "string" ? item.title : pick(item.title, lang);

/** The share a submitted loan will pay, and what is left for the family (0 when the loan covers it all). */
export function pendingShare(item: LifeItem) {
  if (!item.loan_pending || item.amount === null) return null;
  const loan = Math.min(Number(item.loan_pending.amount), Number(item.amount));
  return { loan, own: Number(item.amount) - loan };
}

/** What the family itself pays for this item: nothing when the loan pays it, the rest of a pending loan's share. */
export function ownAmount(item: LifeItem) {
  if (item.amount === null || item.paid_by_loan) return 0;
  return pendingShare(item)?.own ?? Number(item.amount);
}

/** Whether the money is there when the item falls due: the loan's share first, then the wallet for the rest. */
function MoneyCheck({ item }: { item: LifeItem }) {
  const { t, lang } = useI18n();
  if (item.done || item.amount === null) return null;
  if (item.paid_by_loan) return <p className="panel-muted">{t("life.loanCovers")}</p>;
  const pending = pendingShare(item);
  const short = item.shortfall_basis === "wallet" && Number(item.shortfall) > 0
    ? <p className="life-warning">{t("life.short", { amount: formatMoney(item.shortfall, item.currency, lang) })}</p> : null;
  if (pending) return <>{<p className="panel-muted">{pending.own > 0
    ? t("life.loanPendingPart", { loan: formatMoney(pending.loan.toFixed(2), item.currency, lang), own: formatMoney(pending.own.toFixed(2), item.currency, lang) })
    : t("life.loanPending")}</p>}{short}</>;
  if (item.shortfall_basis === "wallet") return short ?? <p className="panel-muted">{t("life.covered")}</p>;
  return null;
}

function Meta({ item }: { item: LifeItem }) {
  const { t } = useI18n();
  return <span className="life-item-meta">{item.due_date ? `${item.due_date} · ` : ""}
    {t(item.done ? "life.completed" : item.due_date ? `life.${item.stage}` as MessageKey : "life.unknown")}</span>;
}

/** One line in the list: title, amount, date and status, and whether the money is there. Opens the item's page. */
export function LifeItemRow({ item, onSelect }: { item: LifeItem; onSelect: (item: LifeItem) => void }) {
  const { t, lang } = useI18n();
  return <article className={`life-item is-${item.done ? "done" : item.stage}`} data-source={item.source_key}>
    <button type="button" className="life-item-main" onClick={() => onSelect(item)}>
      <span className="life-item-title">{item.unread && !item.done && <i className="life-bell-new" aria-label={t("life.new")} />}{titleOf(item, lang)}</span>
      {item.amount !== null && <strong className="life-item-amount">{formatMoney(item.amount, item.currency, lang)}</strong>}
      <CaretRight className="life-item-go" size={16} aria-hidden="true" />
      <Meta item={item} />
      <MoneyCheck item={item} />
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
  // The loan pays this bill (or, awaiting approval and signing, has its share set aside), so the student has
  // nothing to pay or change by hand; what a pending loan leaves can be paid once it is signed.
  const byLoan = item.kind === "bill" && !item.done && (!!item.paid_by_loan || !!item.loan_pending);
  const canPay = item.kind === "bill" && !item.done && !byLoan ;
  const editable = !item.done && !byLoan && (item.kind === "bill" || item.kind === "task");
  return <div className={`life-detail is-${item.done ? "done" : item.stage}`} data-source={item.source_key}>
    <div className="life-detail-head">
      {item.amount !== null && <strong className="life-detail-amount">{formatMoney(item.amount, item.currency, lang)}</strong>}
      <Meta item={item} />
      <MoneyCheck item={item} />
    </div>
    {item.amount_confirmed && item.catalog_amount && <p className="panel-muted">{t("life.amountFrom", { amount: formatMoney(item.catalog_amount, item.currency, lang) })}</p>}
    {item.paid_by_loan && <p className="plan-visual-gap">{t(item.done ? "life.paidByLoan" : "life.loanWillPay", {
      amount: formatMoney(item.paid_by_loan, "THB", lang), date: item.due_date ?? "" })}</p>}
    {item.estimated && <p className="panel-muted">{t("life.estimate")}</p>}
    {item.template && !item.done && <p className="panel-muted">{t("life.template")}</p>}
    {item.snoozed && <p>{t("life.snoozed", { date: item.snoozed_until ?? "" })}</p>}
    {item.source_text && <blockquote className="life-source">{item.source_text}</blockquote>}
    <div className="life-actions">
      {!item.done && item.kind === "loan" && <button className="primary" disabled={disabled}
        onClick={() => onOpen(item)}>{t("life.repay")}</button>}
      {canPay && <button className="primary" disabled={preview} onClick={() => workspace?.open({ kind: "wallet", section: "pay" })}>{t("life.payNow")}</button>}
      {!item.done && !byLoan && ["task", "bill"].includes(item.kind) && <button className="secondary" disabled={disabled}
        onClick={() => void act("complete")}>{t(item.kind === "bill" ? "life.paid" : "life.done")}</button>}
      {item.done && !item.auto && item.kind === "task" && <button className="secondary" disabled={disabled} onClick={() => void act("reopen")}>{t("life.reopen")}</button>}
      {!item.done && <>
        <button className="link-button" disabled={disabled} onClick={() => { setMode("snooze"); setDate(""); }}>{t("life.snooze")}</button>
        {item.kind !== "loan" && !byLoan && <button className="link-button" disabled={disabled} onClick={() => { setMode("reschedule"); setDate(item.due_date ?? ""); }}>{t("life.reschedule")}</button>}
        {editable && <button className="link-button" disabled={disabled} onClick={() => { setMode("amount"); setAmount(item.amount ?? ""); }}>{t("life.setAmount")}</button>}
        {item.unread && <button className="link-button" disabled={disabled} onClick={() => void act("acknowledge")}>{t("life.ack")}</button>}
      </>}
    </div>
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
