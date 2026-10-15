import { SchoolSources } from "./SchoolSources";
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { PanelFacts, PanelHero, PanelPager, ToolPanel, usePage } from "../workspace/ToolPanel";
import { CardView, type CardActions } from "./cards";
import { day, money, percent, pick } from "./format";
import { shownCard, type Card, type CatalogEntry, type Estimate, type Place, type SchoolBrief, type Text } from "./types";

/** A conversation result opened from "View details", laid out to fit the tool panel without a long scroll. */
export function CardDetail({ card, actions }: { card: Card | null; actions: CardActions }) {
  const { t } = useI18n();
  if (!card || !shownCard(card)) return <ToolPanel label={t("cd.title")}><div className="panel-empty"><p>{t("ws.missingCard")}</p></div></ToolPanel>;
  switch (card.type) {
    case "school_list": case "comparison": return <SchoolPager schools={card.schools} actions={actions} compare={card.type === "comparison"} />;
    case "school": return card.school ? <SchoolDetail school={card.school} actions={actions} /> : null;
    case "cost": return <CostDetail name={card.school.name} estimate={card.estimate} actions={actions} />;
    case "bills": return <BillList card={card} />;
    default: return <SimpleDetail card={card} actions={actions} />;
  }
}

function Snapshot() {
  const { t } = useI18n();
  return <p className="panel-muted">{t("ws.snapshot")}</p>;
}

function SchoolPager({ schools, actions, compare }: { schools: SchoolBrief[]; actions: CardActions; compare: boolean }) {
  const { lang, t } = useI18n();
  const [index, setIndex] = useState(0);
  const school = schools[Math.min(index, schools.length - 1)];
  if (!school) return null;
  const ask = (template: MessageKey) => actions.ask(`${pick(school.name, lang)} ${t(template)}`);
  return <ToolPanel label={t(compare ? "plan.card.compare" : "plan.card.schools")}
    footer={!actions.readOnly && <><button type="button" className="secondary" disabled={actions.busy} onClick={() => ask("plan.card.campusOf")}>{t("plan.card.campusOf")}</button>
      <button type="button" className="primary" disabled={actions.busy} onClick={() => ask("plan.card.costOf")}>{t("plan.card.costOf")}</button></>}>
    <div className="panel-card-head"><h3>{t(compare ? "plan.card.compare" : "plan.card.schools")}</h3>
      <PanelPager index={index} count={schools.length} onChange={setIndex} label={t("cd.schools")} /></div>
    <Snapshot />
    {/* Every school stays in the DOM for find-in-page and assistive search; only the current one shows. */}
    {schools.map((item) => <article key={item.key} className="plan-school panel-view" hidden={item !== school}>
      <div className="panel-card-head"><h3 style={{ color: "var(--text)", fontSize: 20 }}>{pick(item.name, lang)}</h3><span className="panel-tag">{t("plan.sample")}</span></div>
      <p className="panel-muted">{pick(item.city, lang)} · {pick(item.country, lang)} · {t("plan.card.duration", { years: item.duration_years, intake: item.intake })}</p>
      <PanelHero label={t("plan.card.firstYear")} value={money(item.first_year_total, item.currency, lang)}>
        {item.first_year_converted && <span className="panel-muted">≈ {money(item.first_year_converted.amount, item.first_year_converted.currency, lang)}</span>}</PanelHero>
      <PanelFacts items={[[t("plan.card.tuitionYear"), money(item.tuition_per_year, item.currency, lang)], [t("plan.card.livingYear"), money(item.living_per_year, item.currency, lang)]]} />
      <SchoolSources schoolKey={item.key} info={item} />
    </article>)}
    <ol className="panel-dots" aria-hidden="true">{schools.map((item, n) => <li key={item.key} className={n === index ? "is-active" : ""} />)}</ol>
  </ToolPanel>;
}

