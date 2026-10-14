import { useI18n, type MessageKey } from "../i18n";
import { formatMoney } from "../backend/presenters";
import { Donut, LineChart, StackBar } from "../workspace/PanelCharts";
import { useShow } from "./currency";
import { pick } from "./format";
import type { PlanningAssessment } from "./assessmentTypes";
import { verdict } from "./verdict";

const GROUPS = [["tuition", "#1677ff"], ["living", "#ff8a3d"], ["essentials", "#7fd0f0"]] as const;
const n = (value: string | null | undefined) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };

/**
 * "My plan" as pictures instead of a form: what the course costs, how much of it is covered and how to cover the rest
 * (no loan, or one of the simulated loans). Missing facts are typed in above it (AssessmentPanel); the near-term
 * balance forecast is on the details page (BalanceForecast).
 */
export const NO_LOAN = "none";

export function PlanVisual({ data, selected, onSelect, allowNone = false, showQuotes = false }: {
  data: PlanningAssessment; selected: string; onSelect: (id: string) => void; allowNone?: boolean;
  /** The loan cards; the live panel picks the loan in LoanChooser instead. */
  showQuotes?: boolean;
}) {
  const { t, lang } = useI18n();
  const e = data.estimate, plan = data.plan, inputs = data.inputs;
  const show = useShow();
  // Every figure in the display currency the family picked; the school's own currency stays as small print.
  const money = (value: string | number | null | undefined, currency = "THB") => show(value ?? 0, currency, lang).main;
  const school = (value: string | number | null | undefined, currency: string) => show(value ?? 0, currency, lang).original;
  const total = n(plan?.total), gap = Math.max(0, n(plan?.gap));

  return <div className="plan-visual">
    {e && <section className="plan-visual-hero">
      <p className="panel-muted">{plan?.school && pick(plan.school.name, lang)} · {t("simple.years", { n: e.years })}</p>
      <strong>{money(e.total, e.currency)}</strong>
      {school(e.total, e.currency) && <small className="panel-muted">{school(e.total, e.currency)}</small>}
      <span className="panel-muted">{t("simple.firstYear")} {money(e.first_year, e.currency)}{e.complete === false && ` · ${t("simple.incomplete")}`}</span>
      {inputs?.available_funds && plan?.gap != null && <p className={`plan-visual-gap${gap > 0 ? " is-short" : ""}`} role="status">
        {gap > 0 ? t("simple.gapHeadline", { amount: money(gap, plan.currency) }) : t("simple.fundsEnough")}</p>}
    </section>}

    {e && <section><h3 className="panel-section-title">{t("simple.costMix")}</h3>
      <Donut label={t("simple.costMix")} center={<strong>{t("simple.years", { n: e.years })}</strong>}
        slices={GROUPS.map(([group, color]) => ({ key: group, color, value: n(e.groups[group]), label: t(`plan.cost.group.${group}` as MessageKey),
          display: money(e.groups[group], e.currency) }))} />
    </section>}

    {plan?.gap != null && total > 0 && <section><h3 className="panel-section-title">{t("simple.coverage")}</h3>
      <StackBar label={t("simple.coverage")} parts={[
        { key: "covered", value: Math.max(0, total - gap), tone: "mint", label: t("plan.covered", { amount: money(total - gap, plan.currency) }) },
        { key: "gap", value: gap, tone: "gold", label: t("plan.gapPart", { amount: money(gap, plan.currency) }) }]} />
    </section>}

    {showQuotes && data.quotes.length > 0 && <section><h3 className="panel-section-title">{t(allowNone ? "simple.payChoice" : "simple.loanChoice")}</h3>
      <div className="plan-visual-quotes" role="radiogroup" aria-label={t(allowNone ? "simple.payChoice" : "simple.loanChoice")}>
        {allowNone && <button type="button" role="radio" aria-checked={selected === NO_LOAN}
          className={`plan-visual-quote${selected === NO_LOAN ? " is-selected" : ""}`} onClick={() => onSelect(NO_LOAN)}>
          <span className="plan-visual-quote-head"><strong>{t("simple.noLoan")}</strong></span>
          <small className="panel-muted">{t("simple.noLoanNote", { amount: data.suggested_principal != null ? money(data.suggested_principal) : money(gap, plan?.currency) })}</small>
        </button>}
        {data.quotes.map(q => { const pay = n(q.result.maximum_installment); const status = q.assessment.status;
          return <button key={q.id} type="button" role="radio" aria-checked={q.id === selected}
            aria-label={q.inputs.product === "commercial_student_demo" ? t("loanProduct.commercial") : t("simple.months", { n: q.inputs.months })}
            className={`plan-visual-quote${q.id === selected ? " is-selected" : ""}`} onClick={() => onSelect(q.id)}>
            <span className="plan-visual-quote-head"><strong>{t("simple.months", { n: q.inputs.months })}</strong>
              <span className={`plan-visual-tag is-${status}`}>{verdict(t, q)}</span></span>
            {q.inputs.product === "commercial_student_demo" && <small className="panel-muted">{t("loanProduct.commercial")}</small>}
            <span className="plan-visual-pay">{money(pay)}<small>/{t("simple.perMonth")}</small></span>
            <small className="panel-muted">{t("simple.totalRepay")} {money(q.result.total_repayment)} · {t("simple.interest")} {money(q.result.total_interest)}</small>
          </button>; })}
      </div>
    </section>}
  </div>;
}

/** The near-term cash forecast: how the declared money runs over the next weeks. Shown on the details page. */
export function BalanceForecast({ data }: { data: PlanningAssessment }) {
  const { t, lang } = useI18n();
  const f = data.forecast;
  const balances = f?.timeline.map(row => n(row.balance_after)) ?? [];
  if (!f || balances.length < 2) return null;
  const money = (value: string | number | null | undefined) => formatMoney(String(value ?? 0), "THB", lang);
  const low = Math.min(...balances);
  return <section><h3 className="panel-section-title">{t("simple.balance", { days: f.horizon })}</h3>
    <LineChart label={t("simple.balance", { days: f.horizon })} points={balances.map(v => v - Math.min(0, low))} height={72} />
    <p className="plan-visual-axis"><span>{f.as_of}</span><span>{f.end_date}</span></p>
    <p className={f.first_gap_date ? "life-warning" : "panel-muted"}>
      {f.first_gap_date ? t("simple.gapFrom", { date: f.first_gap_date, amount: money(f.maximum_reserve_gap) })
        : f.complete ? t("simple.noGap") : t("simple.forecastPartial")}{!f.first_gap_date && ` · ${t("simple.lowPoint", { amount: money(low) })}`}</p>
  </section>;
}
