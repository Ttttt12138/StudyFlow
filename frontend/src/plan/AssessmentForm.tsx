import { useI18n } from "../i18n";
import { TERMS, type AssessmentInputs, type Term } from "./assessmentTypes";
import type { Estimate } from "./types";
import { pick } from "./format";

type Props = { value: AssessmentInputs; onChange: (value: AssessmentInputs) => void; estimate?: Estimate; disabled: boolean };
type FieldProps = { label: string; value: string | null; onChange: (value: string | null) => void; type?: string };
export function PlanningField({ label, value, onChange, type = "number" }: FieldProps) {
  return <label>{label}<input type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined}
    value={value ?? ""} onChange={e => onChange(e.target.value || null)} /></label>;
}

/** The one answer the plan needs: money on hand for the course. */
export function AssessmentEssentials({ value: v, onChange }: { value: AssessmentInputs; onChange: (value: AssessmentInputs) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<AssessmentInputs>) => onChange({ ...v, ...patch });
  return <div className="assessment-essentials">
      <label className="assessment-money">{t("simple.funds")}<span>
        <input type="number" min="0" step="0.01" inputMode="decimal" aria-label={t("simple.funds")} value={v.available_funds ?? ""}
          onChange={e => set({ available_funds: e.target.value || null })} />
        <select aria-label={t("simple.currency")} value={v.funds_currency} onChange={e => set({ funds_currency: e.target.value })}>
          {["THB", "CNY", "USD", "GBP", "AUD", "SGD", "JPY", "MYR", "EUR"].map(c => <option key={c}>{c}</option>)}</select></span></label>
    </div>;
}

export function AssessmentForm({ value: v, onChange, estimate, disabled }: Props) {
  const { t } = useI18n();
  const set = (patch: Partial<AssessmentInputs>) => onChange({ ...v, ...patch });
  // Everything beyond the funds has a sensible default or stays unknown, so it waits behind "More settings".
  return <fieldset className="assessment-form" disabled={disabled}>
    <AssessmentEssentials value={v} onChange={onChange} />
    <section className="assessment-group assessment-more"><h4>{t("simple.more")}</h4><div className="assessment-more-body">
    <div className="assessment-fields">
      <PlanningField label={t("simple.reserve")} value={v.reserve} onChange={reserve => set({ reserve })} />
      <PlanningField label={t("simple.payment")} type="date" value={v.payment_date} onChange={payment_date => set({ payment_date })} />
    </div>
    <p className="panel-muted">{t("simple.paymentHint")}</p>
    <SupportFields value={v} onChange={onChange} />
    <LoanFields value={v} onChange={onChange} />
    <p className="panel-muted">{t("simple.termHint")}</p>
    <CostFields value={v} onChange={onChange} estimate={estimate} />
    </div></section>
  </fieldset>;
}

function SupportFields({ value: v, onChange }: Pick<Props, "value" | "onChange">) {
  const { t } = useI18n();
  const update = (index: number, patch: Partial<AssessmentInputs["supports"][number]>) => onChange({ ...v, supports: v.supports.map((r, i) => i === index ? { ...r, ...patch } : r) });
  return <section className="assessment-group"><h4>{t("simple.support")}</h4>
    {v.supports.map((row, index) => <div className="assessment-fields assessment-item" key={row.id}>
      <PlanningField label={t("simple.amount")} value={row.amount} onChange={amount => update(index, { amount: amount ?? "" })} />
      <label>{t("simple.currency")}<select value={row.currency} onChange={e => update(index, { currency: e.target.value })}>
        {["THB", "CNY", "USD", "GBP", "AUD", "SGD", "JPY", "MYR", "EUR"].map(c => <option key={c}>{c}</option>)}</select></label>
      <PlanningField label={t("simple.arrival")} type="date" value={row.available_on} onChange={available_on => update(index, { available_on })} />
      <label className="assessment-check"><input type="checkbox" checked={row.confirmed} onChange={e => update(index, { confirmed: e.target.checked })} />{t("simple.confirmed")}</label>
      <label className="assessment-check"><input type="checkbox" checked={!!row.included_in_funds} onChange={e => update(index, { included_in_funds: e.target.checked })} />{t("simple.included")}</label>
      <button type="button" className="link-button" onClick={() => onChange({ ...v, supports: v.supports.filter((_, i) => i !== index) })}>{t("simple.remove")}</button>
    </div>)}
    <button type="button" className="secondary" onClick={() => onChange({ ...v, supports: [...v.supports, { id: crypto.randomUUID(), amount: "", currency: v.funds_currency, available_on: null, confirmed: false }] })}>{t("simple.addSupport")}</button>
  </section>;
}

