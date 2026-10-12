import { useEffect, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { WalletClient } from "../wallet/client";
import { useToolActive, useWorkspace } from "../workspace/context";
import { Bills, SpendingFacts } from "./cards";
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

function ExpenseDetails({ page }: { page: SpendingPage }) {
  const { t, lang } = useI18n();
  return <section aria-label={t("plan.monthly.details")}>
    <h3>{t("plan.monthly.details")} <small>({page.count})</small></h3>
    {!page.entries.length ? <p className="service-muted">{t("plan.monthly.noEntries")}</p> :
      <ul className="monthly-entries">{page.entries.map(entry => <li key={entry.id}>
        <div><strong>{entry.note || t(`plan.cat.${entry.category}` as MessageKey)}</strong>
          <small>{entry.spent_on} · {t(`plan.cat.${entry.category}` as MessageKey)}</small>
          {page.unconverted?.includes(entry.id) && <small className="error">{t("plan.monthly.excluded")}</small>}</div>
        <span>{amountLabel(entry.amount, entry.currency, lang)}</span>
      </li>)}</ul>}
  </section>;
}

export function MonthlySpending({ client, preview }: { client: WalletClient; preview: boolean }) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const active = useToolActive();
  const requestedMonth = workspace?.target?.kind === "spending" ? workspace.target.month : undefined;
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ page: SpendingPage; school: InSchool } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lastMonth = useRef(requestedMonth);
  useEffect(() => {
    if (active && requestedMonth !== lastMonth.current) { setOffset(0); lastMonth.current = requestedMonth; }
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
  return <article className="monthly-report" aria-busy={loading}>
    {loading ? <p role="status">{t("common.loading")}</p> : error ?
      <p role="alert">{error} <button className="chip" onClick={() => setRevision(value => value + 1)}>{t("common.refresh")}</button></p> : result && <>
        <header><h2>{t("plan.spending.title", { month: result.page.month })}</h2><span className="plan-badge">{t("plan.simulated")}</span></header>
        <p className="service-muted">{t("plan.monthly.scope", { currency: result.page.currency })}</p>
        {preview && <p className="service-muted">{t("plan.monthly.preview")}</p>}
        <SpendingFacts spending={result.page} showCategories={false} />
        <h3>{t("plan.monthly.shares")}</h3><SpendingPie spending={result.page} />
        {!!result.page.unconverted?.length && <p role="status" className="error">{t("plan.monthly.unconverted", { n: result.page.unconverted.length })}</p>}
        <ExpenseDetails page={result.page} />
        <nav className="monthly-pagination" aria-label={t("plan.monthly.pages")}>
          <button className="chip" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{t("plan.monthly.previous")}</button>
          <span>{Math.floor(offset / 50) + 1} / {Math.max(1, Math.ceil(result.page.count / 50))}</span>
          <button className="chip" disabled={result.page.next_offset === null} onClick={() => setOffset(result.page.next_offset ?? 0)}>{t("plan.monthly.next")}</button>
        </nav>
        <h3>{t("plan.monthly.due")}</h3>
        <Bills bills={result.school.enrolled ? (result.school.bills ?? result.school.upcoming_bills)
          .filter(bill => bill.status === "DUE" && bill.due_date.startsWith(result.page.month)) : []} />
      </>}
  </article>;
}
