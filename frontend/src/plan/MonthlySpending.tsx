import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { WalletClient } from "../wallet/client";
import { useToolActive, useWorkspace } from "../workspace/context";
import { Bills } from "./cards";
import { money } from "./format";
import { PanelHero, PanelPager, PanelSkeleton, ToolPanel, usePage } from "../workspace/ToolPanel";
import { LineChart } from "../workspace/PanelCharts";
import { spendingSlices } from "./monthly";
import type { InSchool, Spending, SpendingPage } from "./types";
import "./monthly.css";

function amountLabel(amount: string, currency: string, lang: string) {
  return `${new Intl.NumberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount))} ${currency}`;
}

export function SpendingPie({ spending }: { spending: Spending }) {
  const { t, lang } = useI18n();
  const slices = spendingSlices(spending.by_category);
  if (!slices.length) return <p className="monthly-empty">{t("plan.monthly.empty")}</p>;
  const gradient = slices.map(slice => `${slice.color} ${slice.start}% ${slice.end}%`).join(", ");
  return <figure className="monthly-distribution">
    <div className="monthly-pie" role="img" aria-label={t("plan.monthly.shares")}
      style={{ background: `conic-gradient(${gradient})` }} />
    <figcaption><ul className="monthly-legend">{slices.map(slice => <li key={slice.category}>
      <span className="monthly-swatch" aria-hidden="true" style={{ background: slice.color }} />
      <span>{t(`plan.cat.${slice.category}` as MessageKey)}<small>{amountLabel(slice.amount, spending.currency, lang)}</small></span>
      <strong>{slice.share.toLocaleString(lang, { maximumFractionDigits: 1 })}%</strong>
    </li>)}</ul></figcaption>
  </figure>;
}

function ExpenseDetails({ page, view }: { page: SpendingPage; view: number }) {
  const { t, lang } = useI18n();
  const rows = usePage(page.entries, ENTRY_PAGE, view).rows;
  return <section aria-label={t("plan.monthly.details")}>
    {!page.entries.length ? <p className="service-muted">{t("plan.monthly.noEntries")}</p> :
      <ul className="monthly-entries panel-rows">{rows.map(entry => <li key={entry.id}>
        <span><strong>{entry.note || t(`plan.cat.${entry.category}` as MessageKey)}</strong>
          <small>{entry.spent_on} · {t(`plan.cat.${entry.category}` as MessageKey)}</small>
          {page.unconverted?.includes(entry.id) && <small className="error">{t("plan.monthly.excluded")}</small>}</span>
        <span>{amountLabel(entry.amount, entry.currency, lang)}</span>
      </li>)}</ul>}
  </section>;
}

const ENTRY_PAGE = 8;

