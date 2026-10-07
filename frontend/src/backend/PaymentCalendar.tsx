import type { Cost, ForecastResult, FundingSource, Run } from "./contracts";
import { explainCode, formatDate, formatMoney } from "./presenters";

type Props = {
  forecast: Run<ForecastResult> | null;
  current: boolean;
  costs: Cost[];
  sources: FundingSource[];
  busy: boolean;
  onUpdate: () => void;
};

const amount = (value: string | null | undefined, currency: string) =>
  value == null ? "Amount missing" : formatMoney(value, currency);

const dateLabel = (value: string | null | undefined) => {
  return value ? formatDate(value) : "Date missing";
};

export function PaymentCalendar({ forecast, current, costs, sources, busy, onUpdate }: Props) {
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
        <h2 id="payment-calendar-title">Payment calendar</h2>
        <p>See when planned costs fall due and where the backend expects a reserve gap. Funding dates are shown separately below.</p>
      </div>
      <button className="secondary" disabled={busy} onClick={onUpdate}>Update 90-day calendar</button>
    </div>
    {!result ? <div className="calendar-empty">Request a 90-day forecast to see dated costs and projected balances.</div> : <>
      {!current && <div className="stale-banner" role="status"><strong>Update needed</strong><span>Your saved information changed. Update the calendar before relying on these figures.</span></div>}
      <div className="calendar-summary" aria-label="Backend forecast summary">
        <div><span>Forecast through</span><strong>{dateLabel(result.end_date)}</strong></div>
        <div><span>First reserve gap</span><strong>{result.first_gap_date ? dateLabel(result.first_gap_date) : "None reported"}</strong></div>
        <div><span>Largest reserve gap</span><strong>{amount(result.maximum_reserve_gap, result.currency)}</strong></div>
        <div><span>Ending balance</span><strong>{amount(result.ending_balance, result.currency)}</strong></div>
      </div>
      <p className="calendar-status">Backend forecast: {result.complete ? "complete under its assumptions" : "incomplete"}{result.conditional ? " · includes conditional income" : " · unconfirmed income excluded"}. These are backend results, not browser calculations.</p>
      {(!result.complete || result.missing_event_ids.length > 0 || result.budget_issues.length > 0 || (result.data_issues?.length ?? 0) > 0) &&
        <div className="calendar-attention" role="status"><strong>Needs attention</strong><p>Missing or uncertain inputs may change this forecast. Review the items below and the budget issues.</p>
          {result.missing_event_ids.length > 0 && <p>{result.missing_event_ids.length} scheduled item(s) lack enough information. Check the costs listed below.</p>}
          {result.budget_issues.length > 0 && <ul>{result.budget_issues.map((issue) => <li key={issue}>{explainCode(issue)}</li>)}</ul>}
          {!!result.data_issues?.length && <ul>{result.data_issues.map((issue) => <li key={issue}>{explainCode(issue)}</li>)}</ul>}
          <details><summary>View backend issue codes</summary><p>{[...result.missing_event_ids, ...result.budget_issues, ...(result.data_issues ?? [])].join(", ")}</p></details>
        </div>}
      <h3>Scheduled costs and income</h3>
      {groups.size ? <ol className="calendar-days">{[...groups].map(([date, events]) => <li key={date}>
        <h4>{dateLabel(date)}</h4>
        <ul>{events.map((event) => <li key={event.id} className="calendar-event">
          <div><strong>{event.label}</strong><span className="calendar-pill">{event.kind === "income" ? "Income" : "Cost"} · {event.certainty}</span></div>
          <p>{amount(event.amount, result.currency)} · Balance after: {amount(event.balance_after, result.currency)} · Reserve gap: {amount(event.reserve_gap, result.currency)}</p>
        </li>)}</ul>
      </li>)}</ol> : <p className="calendar-empty">No dated events were returned for this forecast window.</p>}
      <details><summary>View forecast assumptions</summary><ul>{result.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
    </>}
    {attention.length > 0 && <div className="calendar-pending"><h3>Costs without a complete schedule</h3><p>These costs have no usable amount or due date. They have not been filled with zero.</p><ul>{attention.map((cost) => <li key={cost.cost_id}><strong>{cost.component || cost.category}</strong><span>{amount(cost.amount, cost.currency || "THB")} · {cost.period === "monthly" ? "Monthly" : dateLabel(cost.due_date)}</span></li>)}</ul></div>}
    <div className="calendar-funding"><h3>Funding dates to verify</h3><p>These sources are listed separately from the forecast. A promise is not received cash, and this view does not add it to a balance.</p>
      {datedSources.length ? <ul>{datedSources.map((source) => <li key={source.id}><span>{dateLabel(source.available_on)}</span><strong>{source.kind}</strong><span>{amount(source.amount, source.currency)}</span><span className="calendar-pill">{source.received ? "Received" : `Not received · ${source.certainty}`}</span></li>)}</ul> : <p className="calendar-empty">No funding sources have been saved yet.</p>}
    </div>
  </section>;
}
