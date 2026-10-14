import { PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { LifeControl } from "./useStudyLife";

const CURRENCIES = ["THB", "CNY", "USD", "GBP", "AUD", "SGD", "JPY", "MYR", "EUR"];
export const EXPENSE_CATEGORIES = ["food", "transport", "housing", "study", "shopping", "fun", "health", "other"] as const;

/** New to-do, on its own page. */
export function TaskForm({ control, preview, onDone }: { control: LifeControl; preview: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const [task, setTask] = useState({ title: "", due_date: "", amount: "", currency: "THB", source_text: "" });
  const submit = async () => {
    try { await control.run("planning/life/tasks/", { ...task, due_date: task.due_date || null, amount: task.amount || null }); onDone(); }
    catch { /* control error */ }
  };
  return <form className="life-form" onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={control.busy || preview}>
    <label>{t("life.taskTitle")}<input required maxLength={200} value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} /></label>
    <label>{t("life.deadline")}<input type="date" value={task.due_date} onChange={e => setTask({ ...task, due_date: e.target.value })} /></label>
    <div className="life-form-pair">
      <label>{t("life.amount")}<input type="number" min="0" step="0.01" value={task.amount} onChange={e => setTask({ ...task, amount: e.target.value })} /></label>
      <label>{t("life.currency")}<select value={task.currency} onChange={e => setTask({ ...task, currency: e.target.value })}>
        {CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label>
    </div>
    <label>{t("life.source")}<textarea maxLength={4000} rows={3} value={task.source_text} onChange={e => setTask({ ...task, source_text: e.target.value })} /></label>
    <p className="panel-muted">{t("life.sourceHint")}</p>
    <button className="primary">{t("life.save")}</button></fieldset></form>;
}

/** Spending entry, on its own page: amount, a category chip and an optional note. */
export function ExpenseForm({ control, preview, currency, onDone }: { control: LifeControl; preview: boolean; currency: string; onDone: () => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState(""), [note, setNote] = useState(""), [category, setCategory] = useState("");
  const submit = async () => {
    try { await control.run("planning/expenses/record/", { amount: Number(amount).toFixed(2), currency, note, ...(category ? { category } : {}) }); onDone(); }
    catch { /* control error */ }
  };
  return <form className="life-form" onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={control.busy || preview}>
    <label>{t("plan.expense.amount")} · {currency}<input required inputMode="decimal" value={amount}
      onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" /></label>
    <div className="panel-chips" role="group" aria-label={t("plan.expense.category")}>{EXPENSE_CATEGORIES.map(item =>
      <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(category === item ? "" : item)}>{t(`plan.cat.${item}` as MessageKey)}</button>)}</div>
    <label>{t("plan.expense.note")}<input maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></label>
    <button className="primary" disabled={!Number(amount)}>{t("plan.expense.save")}</button></fieldset></form>;
}

/** The month's budget, edited in place in the summary card. */
export function BudgetEdit({ control, preview }: { control: LifeControl; preview: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false), [amount, setAmount] = useState("");
  const budget = control.data?.budget;
  if (!budget) return null;
  const submit = async () => {
    try { await control.run("planning/life/budget/", { month: budget.month, amount, expected_version: budget.budget_version }); setEditing(false); }
    catch { /* control error */ }
  };
  if (!editing) return <button type="button" className="life-icon-button" aria-label={t("life.editBudget")} title={t("life.editBudget")} disabled={preview}
    onClick={() => { setAmount(budget.budget_known ? budget.budget : ""); setEditing(true); }}><PencilSimple size={16} aria-hidden="true" /></button>;
  return <form className="life-inline-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label className="sr-only" htmlFor="life-budget-amount">{t("life.budgetAmount")}</label>
    <input id="life-budget-amount" required autoFocus type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
    <span>{budget.currency}</span>
    <button className="primary" disabled={control.busy}>{t("life.save")}</button>
    <button type="button" className="secondary" onClick={() => setEditing(false)}>{t("life.cancel")}</button>
  </form>;
}

/** Moves the shared simulated date forward (demo only), on its own page. */
export function ClockForm({ control, preview, onDone }: { control: LifeControl; preview: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const [date, setDate] = useState("");
  return <form className="life-form" onSubmit={e => { e.preventDefault(); void control.run("planning/life/clock/", { date }).then(onDone).catch(() => {}); }}>
    <p className="panel-muted">{t("life.clockHint")}</p>
    <label>{t("life.date")}<input type="date" required min={control.data?.today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <button className="primary" disabled={control.busy || preview}>{t("life.advance")}</button></form>;
}
