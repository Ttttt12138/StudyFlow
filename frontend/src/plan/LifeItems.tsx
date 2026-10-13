import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { formatMoney } from "../backend/presenters";
import { useWorkspace } from "../workspace/context";
import type { LifeControl } from "./useStudyLife";
import type { LifeItem } from "./lifeTypes";
import { pick } from "./format";

/** Whether the money is there when the item falls due: the wallet once it exists, the plan forecast before. */
function MoneyCheck({ item, gapDate }: { item: LifeItem; gapDate: string | null }) {
  const { t, lang } = useI18n();
  if (item.done || item.amount === null) return null;
  if (item.shortfall_basis === "wallet") return Number(item.shortfall) > 0
    ? <p className="life-warning">{t("life.short", { amount: formatMoney(item.shortfall, item.currency, lang) })}</p>
    : <p className="panel-muted">{t("life.covered")}</p>;
  if (item.shortfall_basis === "forecast" && item.at_risk) return <p className="life-warning">{t("life.atRisk", { date: gapDate ?? "" })}</p>;
  return null;
}

export function LifeItemCard({ item, control, preview, onOpen }: {
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
  const canPay = item.kind === "bill" && !item.done && !!control.data?.budget;
  const editable = !item.done && (item.kind === "bill" || item.kind === "task");
  return <article className={`life-item is-${item.done ? "done" : item.stage}`} data-source={item.source_key}>
    <div className="life-row"><strong>{typeof item.title === "string" ? item.title : pick(item.title, lang)}</strong>
      <span>{t(item.done ? "life.completed" : `life.${item.stage}` as MessageKey)}</span></div>
    <div className="life-row"><span>{item.due_date ?? t("life.unknown")}</span>
      {item.amount !== null && <strong>{formatMoney(item.amount, item.currency, lang)}</strong>}
      {item.unread && !item.done && <small>{t("life.new")}</small>}</div>
    {item.amount_confirmed && item.catalog_amount && <p className="panel-muted">{t("life.amountFrom", { amount: formatMoney(item.catalog_amount, item.currency, lang) })}</p>}
    <MoneyCheck item={item} gapDate={control.data?.funding.first_gap_date ?? null} />
    {item.estimated && <p className="panel-muted">{t("life.estimate")}</p>}
    {item.template && !item.done && <p className="panel-muted">{t("life.template")}</p>}
    {item.snoozed && <p>{t("life.snoozed", { date: item.snoozed_until ?? "" })}</p>}
    {item.source_text && <details><summary>{t("simple.details")}</summary><p className="life-source">{item.source_text}</p></details>}
    <div className="life-actions">
      {!item.done && (item.kind === "enrollment" || item.kind === "loan") && <button className="primary" disabled={disabled}
        onClick={() => onOpen(item)}>{t(item.kind === "loan" ? "life.repay" : "life.enroll")}</button>}
      {canPay && <button className="primary" disabled={preview} onClick={() => workspace?.open({ kind: "wallet", section: "pay" })}>{t("life.payNow")}</button>}
      {!item.done && ["task", "bill"].includes(item.kind) && <button className="secondary" disabled={disabled}
        onClick={() => void act("complete")}>{t(item.kind === "bill" ? "life.paid" : "life.done")}</button>}
      {item.done && item.kind === "task" && <button className="secondary" disabled={disabled} onClick={() => void act("reopen")}>{t("life.reopen")}</button>}
      {!item.done && <>
        <button className="link-button" disabled={disabled} onClick={() => { setMode("snooze"); setDate(""); }}>{t("life.snooze")}</button>
        {item.kind !== "loan" && <button className="link-button" disabled={disabled} onClick={() => { setMode("reschedule"); setDate(item.due_date ?? ""); }}>{t("life.reschedule")}</button>}
        {editable && <button className="link-button" disabled={disabled} onClick={() => { setMode("amount"); setAmount(item.amount ?? ""); }}>{t("life.setAmount")}</button>}
        {item.unread && <button className="link-button" disabled={disabled} onClick={() => void act("acknowledge")}>{t("life.ack")}</button>}
      </>}
    </div>
    {item.kind === "bill" && !item.done && <small>{t("life.paidHint")}</small>}
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
  </article>;
}
