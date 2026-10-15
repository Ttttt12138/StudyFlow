import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { loanProductLabel, type LoanProduct } from "../loans/products";
import type { WalletClient } from "../wallet/client";
import { TERMS, type LoanMethod, type LoanPreview, type LoanLimit, type LoanOffer, type Term } from "./assessmentTypes";
import { useShow } from "./currency";

/** What the family picked: an amount within the full-course cost, a term, a product and how to repay. */
export type LoanChoice = { principal: number; months: Term; product: LoanProduct; method: LoanMethod };

const PRODUCTS: LoanProduct[] = ["custom", "commercial_student_demo"];
const percent = (rate: string | undefined) => rate === undefined ? "—" : `${(Number(rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** Step two: pick the amount, term and product within the full-course cost; the repayment plan follows instantly. */
export function LoanChooser({ client, check, choice, onChange, onPreview }: {
  client: WalletClient; check: LoanLimit & { products?: LoanOffer[] }; choice: LoanChoice; onChange: (choice: LoanChoice) => void;
  onPreview?: (preview: LoanPreview | null) => void;
}) {
  const { t, lang } = useI18n();
  const show = useShow();
  const thb = (value: string | number | null | undefined) => show(value, "THB", lang).main;
  const max = check.max_principal === null ? undefined : Number(check.max_principal);
  // Table cells are THB without the symbol, so 60 rows stay readable on a phone.
  const num = (value: string) => Number(value).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [preview, setPreview] = useState<LoanPreview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (choice.principal <= 0) { setPreview(null); onPreview?.(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      client.post<LoanPreview>("planning/loan-preview/", { principal: choice.principal.toFixed(2), months: choice.months, product: choice.product,
        method: choice.method }, `loan-preview:${choice.principal}:${choice.months}:${choice.product}:${choice.method}`)
        .then(next => { if (live) { setPreview(next); setError(""); onPreview?.(next); } })
        .catch(e => { if (live) { setPreview(null); onPreview?.(null); setError(e instanceof Error ? e.message : String(e)); } });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [client, choice.principal, choice.months, choice.product, choice.method]);
  const set = (patch: Partial<LoanChoice>) => onChange({ ...choice, ...patch });
  const offer = (product: LoanProduct) => check.products?.find(o => o.key === product);
  const terms = offer(choice.product)?.terms ?? [...TERMS];
  const methods = offer(choice.product)?.methods ?? ["amortized"];
  // A term or method the new product does not offer (60 months, interest only) falls back to what it does offer.
  const pickProduct = (product: LoanProduct) => {
    const allowed = offer(product)?.terms ?? [...TERMS];
    const ways = offer(product)?.methods ?? ["amortized"];
    set({ product, months: (allowed.includes(choice.months) ? choice.months : Math.max(...allowed)) as Term,
      method: ways.includes(choice.method) ? choice.method : "amortized" });
  };
  const study = preview?.interest_only_months ?? 0;
  const amount = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  return <section className="loan-chooser" aria-label={t("choose.title")}>
    <h3 className="panel-section-title">{t("choose.title")}</h3>
    <label className="loan-chooser-amount"><span>{t("choose.amount")}</span>
      <span className="loan-chooser-figure">
        <input type="number" min={0.01} max={max} step={0.01} inputMode="decimal" aria-label={t("choose.amount")} value={choice.principal}
          onChange={e => set({ principal: amount(Number(e.target.value)) })} /> THB</span>
      <small className="panel-muted">{t("choose.range", { max: thb(max ?? null) })}</small>
    </label>
    <div className="loan-chooser-row" role="radiogroup" aria-label={t("choose.product")}>
      <span>{t("choose.product")}</span>
      {PRODUCTS.map(p => <button key={p} type="button" role="radio" aria-checked={choice.product === p}
        className={`chip loan-chooser-product${choice.product === p ? " is-selected" : ""}`} onClick={() => pickProduct(p)}>
        <span>{t(loanProductLabel(p))}</span><small>{t("choose.rateOf", { rate: percent(offer(p)?.annual_rate) })}
          {offer(p)?.terms.includes(60) && ` · ${t("choose.longest")}`}</small></button>)}
    </div>
    {choice.principal > 0 && <>
      <div className="loan-chooser-row" role="radiogroup" aria-label={t("choose.term")}>
        <span>{t("choose.term")}</span>
        {TERMS.map(n => { const offered = terms.includes(n);
          return <button key={n} type="button" role="radio" aria-checked={choice.months === n} disabled={!offered}
            title={offered ? undefined : t("choose.onlyStudy")}
            className={`chip${choice.months === n ? " is-selected" : ""}`} onClick={() => set({ months: n })}>{t("simple.months", { n })}</button>; })}
        {!terms.includes(60) && <small className="panel-muted">{t("choose.onlyStudy")}</small>}
      </div>
      <fieldset className="loan-chooser-method"><legend>{t("choose.method")}</legend>
        <label><input type="radio" name="method" checked={choice.method === "amortized"} onChange={() => set({ method: "amortized" })} />
          {t("choose.method.amortized")}</label>
        <label className={methods.includes("interest_only") ? undefined : "is-disabled"}>
          <input type="radio" name="method" checked={choice.method === "interest_only"} disabled={!methods.includes("interest_only")}
            onChange={() => set({ method: "interest_only" })} />{t("choose.method.interestOnly")}
          {!methods.includes("interest_only") && <span className="panel-tag">{t("choose.method.studyOnly")}</span>}</label>
        {choice.method === "interest_only" && <small className="panel-muted">{t("choose.method.note")}</small>}
      </fieldset>
      <p className="panel-muted">{t("choose.hint")}</p>
      <div className="loan-chooser-plan" role="status" aria-live="polite">
        <h4>{t("choose.schedule")}</h4>
        {preview ? <>
          {study > 0 ? <div className="loan-chooser-phases">
            <p className="loan-chooser-pay is-study">{t("choose.studyPay", { n: study, amount: thb(preview.interest_only_payment) })}</p>
            <p className="loan-chooser-pay">{t("choose.afterPay", { n: preview.months, amount: thb(preview.monthly_payment) })}</p>
          </div> : <p className="loan-chooser-pay">{t("choose.monthly", { amount: thb(preview.monthly_payment) })}</p>}
          <dl className="assessment-facts loan-chooser-facts">
            <div><dt>{t("choose.product")}</dt><dd>{t(loanProductLabel(preview.product))}</dd></div>
            <div><dt>{t("choose.amount")}</dt><dd>{thb(preview.principal)}</dd></div>
            <div><dt>{t("simple.rate")}</dt><dd>{(Number(preview.annual_rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%</dd></div>
            <div><dt>{t("choose.term")}</dt><dd>{study > 0 ? t("choose.termWithStudy", { study, n: preview.months }) : t("simple.months", { n: preview.months })}</dd></div>
            <div><dt>{t("simple.fees")}</dt><dd>{thb(preview.fees)}</dd></div>
            <div><dt>{t("stage.toSchool")}</dt><dd>{thb(preview.net_proceeds)}</dd></div>
            <div><dt>{t("choose.firstDue")}</dt><dd>{preview.first_due_date}</dd></div>
            <div><dt>{t("choose.lastDue")}</dt><dd>{preview.last_due_date}</dd></div>
            <div><dt>{t("simple.interest")}</dt><dd>{thb(preview.total_interest)}</dd></div>
            <div><dt>{t("simple.totalRepay")}</dt><dd><strong>{thb(preview.total_repayment)}</strong></dd></div>
          </dl>
          <div className="loan-chooser-table" tabIndex={0} aria-label={t("choose.table")}>
            <table>
              <caption>{t("choose.table")}</caption>
              <thead><tr><th scope="col">{t("choose.col.no")}</th><th scope="col">{t("choose.col.date")}</th><th scope="col">{t("choose.col.pay")}</th>
                <th scope="col">{t("choose.col.principal")}</th><th scope="col">{t("choose.col.interest")}</th><th scope="col">{t("choose.col.left")}</th></tr></thead>
              <tbody>{preview.schedule.map(r => <tr key={r.number} className={r.number <= study ? "is-study" : undefined}><td>{r.number}</td><td>{r.due_date}</td><td>{num(r.amount)}</td>
                <td>{num(r.principal)}</td><td>{num(r.interest)}</td><td>{num(r.remaining_principal)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="panel-muted">{t(study > 0 ? "choose.tableNoteStudy" : "choose.tableNote", { n: study })}</p>
        </> : error ? <p role="alert">{error}</p> : <p className="panel-muted">{t("simple.saving")}</p>}
      </div>
    </>}
    {choice.principal === 0 && <p className="panel-muted">{t("choose.enterAmount")}</p>}
  </section>;
}
