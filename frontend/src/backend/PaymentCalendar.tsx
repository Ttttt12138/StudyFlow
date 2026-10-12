import { useI18n } from "../i18n";
import type { Cost, ForecastResult, FundingSource, Run } from "./contracts";
import { explainCode, formatDate, formatMoney } from "./presenters";

type Props = {
  forecast: Run<ForecastResult> | null;
  current: boolean;
  costs: Cost[];
  sources: FundingSource[];
  busy: boolean;
  preview?: boolean;
  onUpdate: () => void;
};

export function PaymentCalendar({ forecast, current, costs, sources, busy, preview = false, onUpdate }: Props) {
  const { lang, t } = useI18n();
  const amount = (value: string | null | undefined, currency: string) =>
    value == null ? t("cal.amountMissing") : formatMoney(value, currency, lang);
  const dateLabel = (value: string | null | undefined) => {
    return value ? formatDate(value, lang) : t("cal.dateMissing");
  };
  const result = forecast?.result;
  const attention = costs.filter((cost) =>
    cost.applicability !== "NOT_APPLICABLE" && !cost.paid &&
    (cost.amount == null || (cost.period !== "monthly" && !cost.due_date)),
  );
  const groups = new Map<string, NonNullable<typeof result>["timeline"]>();
  for (const event of result?.timeline ?? []) {
    const day = groups.get(event.date) ?? [];
    day.push(event);
    groups.set(event.date, day);
  }
  const datedSources = [...sources].sort((a, b) =>
    (a.available_on || "9999").localeCompare(b.available_on || "9999"),
  );

  return <section className="card backend-section payment-calendar" aria-labelledby="payment-calendar-title">
    <div className="calendar-top">
      <div>
        <h2 id="payment-calendar-title">{t("cal.title")}</h2>
        <p>{t("cal.intro")}</p>
      </div>
      {!preview && <button className="secondary" disabled={busy} onClick={onUpdate}>{t("cal.update")}</button>}
    </div>
    {!result ? <div className="calendar-empty">{t("cal.empty")}</div> : <>
      {!current && <div className="stale-banner" role="status"><strong>{t("cal.stale.title")}</strong><span>{t("cal.stale.text")}</span></div>}
      <div className="calendar-summary" aria-label={t("cal.summary")}>
        <div><span>{t("cal.through")}</span><strong>{dateLabel(result.end_date)}</strong></div>
        <div><span>{t("cal.firstGap")}</span><strong>{result.first_gap_date ? dateLabel(result.first_gap_date) : t("cal.noneReported")}</strong></div>
        <div><span>{t("cal.largestGap")}</span><strong>{amount(result.maximum_reserve_gap, result.currency)}</strong></div>
        <div><span>{t("cal.ending")}</span><strong>{amount(result.ending_balance, result.currency)}</strong></div>
      </div>
      <p className="calendar-status">{t("cal.statusLine", { state: result.complete ? t("cal.complete") : t("cal.incomplete"), income: result.conditional ? t("cal.conditional") : t("cal.unconfirmed") })}</p>
      {(!result.complete || result.missing_event_ids.length > 0 || result.budget_issues.length > 0 || (result.data_issues?.length ?? 0) > 0) &&
        <div className="calendar-attention" role="status"><strong>{t("cal.attention")}</strong><p>{t("cal.attentionText")}</p>
          {result.missing_event_ids.length > 0 && <p>{t("cal.missingEvents", { count: result.missing_event_ids.length })}</p>}
          {result.budget_issues.length > 0 && <ul>{result.budget_issues.map((issue, n) => <li key={`${issue}-${n}`}>{explainCode(issue, lang)}</li>)}</ul>}
          {!!result.data_issues?.length && <ul>{result.data_issues.map((issue, n) => <li key={`${issue}-${n}`}>{explainCode(issue, lang)}</li>)}</ul>}
          <details><summary>{t("cal.codes")}</summary><p>{[...result.missing_event_ids, ...result.budget_issues, ...(result.data_issues ?? [])].join(", ")}</p></details>
        </div>}
      <h3>{t("cal.scheduled")}</h3>
      {groups.size ? <ol className="calendar-days">{[...groups].map(([date, events]) => <li key={date}>
        <h4>{dateLabel(date)}</h4>
        <ul>{events.map((event) => <li key={event.id} className="calendar-event">
          <div><strong>{event.label}</strong><span className="calendar-pill">{event.kind === "income" ? t("cal.income") : t("cal.cost")} · {event.certainty}</span></div>
          <p>{t("cal.eventLine", { amount: amount(event.amount, result.currency), balance: amount(event.balance_after, result.currency), gap: amount(event.reserve_gap, result.currency) })}</p>
        </li>)}</ul>
      </li>)}</ol> : <p className="calendar-empty">{t("cal.noEvents")}</p>}
      <details><summary>{t("cal.assumptions")}</summary><ul>{result.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    </>}
    {attention.length > 0 && <div className="calendar-pending"><h3>{t("cal.pending.title")}</h3><p>{t("cal.pending.text")}</p><ul>{attention.map((cost) => <li key={cost.cost_id}><strong>{cost.component || cost.category}</strong><span>{amount(cost.amount, cost.currency || "THB")} · {cost.period === "monthly" ? t("cal.monthly") : dateLabel(cost.due_date)}</span></li>)}</ul></div>}
    <div className="calendar-funding"><h3>{t("cal.funding.title")}</h3><p>{t("cal.funding.text")}</p>
      {datedSources.length ? <ul>{datedSources.map((source) => <li key={source.id}><span>{dateLabel(source.available_on)}</span><strong>{source.kind}</strong><span>{amount(source.amount, source.currency)}</span><span className="calendar-pill">{source.received ? t("plan.received") : t("cal.notReceived", { certainty: source.certainty })}</span></li>)}</ul> : <p className="calendar-empty">{t("cal.noSources")}</p>}
    </div>
  </section>;
}
