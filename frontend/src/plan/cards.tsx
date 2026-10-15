import { SchoolSources } from "./SchoolSources";
import { useI18n, type MessageKey } from "../i18n";
import { day, money, percent, pick } from "./format";
import { useShow } from "./currency";
import { moneyActionName } from "./MoneyConfirm";
import { formatRate } from "../backend/presenters";
import { LoanAdviceCard } from "./LoanAdviceCard";
import type { LoanReview } from "./loanAdvice";
import { shownCard, type Bill, type Card, type CatalogEntry, type Estimate, type Place, type Plan, type SchoolBrief } from "./types";

export type CardActions = {
  ask(text: string): void;
  reviewLoan?(review: LoanReview): void;
  /** Saves the school as the plan straight away (no model call) and opens the funding panel. */
  choose(schoolKey: string, name: string, years?: number): void;
  confirm(pendingId: string): void;
  reject(pendingId: string): void;
  busy: boolean;
  readOnly: boolean;
  pendingStatus(pendingId: string): string;
};

function Sample() {
  const { t } = useI18n();
  return <span className="plan-badge plan-badge-sample">{t("plan.sample")}</span>;
}

function Simulated() {
  const { t } = useI18n();
  return <span className="plan-badge plan-badge-sim">{t("plan.simulated")}</span>;
}

function Converted({ value }: { value?: { currency: string; amount: string; rate: string; rate_date: string | null; source: string | null } | null }) {
  const { lang, t } = useI18n();
  if (!value || !value.rate_date) return null;
  return <p className="service-muted">{t("plan.cost.converted", { amount: money(value.amount, value.currency, lang),
    rate: formatRate(value.rate), source: value.source ?? "", date: value.rate_date })}</p>;
}

function SchoolList({ schools, actions, compare }: { schools: SchoolBrief[]; actions: CardActions; compare?: boolean }) {
  const { lang, t } = useI18n();
  const ask = (template: MessageKey, school: SchoolBrief) => actions.ask(`${pick(school.name, lang)} ${t(template)}`);
  return <div className="plan-card">
    <div className="plan-card-head"><h3>{t(compare ? "plan.card.compare" : "plan.card.schools")}</h3><Sample /></div>
    <div className="plan-school-grid">
      {schools.map((school) => <article key={school.key} className="plan-school">
        <strong>{pick(school.name, lang)}</strong>
        <span className="service-muted">{pick(school.city, lang)} · {pick(school.country, lang)}</span>
        <span className="service-muted">{t("plan.card.duration", { years: school.duration_years, intake: school.intake })}</span>
        <dl className="comparison-facts">
          <div><dt>{t("plan.card.tuitionYear")}</dt><dd>{money(school.tuition_per_year, school.currency, lang)}</dd></div>
          <div><dt>{t("plan.card.livingYear")}</dt><dd>{money(school.living_per_year, school.currency, lang)}</dd></div>
          <div><dt>{t("plan.card.firstYear")}</dt><dd>{money(school.first_year_total, school.currency, lang)}
            {school.first_year_converted && <small> ≈ {money(school.first_year_converted.amount, school.first_year_converted.currency, lang)}</small>}</dd></div>
        </dl>
        <SchoolSources schoolKey={school.key} info={school} compact />
        {!actions.readOnly && <div className="plan-card-actions">
          <button type="button" className="chip" disabled={actions.busy} onClick={() => ask("plan.card.costOf", school)}>{t("plan.card.costOf")}</button>
          <button type="button" className="chip" disabled={actions.busy} onClick={() => ask("plan.card.campusOf", school)}>{t("plan.card.campusOf")}</button>
        </div>}
      </article>)}
    </div>
  </div>;
}

function Places({ title, rows }: { title: string; rows: Place[] }) {
  const { lang, t } = useI18n();
  return <div className="plan-places">
    <h4>{title}</h4>
    <ul>{rows.map((place) => <li key={place.name.en}>
      <strong>{pick(place.name, lang)}</strong>
      <span className="service-muted">{pick(place.note, lang)}</span>
      <span className="plan-place-meta">
        {place.distance_km !== null && place.distance_km !== undefined && <span>{t("plan.card.km", { km: place.distance_km })}</span>}
        {place.typical_cost && <span>~{place.typical_cost}</span>}
      </span>
    </li>)}</ul>
  </div>;
}

