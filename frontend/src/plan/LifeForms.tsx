import { useState } from "react";
import { useI18n } from "../i18n";
import { formatMoney } from "../backend/presenters";
import type { LifeControl } from "./useStudyLife";

export function TaskForm({ control, preview }: { control: LifeControl; preview: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState({ title: "", due_date: "", amount: "", currency: "THB", source_text: "" });
  const submit = async () => {
    try { await control.run("planning/life/tasks/", { ...task, due_date: task.due_date || null, amount: task.amount || null });
      setTask({ title: "", due_date: "", amount: "", currency: "THB", source_text: "" }); setOpen(false); } catch { /* control error */ }
  };
  return <section><button className="secondary" disabled={preview} onClick={() => setOpen(!open)}>{t("life.add")}</button>
    {open && <form className="life-form" onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={control.busy || preview}>
      <label>{t("life.taskTitle")}<input required maxLength={200} value={task.title} onChange={e => setTask({ ...task, title: e.target.value })} /></label>
      <label>{t("life.deadline")}<input type="date" value={task.due_date} onChange={e => setTask({ ...task, due_date: e.target.value })} /></label>
      <details><summary>{t("life.source")}</summary><label>{t("life.source")}<textarea maxLength={4000} value={task.source_text}
        onChange={e => setTask({ ...task, source_text: e.target.value })} /></label><p className="panel-muted">{t("life.sourceHint")}</p></details>
      <details><summary>{t("life.amount")}</summary>
        <label>{t("life.amount")}<input type="number" min="0" step="0.01" value={task.amount} onChange={e => setTask({ ...task, amount: e.target.value })} /></label>
        <label>{t("life.currency")}<select value={task.currency} onChange={e => setTask({ ...task, currency: e.target.value })}>
          {["THB", "CNY", "USD", "GBP", "AUD", "SGD", "JPY", "MYR", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label></details>
      <button className="primary">{t("life.save")}</button></fieldset></form>}</section>;
}

export function LifeBudget({ control, preview }: { control: LifeControl; preview: boolean }) {
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState(false), [amount, setAmount] = useState("");
  const [spent, setSpent] = useState(""), [note, setNote] = useState("");
  const budget = control.data?.budget;
  if (!budget) return <p className="panel-muted">{t("life.before")}</p>;
  const money = (v: string) => formatMoney(v, budget.currency, lang);
  const submitBudget = async () => {
    try { await control.run("planning/life/budget/", { month: budget.month, amount, expected_version: budget.budget_version }); setEditing(false); } catch { /* control error */ }
  };
  const submitExpense = async () => {
    try { await control.run("planning/expenses/record/", { amount: spent, currency: budget.currency, note }); setSpent(""); setNote(""); } catch { /* control error */ }
  };
  return <section className="life-budget"><h3>{t("life.budget")} · {budget.month}</h3>
    <dl className="assessment-facts"><div><dt>{t("life.budgetAmount")}</dt><dd>{budget.budget_known ? money(budget.budget) : t("simple.unknown")}</dd></div>
      <div><dt>{t("life.spent")}</dt><dd>{money(budget.spent)}</dd></div><div><dt>{t("life.remaining")}</dt>
        <dd>{budget.budget_known && !budget.unconverted?.length ? money(budget.remaining) : t("simple.unknown")}</dd></div></dl>
    <p className="panel-muted">{t("life.budgetHint")}</p>
    {budget.unconverted?.length ? <p>{t("simple.missingFx")}</p> : null}
    {budget.budget_source === "estimate" && <p className="panel-muted">{t("life.budgetEstimate")}</p>}
    <button className="secondary" disabled={preview} onClick={() => { setAmount(budget.budget_known ? budget.budget : ""); setEditing(!editing); }}>{t("life.editBudget")}</button>
    {editing && <form className="life-form" onSubmit={e => { e.preventDefault(); void submitBudget(); }}>
      <label>{t("life.budgetAmount")} · {budget.currency}<input required type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <button className="primary" disabled={control.busy || preview}>{t("life.save")}</button></form>}
    <details><summary>{t("life.expense")}</summary><form className="life-form" onSubmit={e => { e.preventDefault(); void submitExpense(); }}>
      <label>{t("life.expenseAmount")} · {budget.currency}<input required type="number" min="0.01" step="0.01" value={spent} onChange={e => setSpent(e.target.value)} /></label>
      <label>{t("life.expenseNote")}<input maxLength={200} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button className="primary" disabled={control.busy || preview}>{t("life.save")}</button></form></details>
    {budget.recent?.slice(0, 3).map(expense => <div className="life-row" key={expense.id}>
      <span>{expense.spent_on} · {expense.note} · {formatMoney(expense.amount, expense.currency, lang)}</span>
      <button className="link-button" disabled={control.busy || preview} onClick={() => void control.run("planning/life/undo-expense/", { expense_id: expense.id }).catch(() => {})}>{t("life.undoExpense")}</button></div>)}
  </section>;
}

export function LifeClock({ control, preview }: { control: LifeControl; preview: boolean }) {
  const { t } = useI18n();
  const [date, setDate] = useState("");
  return <details><summary>{t("life.clock")}</summary><p className="panel-muted">{t("life.clockHint")}</p>
    <form className="life-form" onSubmit={e => { e.preventDefault(); void control.run("planning/life/clock/", { date }).catch(() => {}); }}>
      <label>{t("life.date")}<input type="date" required min={control.data?.today} value={date} onChange={e => setDate(e.target.value)} /></label>
      <button className="secondary" disabled={control.busy || preview}>{t("life.advance")}</button></form></details>;
}
