import { useToolActive, useToolRefresh } from "../workspace/context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { Amount } from "../services/Amount";
import { TierBadge } from "../services/TierBadge";
import { usePolicyAction } from "../services/usePolicyAction";
import { WalletApiError, type WalletClient } from "./client";
import type { Page, WalletBalances } from "./types";
import { amountProblem, amountRange, countdown, directions, ledgerCurrencies, ledgerOrigin, nextPagePath, quoteExpired, quoteSecondsLeft, quotedAmount, signedParts, sourceCurrencies, targetCurrencies, tiersFor,
  type Conversion, type ExecQuote, type FxCorridor, type LedgerEntry } from "./extras/logic";
import { previewConversions, previewCorridors, previewHeld, previewHome, previewLedger, previewQuotes } from "./extras/previewData";
import "./extras/walletx.css";

type Errors = Partial<Record<"corridors" | "balances" | "ledger" | "conversions", string>>;
const POLICY_CODES = ["STEP_UP_REQUIRED", "STEP_UP_INVALID", "APPROVAL_REQUIRED"];
const REQUOTE_CODES = ["QUOTE_EXPIRED", "QUOTE_CONSUMED", "QUOTE_IN_USE", "QUOTE_NOT_EXECUTABLE", "QUOTE_AMOUNT_MISMATCH", "CORRIDOR_DISABLED", "CORRIDOR_AMOUNT_OUT_OF_RANGE"];