function School({ school, actions }: { school: CatalogEntry; actions: CardActions }) {
  const { lang, t } = useI18n();
  const name = pick(school.school.name, lang);
  return <div className="plan-card">
    <div className="plan-card-head">
      <div><h3>{name}</h3><span className="service-muted">{pick(school.school.program, lang)} · {pick(school.school.city, lang)}, {pick(school.school.country, lang)}</span></div>
      <Sample />
    </div>
    <div className="plan-places-grid">
      <Places title={t("plan.card.facilities")} rows={school.facilities} />
      <Places title={t("plan.card.food")} rows={school.food} />
      <Places title={t("plan.card.attractions")} rows={school.attractions} />
    </div>
    <SchoolSources schoolKey={school.key} info={school} />
    <div className="plan-card-actions">
      <a className="link-button" href={school.school.website} target="_blank" rel="noreferrer">{t("plan.card.website")}</a>
      {!actions.readOnly && <>
        <button type="button" className="chip" disabled={actions.busy} onClick={() => actions.ask(`${name} ${t("plan.card.costOf")}`)}>{t("plan.card.costOf")}</button>
        <button type="button" className="chip" disabled={actions.busy} onClick={() => actions.choose(school.key, name)}>{t("plan.card.choose")}</button>
      </>}
    </div>
  </div>;
}

function Cost({ name, estimate, actions }: { name: string; estimate: Estimate; actions: CardActions }) {
  const { lang, t } = useI18n();
  const cur = estimate.currency;
  const groups = ["tuition", "living", "essentials"] as const;
  return <div className="plan-card">
    <div className="plan-card-head"><div><h3>{name}</h3><span className="service-muted">{t("plan.cost.title", { years: estimate.years })}</span></div><Sample /></div>
    <div className="plan-totals">
      <div><span>{t("plan.cost.total")}</span><strong>{money(estimate.total, cur, lang)}</strong></div>
      {groups.map((group) => <div key={group}><span>{t(`plan.cost.group.${group}`)}</span><strong>{money(estimate.groups[group], cur, lang)}</strong></div>)}
    </div>
    <Converted value={estimate.converted} />
    <p className="service-muted">{t("plan.cost.range")}: {money(estimate.total_low, cur, lang)} – {money(estimate.total_high, cur, lang)} · {t("plan.cost.estimated", { share: percent(estimate.estimated_share, lang) })}</p>
    {groups.map((group) => <details key={group} className="plan-lines" open={group === "tuition"}>
      <summary>{t(`plan.cost.group.${group}`)}</summary>
      <table>
        <thead><tr><th>{t("plan.cost.item")}</th><th>{t("plan.cost.unit")}</th><th>{t("plan.cost.lineTotal")}</th></tr></thead>
        <tbody>{estimate.lines.filter((line) => line.group === group).map((line) => <tr key={line.cost_id}>
          <td>{pick(line.label, lang)} {line.estimate
            ? <span className="plan-badge">{t("plan.estimate")}</span>
            : line.source_url && <a className="plan-badge plan-badge-link" href={line.source_url} target="_blank" rel="noreferrer">{t("plan.sourced")}</a>}</td>
          <td>{line.lower && line.upper ? `${money(line.lower, "", lang)}–${money(line.upper, cur, lang)}` : money(line.amount, cur, lang)}<small> {t(`plan.period.${line.period}` as MessageKey)}</small></td>
          <td>{money(line.total, cur, lang)}</td>
        </tr>)}</tbody>
      </table>
    </details>)}
    {!actions.readOnly && <div className="plan-card-actions">
      <button type="button" className="chip" disabled={actions.busy} onClick={() => actions.choose(estimate.school_key, name, estimate.years)}>{t("plan.card.choose")}</button>
    </div>}
  </div>;
}

export function PlanFacts({ plan }: { plan: Plan }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const cur = plan.currency ?? plan.school?.currency ?? "";
  return <dl className="comparison-facts">
    <div><dt>{t("plan.plan.school")}</dt><dd>{pick(plan.school?.name, lang) || plan.school_key}</dd></div>
    <div><dt>{t("plan.plan.years")}</dt><dd>{plan.years}</dd></div>
    <div><dt>{t("plan.plan.start")}</dt><dd>{day(plan.start_date, lang)}</dd></div>
    <div><dt>{t("plan.plan.total")}</dt><dd>{show(plan.total, cur, lang).main}</dd></div>
  </dl>;
}

