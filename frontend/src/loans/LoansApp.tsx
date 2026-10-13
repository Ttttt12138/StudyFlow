import { useToolRefresh, useEmbedded, useWorkspace } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceShell } from "../services/ServiceShell";
import { Amount } from "../services/Amount";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelPager, PanelSheet, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { LineChart } from "../workspace/PanelCharts";
import { Bank } from "@phosphor-icons/react/dist/csr/Bank";
import { usePolicyAction } from "../services/usePolicyAction";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { loadLoans } from "./client";
import { LoanProductNotice, LoanProductSelect } from "./LoanProductSelect";
import { COMMERCIAL_STUDY_TERMS, type LoanProduct } from "./products";
import { canCancel, defaultFirstDue, FINAL_STATUSES, effectiveAnnualRate, fractionToPercent, MONEY_PATTERN, nextDueDate, nextInstallment, percentToFraction,
  profileCoverage, repayEligibility, repaymentMonths, statusTone } from "./logic";
import { createLoansPreview } from "./previewAdapter";
import type { LoanAccount, LoanApplication, LoanQuote, LoansSnapshot, ProfileMonth } from "./types";
import type { Plan } from "../plan/types";
import "../wallet/wallet.css";
import "./loans.css";

const signInUrl = `/auth?next=${encodeURIComponent(window.location.origin + "/?loans=1")}`;
const initial: LoansSnapshot = { applications: [], quotes: [], profile: null, accounts: [], disbursements: [], wallet: null, errors: {} };
const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);
type Tab = "quote" | "apply" | "repay";
type Sheet = "terms" | "schedule" | "profile" | "installments" | "disbursements" | "clock" | null;
type Row = { key: string; month: string; income: string; living_expenses: string; existing_repayments: string };
const FIELDS = ["income", "living_expenses", "existing_repayments"] as const;
const toRows = (months: ProfileMonth[]): Row[] => months.map((m, n) => ({ key: `r${n}-${m.month}`, month: m.month,
  income: m.income ?? "", living_expenses: m.living_expenses ?? "", existing_repayments: m.existing_repayments ?? "" }));

