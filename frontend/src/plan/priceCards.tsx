import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import type { CardActions } from "./cards";
import { cash, convertAmount, useDisplay, useShow } from "./currency";
import { pick } from "./format";
import type { Estimate, Plan, SchoolBrief, Text } from "./types";

const GROUPS = ["tuition", "living", "essentials"] as const;

/** The footnote every converted price carries: which rate, from when, and that the school data is a sample. */
function RateNote({ from, extra }: { from: string[]; extra?: string }) {
  const { lang, t } = useI18n();
  const { currency, rates } = useDisplay();
  const foreign = [...new Set(from)].filter(code => code !== currency && rates?.thb_per_unit[code] && rates.thb_per_unit[currency]);
  const parts = foreign.map(code => `1 ${code} ≈ ${cash(convertAmount(1, code, currency, rates) ?? 0, currency, lang).replace(/(\.\d{2})\d*/, "$1")}`);
  const when = rates?.rate_date ? t("price.rateDate", { date: rates.rate_date }) : t("price.rateFixture");
  return <p className="price-note">{[...(parts.length ? [`${parts.join(" · ")}（${when}）`] : []), extra, t("plan.sample")].filter(Boolean).join(" · ")}</p>;
}

/** Total cost of one school: one large figure in the chosen currency, then where the money goes. */
export function PriceCard({ id, name, estimate, actions }: { id: string; name: Text; estimate: Estimate; actions: CardActions }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const workspace = useWorkspace();
  const cur = estimate.currency;
  const title = pick(name, lang);
  const total = Number(estimate.total) || 1;
  const total_ = show(estimate.total, cur, lang);
  const low = show(estimate.total_low, cur, lang), high = show(estimate.total_high, cur, lang);
  const perYear = show(Number(estimate.total) / Math.max(estimate.years, 1), cur, lang);
  return <article className="price-card" aria-label={t("price.totalOf", { name: title, years: estimate.years })}>
    <div className="price-head"><h3>{t("price.totalOf", { name: title, years: estimate.years })}</h3></div>
    {estimate.complete === false && <p className="panel-note">{t("simple.incomplete")} · {estimate.missing_cost_ids?.join(", ")}</p>}
    <p className="price-big">{total_.main}{total_.original && <small>{total_.original}</small>}</p>
    {estimate.total_low !== estimate.total_high && <p className="price-sub">
      {t("price.range", { low: low.main.replace("≈ ", ""), high: high.main.replace("≈ ", "") })} · {t("price.perYear", { amount: perYear.main.replace("≈ ", "") })}</p>}
    <div className="price-bar" role="img" aria-label={GROUPS.map(g => `${t(`plan.cost.group.${g}`)} ${Math.round(Number(estimate.groups[g]) / total * 100)}%`).join("，")}>
      {GROUPS.map(g => <span key={g} className={`is-${g}`} style={{ flexGrow: Number(estimate.groups[g]) }} />)}
    </div>
    <dl className="price-groups">{GROUPS.map(g => <div key={g}><dt><i className={`is-${g}`} aria-hidden="true" />{t(`plan.cost.group.${g}`)} {Math.round(Number(estimate.groups[g]) / total * 100)}%</dt>
      <dd>{show(estimate.groups[g], cur, lang).main.replace("≈ ", "")}</dd></div>)}</dl>
    <div className="price-foot">
      <RateNote from={[cur]} extra={t("plan.cost.estimated", { share: Math.round(Number(estimate.estimated_share)) })} />
      <div className="price-actions">
        <button type="button" className="link-button" onClick={() => workspace?.open({ kind: "card", cardId: id })}>{t("price.details")}<ArrowRight size={14} aria-hidden="true" /></button>
        {!actions.readOnly && <button type="button" className="primary" disabled={actions.busy}
          onClick={() => actions.choose(estimate.school_key, title, estimate.years)}>{t("price.chooseGap")}</button>}
      </div>
    </div>
  </article>;
}

type Column = { school: SchoolBrief; total: number | null; years: number; base: number | null; firstYear: boolean };

