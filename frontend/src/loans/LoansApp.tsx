import { useToolRefresh, useToolActive, useClearWhenHidden, useWorkspace } from "../workspace/context";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ServiceShell, ServiceSection } from "../services/ServiceShell";
import { ModuleNavContext } from "../services/ModuleNav";
import { TierBadge } from "../services/TierBadge";
import { Amount } from "../services/Amount";
import { usePolicyAction } from "../services/usePolicyAction";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadLoans } from "./client";
import { canCancel, defaultFirstDue, effectiveAnnualRate, fractionToPercent, MONEY_PATTERN, nextDueDate, nextInstallment, percentToFraction,
  profileCoverage, repayEligibility, repaymentMonths, statusTone } from "./logic";
import { createLoansPreview } from "./previewAdapter";
import type { LoanAccount, LoanApplication, LoanQuote, LoansSnapshot, ProfileMonth } from "./types";
import "../wallet/wallet.css";
import "./loans.css";

const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/?loans=1")}`;
const initial: LoansSnapshot = { applications: [], quotes: [], profile: null, accounts: [], disbursements: [], wallet: null, errors: {} };
const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);
type Row = { key: string; month: string; income: string; living_expenses: string; existing_repayments: string };
const FIELDS = ["income", "living_expenses", "existing_repayments"] as const;
const toRows = (months: ProfileMonth[]): Row[] => months.map((m, n) => ({ key: `r${n}-${m.month}`, month: m.month,
  income: m.income ?? "", living_expenses: m.living_expenses ?? "", existing_repayments: m.existing_repayments ?? "" }));