/** Currency conversion between wallet balances (T2) and the append-only ledger, below the transfer form. */
export function WalletExtras({ client, preview, onChanged }: { client: WalletClient; preview: boolean; onChanged: () => void }) {
  const { lang, t } = useI18n();
  const active = useToolActive();
  const policy = usePolicyAction(client, preview);
  const money = (value: unknown, currency?: string) => formatMoney(value, currency, lang);
  // Read `t` through a ref so switching language does not re-run the loaders and drop live quotes.
  const tRef = useRef(t);
  tRef.current = t;
  const message = useCallback((reason: unknown) => reason instanceof Error ? reason.message : tRef.current("shell.err.generic"), []);
  const stamp = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const [corridors, setCorridors] = useState<FxCorridor[]>([]);
  const [held, setHeld] = useState<string[] | null>(null);
  const [home, setHome] = useState("");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerNext, setLedgerNext] = useState<string | null>(null);
  const [ledgerCount, setLedgerCount] = useState(0);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [signedOut, setSignedOut] = useState(false);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [quotes, setQuotes] = useState<ExecQuote[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Conversion | null>(null);
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState(() => Date.now());

  const list = useMemo(() => directions(corridors), [corridors]);
  const sources = sourceCurrencies(list, held);
  const targets = targetCurrencies(list, source);
  const tiers = tiersFor(corridors, source, target);
  const range = amountRange(tiers);
  const selected = quotes.find((item) => item.id === selectedId) ?? null;
  const selectedLive = selected && !quoteExpired(selected, now);
  const rows = filter === "all" ? ledger : ledger.filter((row) => row.currency === filter);

  const loadHistory = useCallback(async () => {
    if (preview) return;
    const [entries, recent] = await Promise.allSettled([client.get<Page<LedgerEntry>>("ledger/"), client.get<Page<Conversion>>("conversions/")]);
    if (entries.status === "fulfilled") { setLedger(entries.value.results); setLedgerNext(entries.value.next); setLedgerCount(entries.value.count); }
    if (recent.status === "fulfilled") setConversions(recent.value.results.slice(0, 5));
    setErrors((prior) => ({ ...prior, ledger: entries.status === "rejected" ? message(entries.reason) : undefined, conversions: recent.status === "rejected" ? message(recent.reason) : undefined }));
    return recent.status === "fulfilled" ? recent.value.results : null;
  }, [client, preview, message]);

  useEffect(() => {
    let active = true;
    setQuotes(preview ? previewQuotes() : []); setSelectedId(""); setConfirmed(false); setResult(null); setError(""); setNotice("");
    if (preview) {
      setCorridors(previewCorridors); setHeld(previewHeld); setHome(previewHome); setLedger(previewLedger); setLedgerNext(null);
      setLedgerCount(previewLedger.length); setConversions(previewConversions); setErrors({}); setSignedOut(false);
      setSource("USD"); setTarget("THB"); setAmount("200.00"); setSelectedId("px-quote-standard");
      return;
    }
    Promise.allSettled([client.get<FxCorridor[]>("corridors/"), client.get<WalletBalances>("demo/wallets/balances/"), loadHistory()]).then(([routes, balances]) => {
      if (!active) return;
      const denied = (item: PromiseSettledResult<unknown>) => item.status === "rejected" && item.reason instanceof WalletApiError && [401, 403].includes(item.reason.status);
      setSignedOut(denied(routes) && denied(balances));
      if (routes.status === "fulfilled") setCorridors(routes.value);
      if (balances.status === "fulfilled") { setHeld(balances.value.balances.filter((row) => Number(row.balance) > 0).map((row) => row.currency)); setHome(balances.value.home_currency); }
      setErrors((prior) => ({ ...prior, corridors: routes.status === "rejected" ? message(routes.reason) : undefined, balances: balances.status === "rejected" ? message(balances.reason) : undefined }));
    });
    return () => { active = false; };
  }, [client, preview, loadHistory, message]);

  const stale = useToolRefresh(async () => {
    await loadHistory();
    if (!preview) {
      const balances = await client.get<WalletBalances>("demo/wallets/balances/");
      setHeld(balances.balances.filter(row => Number(row.balance) > 0).map(row => row.currency));
    }
  });
  // Keep the pickers on a seeded direction the student can debit.
  useEffect(() => { if (!sources.includes(source)) setSource(sources[0] ?? ""); }, [sources.join(), source]);
  useEffect(() => { if (!targets.includes(target)) setTarget(targets[0] ?? ""); }, [targets.join(), target]);
  useEffect(() => {
    if (!active || !quotes.length) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [quotes.length, active]);

  function resetQuotes() { setQuotes([]); setSelectedId(""); setConfirmed(false); }

  async function requestQuotes() {
    if (preview || !tiers.length) return;
    const problem = amountProblem(amount, range);
    if (problem) { setError(t(`walletx.err.amount.${problem}` as MessageKey, { min: money(range?.min, source), max: money(range?.max, source) })); return; }
    setBusy(true); setError(""); setNotice(""); setResult(null); resetQuotes();
    try {
      const send = amount.trim();
      const results = await Promise.allSettled(tiers.map((row) => client.post<ExecQuote>("fx-quotes/live/", { corridor_id: row.id, send_amount: send }, `convert-quote:${row.id}:${send}`)));
      const accepted = results.filter((item): item is PromiseFulfilledResult<ExecQuote> => item.status === "fulfilled").map((item) => item.value);
      const failures = results.filter((item): item is PromiseRejectedResult => item.status === "rejected").map((item) => message(item.reason));
      setQuotes(accepted); setSelectedId(accepted[0]?.id ?? ""); setNow(Date.now());
      if (!accepted.length) setError(failures.join(" · ") || t("walletx.err.noQuote"));
      else setNotice(t("walletx.notice.quotes", { n: accepted.length }) + (failures.length ? ` ${t("walletx.notice.someFailed", { n: failures.length, reason: [...new Set(failures)].join(" · ") })}` : ""));
    } finally { setBusy(false); }
  }

  async function finish(done: Conversion, text: string) {
    setResult(done); resetQuotes(); setNotice(text); setError("");
    onChanged();
    await loadHistory();
  }

  async function failed(reason: unknown, quote: ExecQuote) {
    const code = reason instanceof WalletApiError ? reason.code : "";
    const status = reason instanceof WalletApiError ? reason.status : -1;
    // A lost response or a consumed quote may mean our own earlier attempt went through: look before asking to retry.
    if (status === 0 || status >= 500 || code === "QUOTE_CONSUMED") {
      const recent = await loadHistory().catch(() => null);
      const found = recent?.find((item) => item.quote === quote.id || item.quote_id === quote.id);
      if (found) { await finish(found, t("walletx.notice.recovered")); return; }
      if (status === 0 || status >= 500) { setError(t("shell.err.lost")); return; }
    }
    if (status === 409 && !code.startsWith("QUOTE")) {
      setConfirmed(false); onChanged(); await loadHistory().catch(() => null);
      setError(t("walletx.err.changed")); return;
    }
    if (REQUOTE_CODES.includes(code)) { resetQuotes(); setError(`${message(reason)} ${t("walletx.err.requote")}`); return; }
    if (code === "RESERVE_REQUIRED") { setError(`${message(reason)} ${t("walletx.err.reserve")}`); return; }
    if (code === "INSUFFICIENT_BALANCE") { setError(`${message(reason)} ${t("walletx.err.balance")}`); return; }
    setError(message(reason));
  }

  async function convert() {
    if (preview || !selected || !confirmed) return;
    if (quoteExpired(selected, Date.now())) { resetQuotes(); setError(t("walletx.err.expired")); return; }
    const quote = selected;
    const sourceAmount = quotedAmount(quote);
    const subject = { action: "wallet.convert", target_id: quote.id, amount: sourceAmount, currency: quote.source_currency };
    const send = async (token?: string) => {
      try {
        // Read the state version right before posting so the backend can refuse a conversion based on stale balances.
        const state = await client.get<{ version: number }>("state/");
        const done = await client.post<Conversion>("conversions/", { quote_id: quote.id, source_amount: sourceAmount, state_version: state.version },
          `convert:${quote.id}`, token ? { "X-Step-Up-Token": token } : {});
        await finish(done, t("walletx.notice.converted"));
      } catch (reason) {
        if (reason instanceof WalletApiError && POLICY_CODES.includes(reason.code)) throw reason;
        await failed(reason, quote);
      }
    };
    setBusy(true); setError(""); setNotice("");
    try { await policy.run(subject, send); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  }

  async function loadMore() {
    const path = nextPagePath(ledgerNext, window.location.origin);
    if (!path) { if (ledgerNext) setErrors((prior) => ({ ...prior, ledger: t("walletx.err.pagination") })); return; }
    setBusy(true);
    try {
      const page = await client.get<Page<LedgerEntry>>(path);
      setLedger((prior) => prior.concat(page.results.filter((row) => !prior.some((item) => item.id === row.id)))); setLedgerNext(page.next);
    } catch (reason) { setErrors((prior) => ({ ...prior, ledger: message(reason) })); } finally { setBusy(false); }
  }

  if (signedOut) return null;
  const originLabel = (row: LedgerEntry) => t(`walletx.origin.${ledgerOrigin(row)}` as MessageKey);
  const signed = (value: string, currency: string) => { const part = signedParts(value); return `${part.sign} ${money(part.abs, currency)}`; };

  return <>{stale}
    <section id="wallet-convert" className="card wallet-panel walletx">
      <div className="wallet-heading"><div><span className="eyebrow">{t("walletx.convert.eyebrow")}</span><h2>{t("walletx.convert.title")}</h2></div><TierBadge tier="T2" withLabel /></div>
      <p>{t("walletx.convert.text")}</p>
      {(["corridors", "balances"] as const).map((key) => errors[key] && <p key={key} className="error" role="alert">{errors[key]}</p>)}
      {list.length ? <div className="wallet-form-row">
        <label>{t("walletx.convert.from")}<select value={source} disabled={preview || busy} onChange={(event) => { setSource(event.target.value); resetQuotes(); }}>{sources.map((code) => <option key={code} value={code}>{code}{code === home ? t("walletx.convert.homeTag") : ""}</option>)}</select></label>
        <label>{t("walletx.convert.to")}<select value={target} disabled={preview || busy} onChange={(event) => { setTarget(event.target.value); resetQuotes(); }}>{targets.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
        <label>{t("walletx.convert.amount", { currency: source })}<input inputMode="decimal" value={amount} disabled={preview} placeholder="200.00" onChange={(event) => { setAmount(event.target.value); resetQuotes(); }} /></label>
        <button className="primary" disabled={preview || busy || !tiers.length} onClick={() => void requestQuotes()}>{t("walletx.convert.quote")}</button>
        {range && <small>{t("walletx.convert.range", { min: money(range.min, source), max: money(range.max, source), n: tiers.length })}</small>}
        {!sources.length && <small>{t("walletx.convert.noSource")}</small>}
      </div> : <p className="wallet-empty">{t("walletx.convert.noRoutes")}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="service-notice" role="status">{notice}</p>}
      {quotes.length > 0 && <div className="wallet-quote-grid">{quotes.map((quote) => {
        const left = quoteSecondsLeft(quote, now);
        return <article key={quote.id} className={selectedId === quote.id ? "selected" : ""}>
          <h3>{quote.route_name}</h3>
          <p><strong><Amount text={money(quote.net_received, quote.target_currency)} /></strong><span>{t("walletx.quote.net")}</span></p>
          <dl><div><dt>{t("walletx.quote.debit")}</dt><dd>{money(quotedAmount(quote), quote.source_currency)}</dd></div>
            <div><dt>{t("walletx.quote.rate")}</dt><dd>{quote.rate}</dd></div>
            <div><dt>{t("walletx.quote.senderFee")}</dt><dd>{money(quote.sender_fee, quote.source_currency)}</dd></div>
            <div><dt>{t("walletx.quote.receiverFee")}</dt><dd>{money(quote.receiver_fee == null ? null : String(quote.receiver_fee), quote.target_currency)}</dd></div>
            <div><dt>{t("walletx.quote.expires")}</dt><dd>{left > 0 ? t("walletx.quote.left", { time: countdown(left) }) : <span className="status-chip status-expired">{t("walletx.quote.expired")}</span>}</dd></div></dl>
          <small>{quote.is_mock ? t("walletx.quote.fixture") : t("walletx.quote.source", { source: quote.rate_source })}</small>
          <button className="secondary" disabled={preview || left <= 0} aria-pressed={selectedId === quote.id} onClick={() => { setSelectedId(quote.id); setConfirmed(false); }}>{selectedId === quote.id ? t("walletx.quote.selected") : t("walletx.quote.select")}</button>
        </article>; })}</div>}
      {selected && <div className="wallet-review">
        <h3>{t("walletx.review.title")}</h3>
        <dl className="comparison-facts">
          <div><dt>{t("walletx.review.debit")}</dt><dd>{money(quotedAmount(selected), selected.source_currency)}</dd></div>
          <div><dt>{t("walletx.review.credit")}</dt><dd>{money(selected.net_received, selected.target_currency)}</dd></div>
          <div><dt>{t("walletx.quote.rate")}</dt><dd>{selected.rate}</dd></div>
          <div><dt>{t("walletx.quote.senderFee")}</dt><dd>{money(selected.sender_fee, selected.source_currency)}</dd></div>
        </dl>
        {selected.source_currency === home && <p className="service-alert">{t("walletx.review.reserve", { currency: home })}</p>}
        <p>{t("walletx.review.note")}</p>
        {!selectedLive && <p className="error" role="alert">{t("walletx.err.expired")}</p>}
        <div className="wallet-actions">
          <label className="wallet-confirm"><input type="checkbox" checked={confirmed} disabled={preview || !selectedLive} onChange={(event) => setConfirmed(event.target.checked)} />{t("walletx.review.confirm")}</label>
          <button className="primary" disabled={preview || busy || !confirmed || !selectedLive || policy.pending} onClick={() => void convert()}>{t("walletx.review.submit")}</button>
        </div>
      </div>}
      {policy.panel}
      {result && <div className="wallet-review" role="status">
        <h3>{t("walletx.result.title")}</h3>
        <dl className="comparison-facts">
          <div><dt>{t("walletx.result.debited")}</dt><dd>{money(result.source_amount, result.source_currency)}</dd></div>
          <div><dt>{t("walletx.result.credited")}</dt><dd>{money(result.target_amount, result.target_currency)}</dd></div>
          <div><dt>{t("walletx.quote.rate")}</dt><dd>{result.rate}</dd></div>
          <div><dt>{t("walletx.result.sequences")}</dt><dd>{result.debit_sequence != null ? `#${result.debit_sequence} / #${result.credit_sequence}` : "—"}</dd></div>
          <div><dt>{t("walletx.result.effective")}</dt><dd>{formatDate(result.effective_on, lang)}</dd></div>
        </dl>
      </div>}
      <h3 className="walletx-sub">{t("walletx.recent.title")}</h3>
      {errors.conversions && <p className="error" role="alert">{errors.conversions}</p>}
      {conversions.length ? <ul className="walletx-recent">{conversions.map((item) => <li key={item.id}>
        <strong>{money(item.source_amount, item.source_currency)} → {money(item.target_amount, item.target_currency)}</strong>
        <span>{t("walletx.recent.meta", { rate: item.rate, date: stamp(item.created_at) })}</span></li>)}</ul>
        : !errors.conversions && <p className="wallet-empty">{t("walletx.recent.none")}</p>}
    </section>
    <section id="wallet-ledger" className="card wallet-panel walletx">
      <div className="wallet-heading"><div><span className="eyebrow">{t("walletx.ledger.eyebrow")}</span><h2>{t("walletx.ledger.title")}</h2></div><span className="count">{t("walletx.ledger.count", { shown: ledger.length, total: ledgerCount })}</span></div>
      <p>{t("walletx.ledger.text")}</p>
      {errors.ledger && <p className="error" role="alert">{errors.ledger}</p>}
      {ledger.length > 0 && <div className="wallet-form-row walletx-filter"><label>{t("walletx.ledger.filter")}<select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="all">{t("walletx.ledger.all")}</option>{ledgerCurrencies(ledger).map((code) => <option key={code} value={code}>{code}</option>)}</select></label></div>}
      {rows.length ? <div className="table-scroll"><table className="service-table walletx-ledger" aria-label={t("walletx.ledger.title")}>
        <thead><tr><th>{t("walletx.ledger.date")}</th><th>{t("walletx.ledger.sequence")}</th><th>{t("walletx.ledger.origin")}</th><th className="num">{t("walletx.ledger.amount")}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.effective_on, lang)}</td><td>#{row.sequence}</td><td>{originLabel(row)}</td>
          <td className={`num ${row.amount.trim().startsWith("-") ? "walletx-debit" : "walletx-credit"}`}>{signed(row.amount, row.currency)}</td></tr>)}</tbody>
      </table></div> : !errors.ledger && <p className="wallet-empty">{ledger.length ? t("walletx.ledger.noneFiltered") : t("walletx.ledger.none")}</p>}
      {filter !== "all" && ledgerNext && <small>{t("walletx.ledger.filterNote")}</small>}
      {ledgerNext && <div className="service-actions"><button className="secondary" disabled={busy || preview} onClick={() => void loadMore()}>{t("walletx.ledger.more")}</button></div>}
      <p className="walletx-note">{t("walletx.ledger.appendOnly")}</p>
    </section>
  </>;
}