export function LoansApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const embedded = useEmbedded();
  const workspace = useWorkspace();
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
  const [form, setForm] = useState({ product: "custom" as LoanProduct, principal: "60000.00", rate: "6", fees: "1200.00", months: "6", firstDue: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [repayCheck, setRepayCheck] = useState("");
  const [repayAccount, setRepayAccount] = useState("");
  const [clockCheck, setClockCheck] = useState(false);
  const profileVersion = useRef(-1);
  const [tab, setTab] = useState<Tab | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [appIndex, setAppIndex] = useState(0);
  const [accountIndex, setAccountIndex] = useState(0);
  const [planLoan, setPlanLoan] = useState<Plan["loan"] | null>(null);
  const linkedAccount = workspace?.target?.kind === "loans" ? workspace.target.section : undefined;
  const linkedIndex = snapshot.accounts.findIndex(account => account.id === linkedAccount);
  useEffect(() => {
    if (linkedIndex >= 0) { setAccountIndex(linkedIndex); setTab("repay"); }
  }, [linkedAccount, linkedIndex]);

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
    // The plan's own loan terms are optional context; without them the panel keeps its defaults.
    if (!preview) void api.get<{ plan: Plan | null }>("planning/profile/").then((data) => setPlanLoan(data.plan?.loan ?? null)).catch(() => {});
    setLoading(false);
    return result;
  }, [client, preview]);

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
      await refresh(); setSubmitCheck(""); setCancelId(""); setTab("apply");
      setNotice(t(action === "submit" ? "loans.notice.submitted" : "loans.notice.cancelled", { status: t(`loans.status.${updated.status}` as MessageKey) }));
    });
  }

  async function createQuote() {
    const annual_rate = percentToFraction(form.rate);
    if (!annual_rate || !MONEY_PATTERN.test(form.principal) || !MONEY_PATTERN.test(form.fees) || !/^\d+$/.test(form.months) || !form.firstDue) {
      setError(t("loans.err.quoteForm")); return;
    }
    const body = { product: form.product, currency: "THB", principal: form.principal, annual_rate, fees: form.fees, months: Number(form.months), first_due_date: form.firstDue };
    await perform(async () => {
      let created: LoanQuote;
      try { created = await client.post<LoanQuote>("loans/", body, "loan-quote"); }
      catch (reason) {
        // A lost response may still have stored the quote; look for one with these exact terms.
        if (lost(reason)) {
          const result = await refresh();
          const match = result.quotes.find((q) => Number(q.inputs.principal) === Number(body.principal) && Number(q.inputs.annual_rate) === Number(annual_rate)
            && Number(q.inputs.fees) === Number(body.fees) && q.inputs.months === body.months && q.inputs.first_due_date === body.first_due_date
            && (q.inputs.product ?? "custom") === body.product);
          if (match) { setQuoteId(match.id); setNotice(t("loans.notice.quoted")); return; }
        }
        throw reason;
      }
      await refresh(); setQuoteId(created.id); setCoverId(created.id); setSheet(null); setTab("quote");
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
      await refresh(); setNotice(t("loans.notice.applied")); setAppIndex(0); setTab("apply");
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
      await refresh(); setNotice(t("loans.notice.profileSaved")); setSheet(null);
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
      await refresh(); setClockCheck(false); setSheet(null);
      setNotice(t("loans.notice.clockMoved", { date: date(day) }));
    });
  }

  const chip = (status: string) => <span className={`status-chip status-${statusTone(status)}`}>{t(`loans.status.${status}` as MessageKey)}</span>;
  const monthly = (quote: LoanQuote) => quote.result.maximum_installment ?? quote.result.repayments[0]?.amount;
  const quoteFacts = (quote: LoanQuote) => {
    const r = quote.result;
    const apr = effectiveAnnualRate(r.net_proceeds, r.repayments);
    return <PanelFacts items={[
      [t("loans.quote.principal"), money(r.principal)], [t("loans.quote.net"), money(r.net_proceeds)],
      [t("loans.quote.months"), r.repayments.length], [t("loans.quote.rate"), fractionToPercent(quote.inputs.annual_rate)],
      [t("loans.quote.firstDue"), date(firstDue(quote))], [t("loans.quote.totalRepay"), money(r.total_repayment)],
      [t("loans.quote.fees"), money(r.fees)],
      [t("loans.quote.totalCost"), <>{money(r.total_cost_over_net_proceeds ?? (Number(r.total_repayment) - Number(r.net_proceeds)).toFixed(2))}
        {apr !== null && <small> · {t("loans.quote.effective", { rate: `${(apr * 100).toFixed(2)}%` })}</small>}</>],
    ]} />;
  };
  // Stacked monthly bars: principal (mint) under interest (gold), scaled to the largest installment.
  const chart = (quote: LoanQuote) => {
    const rows = quote.result.repayments, peak = Math.max(...rows.map((r) => Number(r.amount)), 1), width = 100 / rows.length;
    return <figure className="panel-chart-figure" style={{ margin: 0 }}>
      <svg className="panel-chart" viewBox="0 0 100 64" preserveAspectRatio="none" role="img" aria-label={t("lp.quote.chart")}>
        {rows.map((r, n) => { const p = Number(r.principal) / peak * 60, i = Number(r.interest) / peak * 60, x = n * width + width * .18, w = width * .64;
          return <g key={r.number}><rect className="is-principal" x={x} y={64 - p} width={w} height={p} rx=".6" /><rect className="is-interest" x={x} y={64 - p - i} width={w} height={i} rx=".6" /></g>; })}
      </svg>
      <figcaption className="panel-legend"><span>{t("lp.quote.principalPart")}</span><span>{t("lp.quote.interestPart")}</span></figcaption>
    </figure>;
  };
  const scheduleTable = (quote: LoanQuote) => <table className="panel-table">
    <thead><tr><th>#</th><th>{t("loans.inst.due")}</th><th>{t("loans.inst.amount")}</th><th>{t("loans.inst.principal")}</th><th>{t("loans.quote.interest")}</th><th>{t("loans.quote.remaining")}</th></tr></thead>
    <tbody>{quote.result.repayments.map((r) => <tr key={r.number}><td>{r.number}</td><td>{date(r.due_date)}</td><td>{money(r.amount)}</td><td>{money(r.principal)}</td><td>{money(r.interest)}</td><td>{money(r.remaining_principal)}</td></tr>)}</tbody>
  </table>;
  const nextStep = (application: LoanApplication) => <p className="panel-note">{t(`loans.next.${application.status}` as MessageKey)}</p>;

  // The step to show first follows the real records: repay an active loan, finish an open application, otherwise quote.
  const accounts = [...snapshot.accounts].sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE"));
  const applications = [...snapshot.applications].sort((a, b) => Number(!FINAL_STATUSES.includes(b.status)) - Number(!FINAL_STATUSES.includes(a.status)) || b.created_at.localeCompare(a.created_at));
  const auto: Tab = accounts.some((a) => a.status === "ACTIVE") ? "repay" : applications.some((a) => canCancel(a)) ? "apply" : "quote";
  const current = tab ?? auto;
  const application = applications[Math.min(appIndex, applications.length - 1)];
  const account = accounts[Math.min(accountIndex, accounts.length - 1)];
  const steps = [
    { key: "quote" as const, label: t("lp.step.quote"), done: snapshot.applications.length > 0 },
    { key: "apply" as const, label: t("lp.step.apply"), done: snapshot.accounts.length > 0 },
    { key: "repay" as const, label: t("lp.step.repay"), done: snapshot.accounts.length > 0 && snapshot.accounts.every((a) => a.status === "CLOSED") },
  ];
  const openTerms = () => {
    // Prefill from the quote on screen, else from the plan's loan, keeping the user's due date.
    const source = shownQuote?.inputs ?? (planLoan ? { product: "custom" as const, principal: planLoan.principal, annual_rate: planLoan.annual_rate, months: planLoan.months, fees: form.fees } : null);
    if (source) setForm((prior) => ({ ...prior, product: source.product ?? "custom", principal: Number(source.principal).toFixed(2), rate: fractionToPercent(source.annual_rate).replace("%", ""),
      fees: Number(source.fees).toFixed(2), months: String(source.months) }));
    setSheet("terms");
  };

  let body: React.ReactNode, footer: React.ReactNode = null;
  if (current === "quote") {
    if (shownQuote) {
      const index = unused.indexOf(shownQuote);
      body = <section id="loans-quote" aria-labelledby="loans-quote-title" className="panel-card">
        <div className="panel-card-head"><h3 id="loans-quote-title">{t("loans.quote.unused")}</h3>
          <PanelPager index={index} count={unused.length} onChange={(n) => setQuoteId(unused[n].id)} label={t("lp.quote.pager")} /></div>
        {shownQuote.id === planLoan?.id && <div className="panel-row"><span className="panel-tag">{t("lp.quote.fromPlan")}</span></div>}
        <LoanProductNotice product={shownQuote.inputs.product} />
        <PanelHero label={t("lp.quote.monthly")} value={money(monthly(shownQuote))} />
        {chart(shownQuote)}
        {quoteFacts(shownQuote)}
        {expired(shownQuote) && <p className="panel-note is-warn">{t("loans.submit.expired")}</p>}
        <button type="button" className="panel-link" onClick={() => setSheet("schedule")}>{t("lp.quote.schedule")} →</button>
      </section>;
      footer = <><button type="button" className="secondary" disabled={preview} onClick={openTerms}>{t("lp.quote.adjust")}</button>
        <button className="primary" disabled={preview || busy || expired(shownQuote)} onClick={() => void apply(shownQuote)}>{t("loans.quote.apply")}</button></>;
    } else {
      body = <div id="loans-quote" className="panel-view">{snapshot.errors.quotes && !signedOut && <PanelAlert message={snapshot.errors.quotes} onRetry={() => void refresh()} />}
        {loading ? <PanelSkeleton /> : <PanelEmpty icon={Bank} title={t("lp.step.quote")} text={t("lp.quote.empty")} />}</div>;
      footer = <button type="button" className="primary" disabled={preview || busy} onClick={openTerms}>{t("loans.form.create")}</button>;
    }
  } else if (current === "apply") {
    if (!application) {
      body = <div id="loans-applications" className="panel-view">{snapshot.errors.applications && !signedOut && <PanelAlert message={snapshot.errors.applications} onRetry={() => void refresh()} />}
        {loading ? <PanelSkeleton /> : <PanelEmpty title={t("lp.step.apply")} text={t("lp.apply.empty")} />}</div>;
      footer = <button type="button" className="primary" onClick={() => setTab("quote")}>{t("lp.apply.toQuote")}</button>;
    } else {
      const quote = quoteOf(application), a = application.assessment;
      const cancelling = cancelId === application.id;
      body = <section id="loans-applications" aria-labelledby={`app-${application.id}`} className="panel-card">
        <div className="panel-card-head"><h3 id={`app-${application.id}`}>{t("loans.apps.item", { id: application.id.slice(0, 8), date: when(application.created_at) })}</h3>
          <PanelPager index={applications.indexOf(application)} count={applications.length} onChange={setAppIndex} label={t("lp.apply.pager")} /></div>
        <div className="panel-row">{chip(application.status)}</div>
        <LoanProductNotice product={quote?.inputs.product} />
        {quote ? <PanelHero label={t("lp.quote.monthly")} value={money(monthly(quote))}>
          <span>{t("lp.apply.terms", { principal: money(quote.result.principal), months: quote.result.repayments.length, monthly: money(monthly(quote)) })}</span></PanelHero>
          : <p className="panel-muted">{snapshot.errors.quotes ?? t("loans.apps.noQuote")}</p>}
        <p className="panel-muted">{a.status ? <>{t("loans.apps.assessment")} <strong>{t(`loans.assess.${a.status}` as MessageKey)}</strong>
          {a.missing_inputs?.length ? ` · ${t("loans.apps.missing", { months: [...new Set(a.missing_inputs.map((m) => m.slice(0, 7)))].join(", ") })}` : ""}
          {a.shortfall_months?.length ? ` · ${t("loans.apps.shortfall", { months: a.shortfall_months.join(", ") })}` : ""}</> : t("loans.apps.notAssessed")}</p>
        {application.decision_reason && <p className="panel-muted">{t("loans.apps.reason", { reason: application.decision_reason })}</p>}
        {nextStep(application)}
        {application.status === "UNDER_REVIEW" && a.status === "INSUFFICIENT_DATA" && <button type="button" className="panel-link"
          onClick={() => { setCoverId(application.loan); setSheet("profile"); }}>{t("loans.next.profileLink")} →</button>}
        {application.status === "DRAFT" && <>
          {expired(quote) && <p className="panel-note is-warn">{t("loans.submit.expired")}</p>}
          <label className="panel-check"><input type="checkbox" checked={submitCheck === application.id} disabled={preview}
            onChange={(event) => setSubmitCheck(event.target.checked ? application.id : "")} />{t("loans.submit.check")}</label></>}
        {cancelling && <p className="panel-note is-warn" role="group" aria-label={t("loans.cancel.label")}>{t("loans.cancel.confirm")}</p>}
      </section>;
      footer = <>
        <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("profile")}>{t("lp.apply.profile")}</button>
        {canCancel(application) && (cancelling
          ? <><button className="secondary" disabled={busy} onClick={() => setCancelId("")}>{t("loans.cancel.no")}</button>
            <button className="primary" disabled={preview || busy} onClick={() => void act(application, "cancel")}>{t("loans.cancel.yes")}</button></>
          : <button className="secondary" disabled={preview || busy} onClick={() => setCancelId(application.id)}>{t("loans.cancel.button")}</button>)}
        {application.status === "DRAFT" && !cancelling && <button className="primary" disabled={preview || busy || submitCheck !== application.id}
          onClick={() => void act(application, "submit")}>{t("loans.submit.button")}</button>}
      </>;
    }
  } else if (!account) {
    body = <div id="loans-accounts" className="panel-view">{snapshot.errors.accounts && !signedOut && <PanelAlert message={snapshot.errors.accounts} onRetry={() => void refresh()} />}
      {loading ? <PanelSkeleton /> : <PanelEmpty title={t("lp.step.repay")} text={t("lp.repay.empty")} />}</div>;
  } else {
    const next = nextInstallment(account);
    const eligibility = next ? repayEligibility(account, next) : "closed";
    const checkKey = next ? `${account.id}:${next.number}:${account.version}` : "";
    const paid = account.installments.filter((i) => i.paid_on).length, total = account.installments.length;
    const disbursement = snapshot.disbursements.find((d) => d.id === account.disbursement);
    // Around the next installment: the last paid one, the next and the one after.
    const at = Math.max(0, account.installments.findIndex((i) => i.number === next?.number) - 1);
    body = <section id="loans-accounts" aria-labelledby={`acct-${account.id}`} className="panel-card">
      <div className="panel-card-head"><h3 id={`acct-${account.id}`}>{t("loans.accounts.item", { id: account.id.slice(0, 8) })}</h3>
        <PanelPager index={accounts.indexOf(account)} count={accounts.length} onChange={setAccountIndex} label={t("lp.repay.pager")} /></div>
      <div className="panel-row">{chip(account.status)}<span className="panel-muted">{t("lp.repay.progress", { paid, total })}</span></div>
      <PanelHero label={t("lp.repay.outstanding")} value={money(account.outstanding_principal)}>
        <div className="panel-progress" aria-hidden="true"><span style={{ width: `${total ? paid / total * 100 : 0}%` }} /></div></PanelHero>
      {next && account.status === "ACTIVE" ? <div className="panel-timeline">
        <time dateTime={next.due_on}><strong>{Number(next.due_on.slice(8, 10))}</strong>
          <span>{new Date(`${next.due_on}T00:00:00`).toLocaleDateString(intlLocale(lang), { month: "short" })}</span></time>
        <div><span className="panel-muted">{t("loans.repay.title", { number: next.number })}</span><strong><Amount text={money(next.amount)} /></strong>{chip(next.status)}</div>
      </div> : account.status === "CLOSED" && <p className="panel-note">{t("loans.accounts.closed")}</p>}
      {account.installments.length > 1 && <div className="fx-figure"><div className="panel-section-title">{t("lp.paidCurve")}<span>{t("lp.repay.progress", { paid, total })}</span></div>
        <LineChart label={t("lp.paidCurve")} height={56} points={account.installments.reduce<number[]>((points, row) =>
          [...points, Math.max(0, points[points.length - 1] - Number(row.principal))], [account.installments.reduce((sum, row) => sum + Number(row.principal), 0)])} /></div>}
      <ul className="panel-list panel-aside-hide" aria-label={t("loans.inst.caption")}>
        {account.installments.slice(at, at + 3).map((row) => <li key={row.number} aria-current={next?.number === row.number ? "true" : undefined}>
          <span>{row.number}</span><span>{date(row.due_on)}</span><span>{money(row.amount)}</span>{chip(row.status)}</li>)}
      </ul>
      <div className="panel-row">
        <button type="button" className="panel-link" onClick={() => setSheet("installments")}>{t("lp.repay.all", { n: total })} →</button>
        <button type="button" className="panel-link" onClick={() => setSheet("disbursements")}>{disbursement
          ? t("lp.repay.disbursed", { date: date(disbursement.scheduled_on), amount: money(disbursement.amount) }) : t("loans.disb.title")} →</button>
      </div>
      {next && account.status === "ACTIVE" && <>
        {eligibility !== "ok" && <p className="panel-muted" id={`why-${account.id}`}>{t(`loans.repay.why.${eligibility}` as MessageKey, { date: date(next.due_on), clock: clock ? date(clock) : "—" })}</p>}
        <label className="panel-check"><input type="checkbox" disabled={preview || eligibility !== "ok"} checked={repayCheck === checkKey}
          onChange={(e) => setRepayCheck(e.target.checked ? checkKey : "")} />{t("loans.repay.check", { amount: money(next.amount) })}</label>
        {repayAccount === account.id && policy.panel}
      </>}
    </section>;
    footer = <>
      {snapshot.wallet && <button type="button" className="panel-link panel-footer-note" onClick={() => setSheet("clock")}>{t("lp.repay.clock", { date: date(snapshot.wallet.clock) })}</button>}
      {next && account.status === "ACTIVE" && <button className="primary" aria-describedby={eligibility !== "ok" ? `why-${account.id}` : undefined}
        disabled={preview || busy || policy.pending || eligibility !== "ok" || repayCheck !== checkKey}
        onClick={() => void repay(account, next.number, next.amount)}>{t("loans.repay.button", { number: next.number })}</button>}
    </>;
  }

  const close = () => setSheet(null);
  const sheets: Record<Exclude<Sheet, null>, () => React.ReactNode> = {
    terms: () => <PanelSheet title={t("lp.terms.title")} onClose={close} footer={<button type="submit" form="loans-terms" className="primary" disabled={preview || busy}>{t("loans.form.create")}</button>}>
      <p className="panel-muted">{t(shownQuote ? "lp.terms.fromQuote" : planLoan ? "lp.terms.fromPlan" : "loans.quote.text")}</p>
      <form id="loans-terms" className="panel-form" onSubmit={(event) => { event.preventDefault(); void createQuote(); }}>
        <LoanProductSelect value={form.product} disabled={preview || busy} onChange={product => setForm(prior => ({ ...prior, product,
          ...(product === "commercial_student_demo" ? { rate: fractionToPercent(COMMERCIAL_STUDY_TERMS.annual_rate).replace("%", ""),
            fees: COMMERCIAL_STUDY_TERMS.fees, months: String(COMMERCIAL_STUDY_TERMS.periods[0]) } : {}) }))} />
        <label>{t("loans.form.principal")}<input inputMode="decimal" value={form.principal} disabled={preview} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></label>
        <label>{t("loans.form.months")}<input type="number" min={1} max={60} value={form.months} disabled={preview} onChange={(e) => setForm({ ...form, months: e.target.value })} /></label>
        <label>{t("loans.form.rate")}<input inputMode="decimal" value={form.rate} disabled={preview} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></label>
        <label>{t("loans.form.fees")}<input inputMode="decimal" value={form.fees} disabled={preview} onChange={(e) => setForm({ ...form, fees: e.target.value })} /></label>
        <label>{t("loans.form.firstDue")}<input type="date" value={form.firstDue} min={clock} disabled={preview} onChange={(e) => setForm({ ...form, firstDue: e.target.value })} /></label>
      </form>
      {clock && <p className="panel-muted">{t("loans.form.dueHint", { date: date(clock) })}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </PanelSheet>,
    schedule: () => shownQuote && <PanelSheet title={t("lp.quote.schedule")} onClose={close}>{scheduleTable(shownQuote)}</PanelSheet>,
    installments: () => account && <PanelSheet title={t("loans.accounts.title")} onClose={close}>
      <table className="panel-table" id="loans-installments"><caption className="sr-only">{t("loans.inst.caption")}</caption>
        <thead><tr><th>#</th><th>{t("loans.inst.due")}</th><th>{t("loans.inst.amount")}</th><th>{t("loans.inst.principal")}</th><th>{t("loans.inst.status")}</th><th>{t("loans.inst.paidOn")}</th></tr></thead>
        <tbody>{account.installments.map((row) => <tr key={row.number} aria-current={nextInstallment(account)?.number === row.number ? "true" : undefined}>
          <td>{row.number}</td><td>{date(row.due_on)}</td><td>{money(row.amount)}</td><td>{money(row.principal)}</td><td>{chip(row.status)}</td><td>{row.paid_on ? date(row.paid_on) : "—"}</td>
        </tr>)}</tbody>
      </table>
      <p className="panel-muted">{t("loans.accounts.text")}</p>
    </PanelSheet>,
    disbursements: () => <PanelSheet title={t("loans.disb.title")} onClose={close}><div id="loans-disbursements">
      <p className="panel-muted">{t("loans.disb.text")}</p>
      {snapshot.errors.disbursements && !signedOut && <PanelAlert message={snapshot.errors.disbursements} />}
      {snapshot.disbursements.length === 0 ? <p className="panel-muted">{t("loans.disb.none")}</p> : <table className="panel-table">
        <thead><tr><th>{t("loans.disb.date")}</th><th>{t("loans.disb.amount")}</th><th>{t("loans.disb.status")}</th></tr></thead>
        <tbody>{snapshot.disbursements.map((d) => <tr key={d.id}><td>{date(d.scheduled_on)}</td><td>{money(d.amount)}</td>
          <td><span className={`status-chip status-${statusTone(d.status)}`}>{t(`loans.disb.${d.status === "settled" ? "settled" : "scheduled"}` as MessageKey)}</span></td></tr>)}</tbody>
      </table>}</div>
    </PanelSheet>,
    clock: () => <PanelSheet title={t("loans.clock.title")} onClose={close} footer={target && snapshot.wallet && target > snapshot.wallet.clock
      ? <button className="primary" disabled={preview || busy || !clockCheck} onClick={() => void moveClock(target)}>{t("loans.clock.button", { date: date(target) })}</button> : undefined}>
      <div id="loans-clock">
        <p className="panel-muted">{t("loans.clock.text")}</p>
        {snapshot.errors.wallet && !signedOut && <PanelAlert message={snapshot.errors.wallet} />}
        {!snapshot.wallet ? <p className="panel-muted">{t("loans.clock.noWallet")}</p> : <>
          <PanelFacts items={[[t("loans.clock.today"), date(snapshot.wallet.clock)], [t("loans.clock.next"), target ? date(target) : "—"]]} />
          {!target ? <p className="panel-muted">{t("loans.clock.nothing")}</p> : target <= snapshot.wallet.clock ? <p className="panel-muted">{t("loans.clock.alreadyDue")}</p> : <>
            <p className="panel-note">{t("loans.clock.explain", { date: date(target) })}</p>
            <label className="panel-check"><input type="checkbox" disabled={preview} checked={clockCheck} onChange={(e) => setClockCheck(e.target.checked)} />{t("loans.clock.check")}</label>
          </>}
        </>}
      </div>
    </PanelSheet>,
    profile: () => <PanelSheet title={t("loans.profile.title")} onClose={close} footer={<>
      {coverage.missing.length > 0 && <button className="secondary" disabled={preview} onClick={addMissing}>{t("loans.profile.addMissing", { count: coverage.missing.length })}</button>}
      <button className="secondary" disabled={preview} onClick={() => setRows([...rows, { key: `n-${Date.now()}`, month: "", income: "", living_expenses: "", existing_repayments: "" }])}>{t("loans.profile.add")}</button>
      <button className="primary" disabled={preview || busy} onClick={() => void saveProfile()}>{t("loans.profile.save")}</button></>}>
      <div id="loans-profile" className="panel-sheet-stack">
        <p className="panel-muted">{t("loans.profile.text")}</p>
        {snapshot.errors.profile && !signedOut && <PanelAlert message={snapshot.errors.profile} />}
        {coverable.length > 1 && <label className="panel-form" style={{ gridTemplateColumns: "1fr" }}><span>{t("loans.profile.for")}</span>
          <select value={cover?.id} onChange={(e) => setCoverId(e.target.value)}>
            {coverable.map((q) => <option key={q.id} value={q.id}>{`${money(q.result.principal)} · ${repaymentMonths(q).join(", ")}`}</option>)}
          </select></label>}
        {cover && <p className={`panel-note${coverage.complete ? "" : " is-warn"}`}>{coverage.complete ? t("loans.profile.covered", { count: coverage.needed.length })
          : t("loans.profile.gaps", { missing: coverage.missing.join(", ") || "—", incomplete: coverage.incomplete.join(", ") || "—" })}</p>}
        {rows.length === 0 ? <p className="panel-muted">{t("loans.profile.none")}</p> : rows.map((row) => <fieldset key={row.key} className="panel-month">
          <legend>{row.month || t("loans.profile.newMonth")}</legend>
          <label>{t("loans.profile.month")}<input value={row.month} placeholder="YYYY-MM" disabled={preview} onChange={(e) => editRow(row.key, { month: e.target.value })} /></label>
          {FIELDS.map((field) => <label key={field}>{t(`loans.profile.${field}` as MessageKey)}<input inputMode="decimal" value={row[field]} disabled={preview}
            onChange={(e) => editRow(row.key, { [field]: e.target.value })} /></label>)}
          <button type="button" className="panel-link" disabled={preview} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>{t("loans.profile.remove", { month: row.month })}</button>
        </fieldset>)}
        <p className="panel-muted">{t("loans.profile.hint", { version: snapshot.profile?.version ?? 0 })}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </PanelSheet>,
  };

  const staleStatus = useToolRefresh(() => refresh());
  return (
    <ServiceShell className="loans-app" eyebrow={t("loans.eyebrow")} title={t("loans.title")} intro={t("loans.intro")} sideLabel={t("loans.side.label")}
      sections={[]} noteTitle={t("loans.side.noteTitle")} noteText={t("loans.side.noteText")} preview={preview}
      previewTitle={t("loans.preview.title")} previewText={t("loans.preview.text")} bannerText={t("loans.banner.text")}
      signedOut={signedOut} signInUrl={signInUrl} signedOutText={t("loans.signedOut")} onExit={onExit}
      onRefresh={embedded ? undefined : () => void refresh()} refreshing={loading || busy}>
      {staleStatus}
      <ToolPanel steps={steps} active={current} onSelect={(key) => { setTab(key); setSheet(null); }} label={t("lp.steps")}
        notices={(loading || (error && !sheet) || notice) && <>
          {loading && snapshot.applications.length + snapshot.quotes.length + snapshot.accounts.length > 0 && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
          {error && !sheet && <div className="stale-banner" role="alert">{error}</div>}
          {notice && <div className="demo" role="status">{notice}</div>}</>}
        footer={<>{footer}{current === "quote" && workspace && <button type="button" className="panel-link panel-footer-note" style={{ order: -1 }}
          onClick={() => workspace.open({ kind: "plan" })}>{t("lp.backToPlan")}</button>}</>}
        sheet={sheet && sheets[sheet]()}
        aside={current === "quote" && shownQuote ? <><h3 className="panel-section-title">{t("lp.quote.schedule")}</h3>{scheduleTable(shownQuote)}</>
          : current === "repay" && account ? <><h3 className="panel-section-title">{t("loans.inst.caption")}</h3><table className="panel-table">
            <thead><tr><th>#</th><th>{t("loans.inst.due")}</th><th>{t("loans.inst.amount")}</th><th>{t("loans.inst.status")}</th></tr></thead>
            <tbody>{account.installments.map((row) => <tr key={row.number}><td>{row.number}</td><td>{date(row.due_on)}</td><td>{money(row.amount)}</td><td>{chip(row.status)}</td></tr>)}</tbody></table></> : undefined}>
        {body}
      </ToolPanel>
    </ServiceShell>
  );
}