function LoanFields({ value: v, onChange }: Pick<Props, "value" | "onChange">) {
  const { t } = useI18n();
  const loan = (patch: Partial<AssessmentInputs["loan"]>) => onChange({ ...v, loan: { ...v.loan, ...patch } });
  return <><PlanningField label={t("simple.principal")} value={v.loan.principal} onChange={principal => loan({ principal })} />
    <p className="panel-muted">{t("simple.principalHint")}</p>
    <section className="assessment-group"><h4>{t("simple.terms")}</h4><div className="assessment-fields">
      <PlanningField label={t("simple.rate")} value={String(Number(v.loan.annual_rate) * 100)} onChange={rate => loan({ annual_rate: rate === null ? "" : String(Number(rate) / 100) })} />
      <PlanningField label={t("simple.fees")} value={v.loan.fees} onChange={fees => loan({ fees: fees ?? "" })} />
      <PlanningField label={t("simple.firstDue")} type="date" value={v.loan.first_due_date} onChange={first_due_date => loan({ first_due_date: first_due_date ?? "" })} />
      <label>{t("choose.term")}<select value={v.loan.months ?? v.loan.periods?.[0] ?? 48}
        onChange={e => loan({ months: Number(e.target.value) as Term })}>{TERMS.map(n => <option key={n} value={n}>{t("simple.months", { n })}</option>)}</select></label>
      <PlanningField label={t("simple.asof")} type="date" value={v.as_of} onChange={as_of => onChange({ ...v, as_of: as_of ?? "" })} />
      <label>{t("simple.horizon")}<select value={v.horizon} onChange={e => onChange({ ...v, horizon: Number(e.target.value) as 30 | 60 | 90 })}>
        {[30, 60, 90].map(n => <option key={n}>{n}</option>)}</select></label>
    </div></section></>;
}

function CostFields({ value: v, onChange, estimate }: Pick<Props, "value" | "onChange" | "estimate">) {
  const { t, lang } = useI18n();
  const update = (index: number, patch: Partial<AssessmentInputs["costs"][number]>) => onChange({ ...v, costs: v.costs.map((r, i) => i === index ? { ...r, ...patch } : r) });
  return <section className="assessment-group"><h4>{t("simple.feeDetails")} · {estimate?.currency}</h4>
    {v.costs.map((row, index) => <div className="assessment-fields assessment-item" key={index}>
      <label>{t("simple.costId")}<select value={row.cost_id} onChange={e => update(index, { cost_id: e.target.value })}>
        <option value="">—</option>{estimate?.lines.map(c => <option key={c.cost_id} value={c.cost_id}>{pick(c.label, lang)}</option>)}</select></label>
      <PlanningField label={t("simple.amount")} value={row.amount ?? null} onChange={amount => update(index, { amount })} />
      <PlanningField label={t("simple.date")} type="date" value={row.due_date ?? null} onChange={due_date => update(index, { due_date })} />
      <label className="assessment-check"><input type="checkbox" checked={!!row.paid} onChange={e => update(index, { paid: e.target.checked })} />{t("simple.paid")}</label>
      <button type="button" className="link-button" onClick={() => onChange({ ...v, costs: v.costs.filter((_, i) => i !== index) })}>{t("simple.remove")}</button>
    </div>)}
    <button type="button" className="secondary" onClick={() => onChange({ ...v, costs: [...v.costs, { cost_id: "" }] })}>{t("simple.addCost")}</button>
  </section>;
}