export function LoansApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const toolActive = useToolActive();
  const nav = useContext(ModuleNavContext);
  const client = useMemo<WalletClient>(() => preview ? createLoansPreview() : new SessionWalletClient(), [preview]);
  const policy = usePolicyAction(client, preview);
  const [snapshot, setSnapshot] = useState<LoansSnapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitCheck, setSubmitCheck] = useState("");
  const [cancelId, setCancelId] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [coverId, setCoverId] = useState("");
  const [form, setForm] = useState({ principal: "60000.00", rate: "6", fees: "1200.00", months: "6", firstDue: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [repayCheck, setRepayCheck] = useState("");
  const [repayAccount, setRepayAccount] = useState("");
  const [clockCheck, setClockCheck] = useState(false);
  const profileVersion = useRef(-1);

  const money = (value: unknown) => formatMoney(value, "THB", lang);
  const date = (value: unknown) => formatDate(value, lang);
  const when = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const message = (reason: unknown) => reason instanceof Error ? reason.message : t("shell.err.generic");
  const signedOut = !preview && /^HTTP (401|403):/.test(snapshot.errors.applications ?? "") && snapshot.applications.length === 0;
  const clock = snapshot.wallet?.clock;
  const quoteOf = (application: LoanApplication) => snapshot.quotes.find((q) => q.id === application.loan);
  const used = new Set(snapshot.applications.map((a) => a.loan));
  // Legacy (pre-B) simulations are read-only in Django, so only B quotes can back a new application.
  const unused = snapshot.quotes.filter((q) => !used.has(q.id) && (q.engine_version ?? "b-monthly-amortization-v1") === "b-monthly-amortization-v1");
  const firstDue = (quote: LoanQuote | undefined) => quote?.result.repayments.find((r) => Number(r.amount) > 0)?.due_date;
  const expired = (quote: LoanQuote | undefined) => !!clock && !!firstDue(quote) && firstDue(quote)! <= clock;
  const shownQuote = unused.find((q) => q.id === quoteId) ?? unused[0];
  const coverable = [...snapshot.applications.filter((a) => canCancel(a)).map(quoteOf), ...unused].filter((q): q is LoanQuote => !!q);
  const cover = coverable.find((q) => q.id === coverId) ?? coverable[0];
  const coverage = profileCoverage(repaymentMonths(cover), rows.map((r) => ({ ...r, income: r.income || null, living_expenses: r.living_expenses || null, existing_repayments: r.existing_repayments || null })));
  const target = nextDueDate(snapshot.accounts);

  const refresh = useCallback(async (api = client) => {
    setLoading(true);
    const result = await loadLoans(api);
    setSnapshot(result);
    // Keep unsaved profile edits across unrelated refreshes; reload them only when Django's profile version moves.
    if (result.profile && result.profile.version !== profileVersion.current) { profileVersion.current = result.profile.version; setRows(toRows(result.profile.months)); }
    setForm((prior) => prior.firstDue ? prior : { ...prior, firstDue: defaultFirstDue(result.wallet?.clock) });
    setLoading(false);
    return result;
  }, [client]);

  useEffect(() => {
    setError(""); setNotice("");
    void refresh().catch((reason: unknown) => { setError(message(reason)); setLoading(false); });
  }, [refresh]);

  async function perform(action: () => Promise<void>) {
    if (preview) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) {
        await refresh().catch(() => {});
        setError(t("shell.err.changed"));
      } else if (reason instanceof WalletApiError && ["INSTALLMENT_NOT_DUE", "INSTALLMENT_NOT_PAYABLE", "INSUFFICIENT_BALANCE", "LOAN_CLOSED", "QUOTE_EXPIRED"].includes(reason.code)) {
        await refresh().catch(() => {});
        setError(`${reason.message} ${t(`loans.err.${reason.code}` as MessageKey)}`);
      } else setError(message(reason));
    } finally { setBusy(false); }
  }

  async function act(application: LoanApplication, action: "submit" | "cancel") {
    await perform(async () => {
      const updated = await client.post<LoanApplication>(`applications/${application.id}/action/`, { expected_version: application.version, action },
        `application-${action}:${application.id}:${application.version}`);
      await refresh(); setSubmitCheck(""); setCancelId("");
      setNotice(t(action === "submit" ? "loans.notice.submitted" : "loans.notice.cancelled", { status: t(`loans.status.${updated.status}` as MessageKey) }));
    });
  }

  async function createQuote() {
    const annual_rate = percentToFraction(form.rate);
    if (!annual_rate || !MONEY_PATTERN.test(form.principal) || !MONEY_PATTERN.test(form.fees) || !/^\d+$/.test(form.months) || !form.firstDue) {
      setError(t("loans.err.quoteForm")); return;
    }
    const body = { currency: "THB", principal: form.principal, annual_rate, fees: form.fees, months: Number(form.months), first_due_date: form.firstDue };
    await perform(async () => {
      let created: LoanQuote;
      try { created = await client.post<LoanQuote>("loans/", body, "loan-quote"); }
      catch (reason) {
        // A lost response may still have stored the quote; look for one with these exact terms.
        if (lost(reason)) {
          const result = await refresh();
          const match = result.quotes.find((q) => Number(q.inputs.principal) === Number(body.principal) && Number(q.inputs.annual_rate) === Number(annual_rate)
            && Number(q.inputs.fees) === Number(body.fees) && q.inputs.months === body.months && q.inputs.first_due_date === body.first_due_date);
          if (match) { setQuoteId(match.id); setNotice(t("loans.notice.quoted")); return; }
        }
        throw reason;
      }
      await refresh(); setQuoteId(created.id); setCoverId(created.id);
      setNotice(t("loans.notice.quoted"));
    });
  }

  async function apply(quote: LoanQuote) {
    await perform(async () => {
      try { await client.post<LoanApplication>("applications/", { quote_id: quote.id }, `loan-application:${quote.id}`); }
      catch (reason) {
        // One application per quote, so the lookup after a lost response is exact.
        if (lost(reason) && (await refresh()).applications.some((a) => a.loan === quote.id)) { setNotice(t("loans.notice.applied")); return; }
        throw reason;
      }
      await refresh(); setNotice(t("loans.notice.applied"));
    });
  }

  function editRow(key: string, patch: Partial<Row>) { setRows((prior) => prior.map((r) => r.key === key ? { ...r, ...patch } : r)); }
  function addMissing() {
    setRows((prior) => [...prior, ...coverage.missing.map((month) => ({ key: `n-${month}-${Date.now()}`, month, income: "", living_expenses: "", existing_repayments: "" }))]
      .sort((a, b) => a.month.localeCompare(b.month)));
  }

  async function saveProfile() {
    const months = rows.map((r) => ({ month: r.month.trim(), ...Object.fromEntries(FIELDS.map((f) => [f, r[f].trim() || null])) })) as ProfileMonth[];
    const invalid = months.some((m) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month) || FIELDS.some((f) => m[f] !== null && !MONEY_PATTERN.test(m[f]!)));
    if (invalid) { setError(t("loans.err.profileForm")); return; }
    if (new Set(months.map((m) => m.month)).size !== months.length) { setError(t("loans.err.duplicateMonth")); return; }
    const version = snapshot.profile?.version ?? 0;
    await perform(async () => {
      await client.post("affordability-profile/", { expected_version: version, months }, `affordability-profile:${version}`);
      await refresh(); setNotice(t("loans.notice.profileSaved"));
    });
  }

  async function repay(account: LoanAccount, number: number, amount: string) {
    setRepayAccount(account.id);
    const send = async (token?: string) => {
      await client.post(`loan-accounts/${account.id}/repay/`, { expected_version: account.version, installment_number: number },
        `loan-repay:${account.id}:${account.version}:${number}`, token ? { "X-Step-Up-Token": token } : {});
      await refresh(); setRepayCheck("");
      setNotice(t("loans.notice.repaid", { number, amount: money(amount) }));
    };
    await perform(async () => {
      try { await policy.run({ action: "loan.repay", target_id: account.id, amount, currency: "THB" }, send); }
      catch (reason) {
        if (lost(reason)) { await refresh().catch(() => {}); setError(t("shell.err.lost")); return; }
        throw reason;
      }
    });
  }

  async function moveClock(day: string) {
    await perform(async () => {
      await client.post("demo/clock/", { date: day }, `demo-clock:${day}`);
      await refresh(); setClockCheck(false);
      setNotice(t("loans.notice.clockMoved", { date: date(day) }));
    });
  }

  const chip = (status: string) => <span className={`status-chip status-${statusTone(status)}`}>{t(`loans.status.${status}` as MessageKey)}</span>;
  const quoteFacts = (quote: LoanQuote) => {
    const r = quote.result;
    const apr = effectiveAnnualRate(r.net_proceeds, r.repayments);
    return <dl className="comparison-facts">
      <div><dt>{t("loans.quote.principal")}</dt><dd>{money(r.principal)}</dd></div>
      <div><dt>{t("loans.quote.net")}</dt><dd>{money(r.net_proceeds)}</dd></div>
      <div><dt>{t("loans.quote.fees")}</dt><dd>{money(r.fees)}</dd></div>
      <div><dt>{t("loans.quote.rate")}</dt><dd>{fractionToPercent(quote.inputs.annual_rate)}</dd></div>
      <div><dt>{t("loans.quote.installment")}</dt><dd>{money(r.repayments[0]?.amount)}</dd></div>
      <div><dt>{t("loans.quote.months")}</dt><dd>{r.repayments.length}</dd></div>
      <div><dt>{t("loans.quote.firstDue")}</dt><dd>{date(firstDue(quote))}</dd></div>
      <div><dt>{t("loans.quote.totalRepay")}</dt><dd>{money(r.total_repayment)}</dd></div>
      <div><dt>{t("loans.quote.totalCost")}</dt><dd>{money(r.total_cost_over_net_proceeds ?? (Number(r.total_repayment) - Number(r.net_proceeds)).toFixed(2))}
        {apr !== null && <small> · {t("loans.quote.effective", { rate: `${(apr * 100).toFixed(2)}%` })}</small>}</dd></div>
    </dl>;
  };
  const schedule = (quote: LoanQuote) => <details className="loans-schedule">
    <summary>{t("loans.quote.schedule")}</summary>
    <div className="table-scroll"><table className="service-table">
      <thead><tr><th>#</th><th>{t("loans.inst.due")}</th><th>{t("loans.inst.amount")}</th><th>{t("loans.inst.principal")}</th><th>{t("loans.quote.interest")}</th><th>{t("loans.quote.remaining")}</th></tr></thead>
      <tbody>{quote.result.repayments.map((r) => <tr key={r.number}><td>{r.number}</td><td>{date(r.due_date)}</td><td>{money(r.amount)}</td><td>{money(r.principal)}</td><td>{money(r.interest)}</td><td>{money(r.remaining_principal)}</td></tr>)}</tbody>
    </table></div>
  </details>;
  const nextStep = (application: LoanApplication) => {
    if (application.status === "UNDER_REVIEW") return <p className="service-notice">{t("loans.next.UNDER_REVIEW")}
      {application.assessment.status === "INSUFFICIENT_DATA" && <> {t("loans.next.insufficient")} <a href="#loans-profile" onClick={() => setCoverId(application.loan)}>{t("loans.next.profileLink")}</a></>}</p>;
    return <p className="service-notice">{t(`loans.next.${application.status}` as MessageKey)}</p>;
  };

  const sections = [
    { id: "loans-applications", label: t("loans.apps.title") }, { id: "loans-quote", label: t("loans.quote.title") },
    { id: "loans-profile", label: t("loans.profile.title") }, { id: "loans-accounts", label: t("loans.accounts.title") },
    { id: "loans-disbursements", label: t("loans.disb.title") }, { id: "loans-clock", label: t("loans.clock.title") },
  ];

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="loans-app" eyebrow={t("loans.eyebrow")} title={t("loans.title")} intro={t("loans.intro")} sideLabel={t("loans.side.label")}
      sections={sections} noteTitle={t("loans.side.noteTitle")} noteText={t("loans.side.noteText")} preview={preview}
      previewTitle={t("loans.preview.title")} previewText={t("loans.preview.text")} bannerText={t("loans.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("loans.signedOut")} onExit={onExit}
      onRefresh={() => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
      {error && <div className="stale-banner" role="alert">{error}</div>}
      {notice && <div className="demo" role="status">{notice}</div>}
      <p className="loans-origin">{t("link.loansBack")} <button type="button" className="secondary" onClick={() => nav?.open("home", nav.preview)}>{t("link.loansBackAction")}</button></p>

      <ServiceSection id="loans-applications" title={t("loans.apps.title")} text={t("loans.apps.text")} tier={<TierBadge tier="T1" />}>
        {snapshot.errors.applications && !signedOut && <p className="error">{snapshot.errors.applications}</p>}
        {snapshot.applications.length === 0 ? <p>{t("loans.apps.none")}</p> : <div className="loans-stack">
          {snapshot.applications.map((application) => {
            const quote = quoteOf(application);
            const a = application.assessment;
            return <article key={application.id} className="loans-item" aria-labelledby={`app-${application.id}`}>
              <div className="service-title-row">
                <h3 id={`app-${application.id}`}>{t("loans.apps.item", { id: application.id.slice(0, 8), date: when(application.created_at) })}</h3>
                {chip(application.status)}
              </div>
              <p className="service-muted">{a.status ? <>{t("loans.apps.assessment")} <strong>{t(`loans.assess.${a.status}` as MessageKey)}</strong>
                {a.missing_inputs?.length ? ` · ${t("loans.apps.missing", { months: [...new Set(a.missing_inputs.map((m) => m.slice(0, 7)))].join(", ") })}` : ""}
                {a.shortfall_months?.length ? ` · ${t("loans.apps.shortfall", { months: a.shortfall_months.join(", ") })}` : ""}</> : t("loans.apps.notAssessed")}</p>
              {application.decision_reason && <p className="service-muted">{t("loans.apps.reason", { reason: application.decision_reason })}</p>}
              {quote ? <>{quoteFacts(quote)}{schedule(quote)}</> : <p className="service-muted">{snapshot.errors.quotes ?? t("loans.apps.noQuote")}</p>}
              {nextStep(application)}
              {application.status === "DRAFT" && <div className="service-policy">
                <h4><TierBadge tier="T1" /> {t("loans.submit.title")}</h4>
                {expired(quote) && <p className="error">{t("loans.submit.expired")}</p>}
                <label className="wallet-confirm"><input type="checkbox" checked={submitCheck === application.id} disabled={preview}
                  onChange={(event) => setSubmitCheck(event.target.checked ? application.id : "")} />{t("loans.submit.check")}</label>
                <div className="service-actions">
                  <button className="primary" disabled={preview || busy || submitCheck !== application.id} onClick={() => void act(application, "submit")}>{t("loans.submit.button")}</button>
                </div>
              </div>}
              {canCancel(application) && (cancelId === application.id ? <div className="service-policy" role="group" aria-label={t("loans.cancel.label")}>
                <p>{t("loans.cancel.confirm")}</p>
                <div className="service-actions">
                  <button className="primary" disabled={preview || busy} onClick={() => void act(application, "cancel")}>{t("loans.cancel.yes")}</button>
                  <button className="secondary" disabled={busy} onClick={() => setCancelId("")}>{t("loans.cancel.no")}</button>
                </div>
              </div> : <div className="service-actions">
                <button className="secondary" disabled={preview || busy} onClick={() => setCancelId(application.id)}>{t("loans.cancel.button")}</button>
              </div>)}
            </article>;
          })}
        </div>}
      </ServiceSection>

      <ServiceSection id="loans-quote" title={t("loans.quote.title")} text={t("loans.quote.text")} tier={<TierBadge tier="T1" />}>
        <form className="wallet-form-row loans-form" onSubmit={(event) => { event.preventDefault(); void createQuote(); }}>
          <label>{t("loans.form.principal")}<input inputMode="decimal" value={form.principal} disabled={preview} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></label>
          <label>{t("loans.form.rate")}<input inputMode="decimal" value={form.rate} disabled={preview} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
          <label>{t("loans.form.fees")}<input inputMode="decimal" value={form.fees} disabled={preview} onChange={(e) => setForm({ ...form, fees: e.target.value })} /></label>
          <label>{t("loans.form.months")}<input type="number" min={1} max={60} value={form.months} disabled={preview} onChange={(e) => setForm({ ...form, months: e.target.value })} /></label>
          <label>{t("loans.form.firstDue")}<input type="date" value={form.firstDue} min={clock} disabled={preview} onChange={(e) => setForm({ ...form, firstDue: e.target.value })} /></label>
          <button type="submit" className="primary" disabled={preview || busy}>{t("loans.form.create")}</button>
        </form>
        <p className="service-muted">{t("loans.form.rateHint", { fraction: percentToFraction(form.rate) ?? "—" })}{clock && ` ${t("loans.form.dueHint", { date: date(clock) })}`}</p>
        {snapshot.errors.quotes && !signedOut && <p className="error">{snapshot.errors.quotes}</p>}
        {unused.length > 0 && <>
          <h3>{t("loans.quote.unused")}</h3>
          {unused.length > 1 && <label className="service-inline-field">{t("loans.quote.pick")}
            <select value={shownQuote?.id} onChange={(e) => setQuoteId(e.target.value)}>
              {unused.map((q) => <option key={q.id} value={q.id}>{`${money(q.result.principal)} · ${q.result.repayments.length} · ${when(q.created_at)}`}</option>)}
            </select></label>}
          {shownQuote && <div className="loans-item">
            {quoteFacts(shownQuote)}{schedule(shownQuote)}
            {expired(shownQuote) && <p className="error">{t("loans.submit.expired")}</p>}
            <div className="service-actions">
              <button className="primary" disabled={preview || busy || expired(shownQuote)} onClick={() => void apply(shownQuote)}>{t("loans.quote.apply")}</button>
              <span className="service-muted">{t("loans.quote.applyHint")}</span>
            </div>
          </div>}
        </>}
      </ServiceSection>

      <ServiceSection id="loans-profile" title={t("loans.profile.title")} text={t("loans.profile.text")} tier={<TierBadge tier="T1" />}>
        {snapshot.errors.profile && !signedOut && <p className="error">{snapshot.errors.profile}</p>}
        {coverable.length > 0 && <label className="service-inline-field">{t("loans.profile.for")}
          <select value={cover?.id} onChange={(e) => setCoverId(e.target.value)}>
            {coverable.map((q) => <option key={q.id} value={q.id}>{`${money(q.result.principal)} · ${repaymentMonths(q).join(", ")}`}</option>)}
          </select></label>}
        {cover && <p className={coverage.complete ? "service-notice" : "service-alert"}>{coverage.complete ? t("loans.profile.covered", { count: coverage.needed.length })
          : t("loans.profile.gaps", { missing: coverage.missing.join(", ") || "—", incomplete: coverage.incomplete.join(", ") || "—" })}</p>}
        {rows.length === 0 ? <p>{t("loans.profile.none")}</p> : <div className="loans-months">
          {rows.map((row) => <fieldset key={row.key} className="loans-month">
            <legend>{row.month || t("loans.profile.newMonth")}</legend>
            <label>{t("loans.profile.month")}<input value={row.month} placeholder="YYYY-MM" disabled={preview} onChange={(e) => editRow(row.key, { month: e.target.value })} /></label>
            {FIELDS.map((field) => <label key={field}>{t(`loans.profile.${field}` as MessageKey)}<input inputMode="decimal" value={row[field]} disabled={preview}
              onChange={(e) => editRow(row.key, { [field]: e.target.value })} /></label>)}
            <button type="button" className="secondary" disabled={preview} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>{t("loans.profile.remove", { month: row.month })}</button>
          </fieldset>)}
        </div>}
        <div className="service-actions">
          {coverage.missing.length > 0 && <button className="secondary" disabled={preview} onClick={addMissing}>{t("loans.profile.addMissing", { count: coverage.missing.length })}</button>}
          <button className="secondary" disabled={preview} onClick={() => setRows([...rows, { key: `n-${Date.now()}`, month: "", income: "", living_expenses: "", existing_repayments: "" }])}>{t("loans.profile.add")}</button>
          <button className="primary" disabled={preview || busy} onClick={() => void saveProfile()}>{t("loans.profile.save")}</button>
        </div>
        <p className="service-muted">{t("loans.profile.hint", { version: snapshot.profile?.version ?? 0 })}</p>
      </ServiceSection>

      <ServiceSection id="loans-accounts" title={t("loans.accounts.title")} text={t("loans.accounts.text")} tier={<TierBadge tier="T2" />}>
        {snapshot.errors.accounts && !signedOut && <p className="error">{snapshot.errors.accounts}</p>}
        {snapshot.accounts.length === 0 ? <p>{t("loans.accounts.none")}</p> : snapshot.accounts.map((account) => {
          const next = nextInstallment(account);
          const eligibility = next ? repayEligibility(account, next) : "closed";
          const checkKey = next ? `${account.id}:${next.number}:${account.version}` : "";
          return <article key={account.id} className="loans-item" aria-labelledby={`acct-${account.id}`}>
            <div className="service-title-row">
              <h3 id={`acct-${account.id}`}>{t("loans.accounts.item", { id: account.id.slice(0, 8) })}</h3>
              {chip(account.status)}
            </div>
            <dl className="comparison-facts">
              <div><dt>{t("loans.accounts.outstanding")}</dt><dd><Amount text={money(account.outstanding_principal)} /></dd></div>
              <div><dt>{t("loans.accounts.paid")}</dt><dd>{t("loans.accounts.paidCount", { paid: account.installments.filter((i) => i.paid_on).length, total: account.installments.length })}</dd></div>
              <div><dt>{t("loans.accounts.opened")}</dt><dd>{when(account.created_at)}</dd></div>
            </dl>
            <div className="table-scroll"><table className="service-table">
              <caption className="service-muted">{t("loans.inst.caption")}</caption>
              <thead><tr><th>#</th><th>{t("loans.inst.due")}</th><th>{t("loans.inst.amount")}</th><th>{t("loans.inst.principal")}</th><th>{t("loans.inst.status")}</th><th>{t("loans.inst.paidOn")}</th></tr></thead>
              <tbody>{account.installments.map((row) => <tr key={row.number} aria-current={next?.number === row.number ? "true" : undefined}>
                <td>{row.number}</td><td>{date(row.due_on)}</td><td>{money(row.amount)}</td><td>{money(row.principal)}</td><td>{chip(row.status)}</td><td>{row.paid_on ? date(row.paid_on) : "—"}</td>
              </tr>)}</tbody>
            </table></div>
            {next && account.status === "ACTIVE" && <div className="service-policy">
              <h4><TierBadge tier="T2" /> {t("loans.repay.title", { number: next.number })}</h4>
              <p>{t("loans.repay.text", { amount: money(next.amount), date: date(next.due_on) })}</p>
              {eligibility !== "ok" && <p className="service-muted" id={`why-${account.id}`}>{t(`loans.repay.why.${eligibility}` as MessageKey, { date: date(next.due_on), clock: clock ? date(clock) : "—" })}</p>}
              <label className="wallet-confirm"><input type="checkbox" disabled={preview || eligibility !== "ok"} checked={repayCheck === checkKey}
                onChange={(e) => setRepayCheck(e.target.checked ? checkKey : "")} />{t("loans.repay.check", { amount: money(next.amount) })}</label>
              <div className="service-actions">
                <button className="primary" aria-describedby={eligibility !== "ok" ? `why-${account.id}` : undefined}
                  disabled={preview || busy || policy.pending || eligibility !== "ok" || repayCheck !== checkKey}
                  onClick={() => void repay(account, next.number, next.amount)}>{t("loans.repay.button", { number: next.number })}</button>
              </div>
              {repayAccount === account.id && policy.panel}
            </div>}
            {account.status === "CLOSED" && <p className="service-notice">{t("loans.accounts.closed")}</p>}
          </article>;
        })}
      </ServiceSection>

      <ServiceSection id="loans-disbursements" title={t("loans.disb.title")} text={t("loans.disb.text")}>
        {snapshot.errors.disbursements && !signedOut && <p className="error">{snapshot.errors.disbursements}</p>}
        {snapshot.disbursements.length === 0 ? <p>{t("loans.disb.none")}</p> : <div className="table-scroll"><table className="service-table">
          <thead><tr><th>{t("loans.disb.date")}</th><th>{t("loans.disb.amount")}</th><th>{t("loans.disb.status")}</th><th>{t("loans.disb.application")}</th></tr></thead>
          <tbody>{snapshot.disbursements.map((d) => <tr key={d.id}>
            <td>{date(d.scheduled_on)}</td><td>{money(d.amount)}</td>
            <td><span className={`status-chip status-${statusTone(d.status)}`}>{t(`loans.disb.${d.status === "settled" ? "settled" : "scheduled"}` as MessageKey)}</span></td>
            <td><code>{d.application.slice(0, 8)}</code></td>
          </tr>)}</tbody>
        </table></div>}
      </ServiceSection>

      <ServiceSection id="loans-clock" title={t("loans.clock.title")} text={t("loans.clock.text")}>
        {snapshot.errors.wallet && !signedOut && <p className="error">{snapshot.errors.wallet}</p>}
        {!snapshot.wallet ? <p>{t("loans.clock.noWallet")}</p> : <>
          <dl className="comparison-facts">
            <div><dt>{t("loans.clock.today")}</dt><dd>{date(snapshot.wallet.clock)}</dd></div>
            <div><dt>{t("loans.clock.next")}</dt><dd>{target ? date(target) : "—"}</dd></div>
          </dl>
          {!target ? <p className="service-muted">{t("loans.clock.nothing")}</p> : target <= snapshot.wallet.clock ? <p className="service-muted">{t("loans.clock.alreadyDue")}</p> : <div className="service-policy">
            <h4>{t("loans.clock.demoControl")}</h4>
            <p>{t("loans.clock.explain", { date: date(target) })}</p>
            <label className="wallet-confirm"><input type="checkbox" disabled={preview} checked={clockCheck} onChange={(e) => setClockCheck(e.target.checked)} />{t("loans.clock.check")}</label>
            <div className="service-actions">
              <button className="secondary" disabled={preview || busy || !clockCheck} onClick={() => void moveClock(target)}>{t("loans.clock.button", { date: date(target) })}</button>
            </div>
          </div>}
        </>}
      </ServiceSection>
    </ServiceShell>
  );
}