export function MonthlySpending({ client, preview }: { client: WalletClient; preview: boolean }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const active = useToolActive();
  const requestedMonth = workspace?.target?.kind === "spending" ? workspace.target.month : undefined;
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState(0);
  const [tab, setTab] = useState<"overview" | "entries" | "due">("overview");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ page: SpendingPage; school: InSchool } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastMonth = useRef(requestedMonth);
  useEffect(() => {
    if (active && requestedMonth !== lastMonth.current) { setOffset(0); setView(0); setTab("overview"); lastMonth.current = requestedMonth; }
  }, [requestedMonth, active]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("studyflow:write", refresh);
    return () => window.removeEventListener("studyflow:write", refresh);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true); setError("");
    const query = new URLSearchParams({ offset: String(offset) });
    if (requestedMonth) query.set("month", requestedMonth);
    Promise.all([client.get<SpendingPage>(`planning/expenses/?${query}`), client.get<InSchool>("planning/in-school/")])
      .then(([page, school]) => {
        if (!Array.isArray(page.entries)) throw new Error(t("plan.monthly.unavailable"));
        if (alive) setResult({ page, school });
      }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : t("plan.err.generic")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active, client, requestedMonth, offset, revision, t]);
  const page = result?.page;
  const due = result?.school.enrolled ? (result.school.bills ?? result.school.upcoming_bills)
    .filter(bill => bill.status === "DUE" && page && bill.due_date.startsWith(page.month)) : [];
  const views = page ? Math.max(1, Math.ceil(page.entries.length / ENTRY_PAGE)) : 1;
  const used = page && Number(page.budget) > 0 ? Math.min(100, Number(page.spent) / Number(page.budget) * 100) : 0;
  // Cumulative spending by day, only when the whole month is loaded and every entry is in the summary currency.
  const complete = !!page && offset === 0 && page.entries.length === page.count && page.entries.every(entry => entry.currency === page.currency && !page.unconverted?.includes(entry.id));
  const curve = (() => {
    if (!page || !complete || !page.entries.length) return [];
    const [y, m] = page.month.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    const daily = Array.from({ length: days }, () => 0);
    for (const entry of page.entries) { const day = Number(entry.spent_on.slice(8, 10)); if (day >= 1 && day <= days) daily[day - 1] += Number(entry.amount); }
    const last = Math.max(...page.entries.map(entry => Number(entry.spent_on.slice(8, 10))));
    let sum = 0;
    return [0, ...daily.slice(0, last).map(value => (sum += value))];
  })();
  // Entries arrive 50 at a time; the panel pages through each batch eight rows at a time.
  const batch = page && page.count > 50 && <nav className="monthly-pagination panel-row" aria-label={t("plan.monthly.pages")}>
    <span className="panel-muted">{t("ms.batch", { from: offset + 1, to: offset + page.entries.length, total: page.count })}</span>
    <span><button className="panel-link" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 50)); setView(0); }}>{t("ms.earlier")}</button>{" "}
      <button className="panel-link" disabled={page.next_offset === null} onClick={() => { setOffset(page.next_offset ?? 0); setView(0); }}>{t("ms.later")}</button></span>
  </nav>;
  return <article className="monthly-report" aria-busy={loading}>
    <ToolPanel label={t("plan.monthly.title")} numbered={false} active={tab} onSelect={setTab}
      aside={page && tab === "overview" && page.entries.length > 0 ? <><h3 className="panel-section-title">{t("plan.monthly.details")} <span>{page.count}</span></h3>
        <ul className="panel-rows">{page.entries.map(entry => <li key={entry.id}><span><strong>{entry.note || t(`plan.cat.${entry.category}` as MessageKey)}</strong><small>{entry.spent_on}</small></span>
          <span>{amountLabel(entry.amount, entry.currency, lang)}</span></li>)}</ul></> : undefined}
      steps={page ? [{ key: "overview", label: t("ms.tab.overview") }, { key: "entries", label: `${t("ms.tab.entries")} ${page.count}` }, { key: "due", label: t("ms.tab.due") }] : []}>
      {loading && !result ? <PanelSkeleton rows={4} /> : error ?
        <p role="alert">{error} <button className="chip" onClick={() => setRevision(value => value + 1)}>{t("common.refresh")}</button></p> : page && result && <>
          <div className="panel-view" hidden={tab !== "overview"}>
            <div className="panel-card-head"><h2>{t("plan.spending.title", { month: page.month })}</h2><span className="panel-tag">{t("plan.simulated")}</span></div>
            <PanelHero label={t("plan.spending.spent")} value={money(page.spent, page.currency, lang)}>
              <div className="panel-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used)} aria-label={t("plan.spending.spent")}>
                <span style={{ width: `${used}%` }} className={page.over_budget ? "is-over" : ""} /></div></PanelHero>
            <div className="panel-grid-2">
              <div className="panel-tile"><span>{t("plan.spending.budget")}</span><strong>{money(page.budget, page.currency, lang)}</strong></div>
              <div className="panel-tile"><span>{t("plan.spending.remaining")}</span><strong className={page.over_budget ? "plan-gap" : ""}>{money(page.remaining, page.currency, lang)}</strong></div>
            </div>
            {curve.length > 1 ? <div className="fx-figure"><div className="panel-section-title">{t("ms.pace")}<small>{t("ms.paceNote")}</small></div>
              <LineChart label={t("ms.pace")} points={curve} pace={Number(page.budget) * (curve.length - 1) / new Date(Number(page.month.slice(0, 4)), Number(page.month.slice(5, 7)), 0).getDate()}
                max={Math.max(Number(page.spent), Number(page.budget) * (curve.length - 1) / new Date(Number(page.month.slice(0, 4)), Number(page.month.slice(5, 7)), 0).getDate())} height={72} /></div>
              : page.count > 0 && !complete && <p className="panel-muted">{t("ms.paceIncomplete")}</p>}
            <SpendingPie spending={page} />
            {!!page.unconverted?.length && <p role="status" className="panel-note is-warn">{t("plan.monthly.unconverted", { n: page.unconverted.length })}</p>}
            <p className="panel-muted">{t("plan.monthly.scope", { currency: page.currency })}{preview && ` ${t("plan.monthly.preview")}`}</p>
          </div>
          <div className="panel-view" hidden={tab !== "entries"}>
            <div className="panel-card-head"><h3>{t("plan.monthly.details")} <small>({page.count})</small></h3>
              <PanelPager index={Math.min(view, views - 1)} count={views} onChange={setView} label={t("plan.monthly.pages")} /></div>
            <ExpenseDetails page={page} view={view} />
            {batch}
          </div>
          <div className="panel-view" hidden={tab !== "due"}>
            <h3 className="panel-card-head">{t("plan.monthly.due")}</h3>
            <Bills bills={due} />
          </div>
        </>}
    </ToolPanel>
  </article>;
}