function SchoolDetail({ school, actions }: { school: CatalogEntry; actions: CardActions }) {
  const { lang, t } = useI18n();
  const [tab, setTab] = useState<"facilities" | "food" | "attractions">("facilities");
  const [page, setPage] = useState(0);
  const name = pick(school.school.name, lang);
  const rows: Place[] = school[tab];
  const shown = usePage(rows, 4, page);
  return <ToolPanel label={name} numbered={false} active={tab} onSelect={(key) => { setTab(key); setPage(0); }}
    steps={[{ key: "facilities", label: t("plan.card.facilities") }, { key: "food", label: t("plan.card.food") }, { key: "attractions", label: t("plan.card.attractions") }]}
    footer={<><a className="panel-link panel-footer-note" href={school.school.website} target="_blank" rel="noreferrer">{t("plan.card.website")} ↗</a>
      {!actions.readOnly && <><button type="button" className="secondary" disabled={actions.busy} onClick={() => actions.ask(`${name} ${t("plan.card.costOf")}`)}>{t("plan.card.costOf")}</button>
        <button type="button" className="primary" disabled={actions.busy} onClick={() => actions.choose(school.key, name)}>{t("plan.card.choose")}</button></>}</>}>
    <div className="panel-card-head"><h3 style={{ color: "var(--text)", fontSize: 20 }}>{name}</h3><span className="panel-tag">{t("plan.sample")}</span></div>
    <p className="panel-muted">{pick(school.school.program, lang)} · {pick(school.school.city, lang)}, {pick(school.school.country, lang)}</p>
    <div className="panel-card-head"><h4 className="panel-muted">{t(`plan.card.${tab}`)} · {rows.length}</h4>
      <PanelPager index={shown.index} count={shown.pages} onChange={setPage} label={t(`plan.card.${tab}`)} /></div>
    <ul className="panel-rows">{shown.rows.map((place) => <li key={place.name.en}>
      <span><strong>{pick(place.name, lang)}</strong><small>{pick(place.note, lang)}</small></span>
      <span className="panel-muted">{[place.distance_km != null ? t("plan.card.km", { km: place.distance_km }) : "", place.typical_cost ? `~${place.typical_cost}` : ""].filter(Boolean).join(" · ")}</span>
    </li>)}</ul>
    <SchoolSources schoolKey={school.key} info={school} />
  </ToolPanel>;
}

function CostDetail({ name, estimate, actions }: { name: Text; estimate: Estimate; actions: CardActions }) {
  const { lang, t } = useI18n();
  const groups = ["tuition", "living", "essentials"] as const;
  const [tab, setTab] = useState<typeof groups[number]>("tuition");
  const [page, setPage] = useState(0);
  const cur = estimate.currency;
  const title = pick(name, lang);
  const lines = usePage(estimate.lines.filter((line) => line.group === tab), 5, page);
  return <ToolPanel label={title} numbered={false} active={tab} onSelect={(key) => { setTab(key); setPage(0); }}
    steps={groups.map((group) => ({ key: group, label: t(`plan.cost.group.${group}`) }))}
    footer={!actions.readOnly && <button type="button" className="primary" disabled={actions.busy} onClick={() => actions.choose(estimate.school_key, title, estimate.years)}>{t("plan.card.choose")}</button>}>
    <div className="panel-card-head"><h3 style={{ color: "var(--text)" }}>{title}</h3><span className="panel-tag">{t("plan.sample")}</span></div>
    <PanelHero label={t("plan.cost.title", { years: estimate.years })} value={money(estimate.total, cur, lang)}>
      <span className="panel-muted">{t("plan.cost.range")}: {money(estimate.total_low, cur, lang)} – {money(estimate.total_high, cur, lang)} · {t("plan.cost.estimated", { share: percent(estimate.estimated_share, lang) })}</span></PanelHero>
    <div className="panel-grid-3">{groups.map((group) => <button type="button" key={group} className={`panel-tile${group === tab ? " is-selected" : ""}`} aria-pressed={group === tab}
      onClick={() => { setTab(group); setPage(0); }}><span>{t(`plan.cost.group.${group}`)}</span><strong>{money(estimate.groups[group], cur, lang)}</strong></button>)}</div>
    <div className="panel-card-head"><h4 className="panel-muted">{t(`plan.cost.group.${tab}`)}</h4>
      <PanelPager index={lines.index} count={lines.pages} onChange={setPage} label={t(`plan.cost.group.${tab}`)} /></div>
    <ul className="panel-rows">{lines.rows.map((line) => <li key={line.cost_id}>
      <span><strong>{pick(line.label, lang)}</strong><small>{line.lower && line.upper ? `${money(line.lower, "", lang)}–${money(line.upper, cur, lang)}` : money(line.amount, cur, lang)} {t(`plan.period.${line.period}` as MessageKey)}
        {line.estimate ? ` · ${t("plan.estimate")}` : ""}</small></span>
      <span>{money(line.total, cur, lang)}</span>
      {!line.estimate && line.source_url && <a className="panel-link" href={line.source_url} target="_blank" rel="noreferrer">{t("plan.sourced")}</a>}
    </li>)}</ul>
  </ToolPanel>;
}