function PlanCard({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  return <div className="plan-card">
    <div className="plan-card-head"><h3>{t("plan.plan.title")}</h3><span className={`status-chip status-${plan.status.toLowerCase()}`}>{t(`plan.plan.status.${plan.status}`)}</span></div>
    <PlanFacts plan={plan} />
  </div>;
}

export function LoanFacts({ plan }: { plan: Plan }) {
  const { lang, t } = useI18n();
  const loan = plan.loan;
  if (!loan) return null;
  return <dl className="comparison-facts">
    <div><dt>{t("plan.loan.principal")}</dt><dd>{money(loan.principal, loan.currency, lang)}</dd></div>
    <div><dt>{t("plan.loan.months")}</dt><dd>{t("plan.loan.monthsValue", { months: loan.months })}</dd></div>
    <div><dt>{t("plan.loan.rate")}</dt><dd>{(Number(loan.annual_rate) * 100).toFixed(1)}%</dd></div>
    <div><dt>{t("plan.loan.monthly")}</dt><dd>{money(loan.monthly_payment, loan.currency, lang)}</dd></div>
    <div><dt>{t("plan.loan.total")}</dt><dd>{money(loan.total_repayment, loan.currency, lang)}</dd></div>
  </dl>;
}

function LoanCard({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  return <div className="plan-card">
    <div className="plan-card-head"><h3>{t("plan.loan.title")}</h3><Simulated /></div>
    <LoanFacts plan={plan} />
    <p className="service-muted">{t("plan.loan.thb")}</p>
  </div>;
}

function Confirmation({ card, actions }: { card: Extract<Card, { type: "confirmation" }>; actions: CardActions }) {
  const { lang, t } = useI18n();
  const status = actions.pendingStatus(card.pending_action_id);
  const isPlan = card.action === "plan.confirm";
  const open = status === "PENDING" && new Date(card.expires_at).getTime() > Date.now();
  return <div className="plan-card plan-card-confirm">
    <div className="plan-card-head">
      <h3>{isPlan ? t(`plan.confirm.${card.action}` as MessageKey) : moneyActionName(card.action, t)}</h3>
      <span className={`status-chip status-${status.toLowerCase()}`}>{t(`plan.confirm.status.${status}` as MessageKey)}</span>
    </div>
    {card.plan && <PlanFacts plan={card.plan} />}
    {!isPlan && card.amount && <p>{money(card.amount, card.currency, lang)}</p>}
    <p className="service-muted">{isPlan ? t("plan.confirm.planText") : t("plan.confirm.money")}</p>
    {open && !actions.readOnly && (isPlan ? <div className="plan-card-actions">
      <button type="button" className="primary" disabled={actions.busy} onClick={() => actions.confirm(card.pending_action_id)}>{t("plan.confirm.yes")}</button>
      <button type="button" className="secondary" disabled={actions.busy} onClick={() => actions.reject(card.pending_action_id)}>{t("plan.confirm.no")}</button>
    </div> : <div className="plan-card-actions">
      <button type="button" className="primary" disabled={actions.busy} onClick={() => actions.confirm(card.pending_action_id)}>{t("plan.confirm.review")}</button>
      <button type="button" className="secondary" disabled={actions.busy} onClick={() => actions.reject(card.pending_action_id)}>{t("plan.confirm.no")}</button>
    </div>)}
  </div>;
}

export function Bills({ bills, onPay, busy, today }: { bills: Bill[]; onPay?: (bill: Bill) => void; busy?: boolean; today?: string }) {
  const { lang, t } = useI18n();
  if (!bills.length) return <p className="service-muted">{t("plan.bills.none")}</p>;
  return <ul className="plan-bills">{bills.map((bill) => <li key={bill.id}>
    <span>{day(bill.due_date, lang)}</span>
    <strong>{pick(bill.label, lang)}</strong>
    <span>{money(bill.amount, bill.currency, lang)}</span>
    {bill.status === "PAID" ? <span className="status-chip status-confirmed">{t("plan.bills.paid")}</span>
      : today && bill.due_date < today ? <span className="status-chip status-failed">{t("plan.bills.overdue")}</span> : null}
    {onPay && bill.status === "DUE" && <button type="button" className="chip" disabled={busy} onClick={() => onPay(bill)}>{t("plan.bills.pay")}</button>}
  </li>)}</ul>;
}

export function CardView({ card, actions }: { card: Card; actions: CardActions }) {
  const { lang, t } = useI18n();
  if (!shownCard(card)) return null;
  switch (card.type) {
    case "role":
      return card.role ? <p className="plan-role-note">{t(`plan.card.role.${card.role}`)}</p> : null;
    case "school_list":
      return <SchoolList schools={card.schools} actions={actions} />;
    case "comparison":
      return <SchoolList schools={card.schools} actions={actions} compare />;
    case "school":
      return card.school ? <School school={card.school} actions={actions} /> : null;
    case "cost":
      return <Cost name={pick(card.school.name, lang)} estimate={card.estimate} actions={actions} />;
    case "plan":
      return <PlanCard plan={card.plan} />;
    case "loan":
      return <LoanCard plan={card.plan} />;
    case "loan_advice":
      return <LoanAdviceCard card={card} actions={actions} />;
    case "confirmation":
      return <Confirmation card={card} actions={actions} />;
    case "bills":
      return <div className="plan-card"><div className="plan-card-head"><h3>{t("plan.bills.title")}</h3><Simulated /></div><Bills bills={card.bills} /></div>;
    default:
      return null;
  }
}