/** Several schools side by side, priced over the whole course; the cheapest is marked. */
export function CompareCard({ id, schools, actions, list }: { id: string; schools: SchoolBrief[]; actions: CardActions; list?: boolean }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const { currency, rates } = useDisplay();
  const workspace = useWorkspace();
  const columns: Column[] = schools.map(school => {
    const firstYear = school.total == null;
    const amount = firstYear ? school.first_year_total : school.total!;
    return { school, firstYear, years: firstYear ? 1 : school.years ?? school.duration_years, total: Number(amount),
      base: convertAmount(amount, school.currency, "THB", rates) };
  });
  // Differences are computed in THB and shown in the chosen currency.
  const priced = columns.filter(c => c.base !== null);
  const cheapest = priced.length === columns.length && columns.every(c => c.school.complete !== false) && priced.length > 1 ? priced.reduce((a, b) => (b.base! < a.base! ? b : a)) : null;
  const anyFirstYear = columns.some(c => c.firstYear);
  const title = t(list ? "plan.card.schools" : anyFirstYear ? "price.compareFirst" : "price.compareTitle", { n: schools.length });
  return <article className="price-card" aria-label={title}>
    <div className="price-head"><h3>{title}</h3></div>
    <ul className={`compare-grid${columns.length > 3 ? " is-many" : ""}`}>
      {columns.map(column => {
        const name = pick(column.school.name, lang);
        const shown = show(column.total, column.school.currency, lang);
        const best = cheapest === column;
        const extra = cheapest && !best && column.base !== null ? convertAmount(column.base - cheapest.base!, "THB", currency, rates) : null;
        return <li key={column.school.key} className={best ? "is-best" : ""}>
          {best ? <span className="price-tag">{t("simple.lowest")}</span> : <span className="price-tag-space" aria-hidden="true" />}
          <strong className="compare-name">{name}<small> · {t(column.firstYear ? "price.firstYear" : "price.years", { n: column.years })}</small></strong>
          <span className="compare-total">{shown.main}</span>
          {column.school.complete === false && <small>{t("simple.incomplete")}</small>}
          {!column.firstYear && <span className="price-sub">{t("price.perYear", { amount: show(column.total! / Math.max(column.years, 1), column.school.currency, lang).main.replace("≈ ", "") })}</span>}
          {extra !== null && <span className="compare-more">{t("price.more", { amount: show(extra, currency, lang).main.replace("≈ ", "") })}</span>}
          {!actions.readOnly && <button type="button" className="chip" disabled={actions.busy}
            onClick={() => actions.choose(column.school.key, name, column.firstYear ? undefined : column.years)}>{t("price.chooseThis")}</button>}
        </li>;
      })}
    </ul>
    <div className="price-foot">
      <RateNote from={schools.map(s => s.currency)} extra={anyFirstYear ? t("price.firstYearNote") : t("price.compareNote")} />
      <div className="price-actions">
        <button type="button" className="link-button" onClick={() => workspace?.open({ kind: "card", cardId: id })}>{t("price.details")}<ArrowRight size={14} aria-hidden="true" /></button>
      </div>
    </div>
  </article>;
}

/** Shown after the plan has a school and the family's funds: what is still missing, and the two ways to cover it. */
export function GapCard({ plan, actions }: { plan: Plan; actions: CardActions }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const workspace = useWorkspace();
  const cur = plan.currency ?? plan.school?.currency ?? "THB";
  const name = pick(plan.school?.name, lang) || plan.school_key;
  const gap = show(plan.gap, cur, lang);
  return <article className="gap-card">
    <div><p>{t("price.gapOf", { name, years: plan.years })}</p><strong>{gap.main}</strong>{gap.original && <small>{gap.original}</small>}</div>
    {!actions.readOnly && <div className="price-actions">
      <button type="button" className="primary" disabled={actions.busy} onClick={() => workspace?.open({ kind: "funding" })}>{t("simple.choose")}</button>
      
    </div>}
  </article>;
}

/** The simulated loan for the gap: the monthly payment first, then what it costs in total. */
export function LoanOffer({ plan, actions }: { plan: Plan; actions: CardActions }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const loan = plan.loan;
  if (!loan) return null;
  const monthly = show(loan.monthly_payment, loan.currency, lang);
  const interest = Number(loan.total_repayment) - Number(loan.principal);
  const open = !actions.readOnly && plan.status === "DRAFT";
  return <article className="price-card">
    <div className="price-head"><h3>{t("price.loanTitle", { months: loan.months })}</h3><span className="price-tag is-quiet">{t("price.loanSim")}</span></div>
    <p className="price-label">{t("price.monthly")}</p>
    <p className="price-big">{monthly.main}{monthly.original && <small>{monthly.original}</small>}</p>
    <dl className="price-groups">
      <div><dt>{t("plan.loan.principal")}</dt><dd>{show(loan.principal, loan.currency, lang).main.replace("≈ ", "")}</dd></div>
      <div><dt>{t("price.interest", { rate: (Number(loan.annual_rate) * 100).toFixed(1).replace(/\.0$/, "") })}</dt><dd>{show(interest, loan.currency, lang).main.replace("≈ ", "")}</dd></div>
      <div><dt>{t("plan.loan.total")}</dt><dd>{show(loan.total_repayment, loan.currency, lang).main.replace("≈ ", "")}</dd></div>
    </dl>
    {open && <div className="price-terms" role="group" aria-label={t("plan.loan.months")}>
      {[36, 48, 60].map(months => <button key={months} type="button" className="chip" aria-pressed={loan.months === months} disabled={actions.busy}
        onClick={() => { if (loan.months !== months) actions.ask(t("price.askMonths", { n: months })); }}>{t("price.term", { n: months })}</button>)}
    </div>}
    <div className="price-foot">
      <RateNote from={[loan.currency]} extra={t("plan.loan.thb")} />
      {open && <div className="price-actions"><button type="button" className="primary" disabled={actions.busy}
        onClick={() => actions.ask(t("price.askConfirm"))}>{t("price.useLoan")}</button></div>}
    </div>
  </article>;
}