function BillList({ card }: { card: Extract<Card, { type: "bills" }> }) {
  const { lang, t } = useI18n();
  const [page, setPage] = useState(0);
  const shown = usePage(card.bills, 6, page);
  return <ToolPanel label={t("plan.bills.title")}>
    <div className="panel-card-head"><h3>{t("plan.bills.title")}</h3><PanelPager index={shown.index} count={shown.pages} onChange={setPage} label={t("plan.bills.title")} /></div>
    <Snapshot />
    {!card.bills.length ? <p className="panel-muted">{t("plan.bills.none")}</p> : <ul className="panel-rows">{shown.rows.map((bill) => <li key={bill.id}>
      <span><strong>{pick(bill.label, lang)}</strong><small>{day(bill.due_date, lang)}</small></span>
      <span>{money(bill.amount, bill.currency, lang)}</span>
      {bill.status === "PAID" && <span className="status-chip status-confirmed">{t("plan.bills.paid")}</span>}
    </li>)}</ul>}
  </ToolPanel>;
}

function SimpleDetail({ card, actions }: { card: Card; actions: CardActions }) {
  const { lang, t } = useI18n();
  let body: React.ReactNode;
  if (card.type === "plan" || card.type === "loan") {
    const plan = card.plan, cur = plan.currency ?? plan.school?.currency ?? "", loan = plan.loan;
    body = card.type === "loan" && loan ? <>
      <div className="panel-card-head"><h3>{t("plan.loan.title")}</h3><span className="panel-tag">{t("plan.simulated")}</span></div>
      <PanelHero label={t("plan.loan.monthly")} value={money(loan.monthly_payment, loan.currency, lang)} />
      <PanelFacts items={[[t("plan.loan.principal"), money(loan.principal, loan.currency, lang)], [t("plan.loan.months"), t("plan.loan.monthsValue", { months: loan.months })],
        [t("plan.loan.rate"), `${(Number(loan.annual_rate) * 100).toFixed(1)}%`], [t("plan.loan.total"), money(loan.total_repayment, loan.currency, lang)]]} />
      <p className="panel-muted">{t("plan.loan.thb")}</p></> : <>
      <div className="panel-card-head"><h3>{pick(plan.school?.name, lang) || plan.school_key}</h3><span className={`status-chip status-${plan.status.toLowerCase()}`}>{t(`plan.plan.status.${plan.status}`)}</span></div>
      <PanelHero label={t("plan.plan.total")} value={money(plan.total, cur, lang)} />
      <PanelFacts items={[[t("plan.plan.years"), plan.years], [t("plan.plan.start"), day(plan.start_date, lang)]]} /></>;
  } else body = <CardView card={card} actions={actions} />;
  return <ToolPanel label={t("ws.history")}>{body}<Snapshot /></ToolPanel>;
}
