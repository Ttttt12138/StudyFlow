import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { loanProductLabel, type LoanProduct } from "../loans/products";
import type { WalletClient } from "../wallet/client";
import { AssessmentEssentials } from "./AssessmentForm";
import { TERMS, type AssessmentInputs, type Borrower, type LoanPreview, type Prequal, type Term } from "./assessmentTypes";
import { useShow } from "./currency";

/** What the family picked: an amount within the pre-check (0 = no loan), a term and a product. */
export type LoanChoice = { principal: number; months: Term; product: LoanProduct };

const BORROWERS: Borrower[] = ["student_with_parent", "parent"];
const PRODUCTS: LoanProduct[] = ["custom", "commercial_student_demo"];
const STEP = 100;
const percent = (rate: string | undefined) => rate === undefined ? "—" : `${(Number(rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** Step one of the loan: who borrows and the money on hand, before any application. Income is not asked. */
export function PrequalForm({ value, onChange, disabled, onSubmit }: {
  value: AssessmentInputs; onChange: (value: AssessmentInputs) => void; disabled: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { t } = useI18n();
  const borrower = value.borrower ?? "student_with_parent";
  return <form className="assessment-quick" onSubmit={onSubmit} aria-label={t("prequal.title")}>
    <h3>{t("prequal.title")}</h3>
    <p className="panel-muted">{t("prequal.note")}</p>
    <fieldset disabled={disabled}>
      <div className="prequal-borrower" role="radiogroup" aria-label={t("prequal.borrower")}>
        <span>{t("prequal.borrower")}</span>
        {BORROWERS.map(b => <label key={b}><input type="radio" name="borrower" checked={borrower === b}
          onChange={() => onChange({ ...value, borrower: b })} />{t(`prequal.borrower.${b}` as MessageKey)}</label>)}
      </div>
      <AssessmentEssentials value={value} onChange={onChange} />
    </fieldset>
    <button type="submit" className="primary assessment-main" disabled={disabled || !value.available_funds}>{t("prequal.submit")}</button>
    <p className="panel-muted">{t("simple.quickChat")}</p>
  </form>;
}

/** "How much can I borrow": the gap is the limit, with one sentence to act on. */
export function PrequalResult({ check, onEdit }: { check: Prequal; onEdit: () => void }) {
  const { t, lang } = useI18n();
  const show = useShow();
  const thb = (value: string | null | undefined) => show(value, "THB", lang).main;
  const sentence = check.status === "enough" ? t("prequal.enough", { amount: thb(check.max_principal) })
    : t(`prequal.${check.status}` as MessageKey);
  return <section className="prequal-result" aria-label={t("prequal.result")}>
    <div className="prequal-head"><h3>{t("prequal.result")}</h3>
      <button type="button" className="link-button" onClick={onEdit}>{t("prequal.edit")}</button></div>
    <dl className="assessment-facts">
      <div><dt>{t("prequal.gap")}</dt><dd>{thb(check.gap)}</dd></div>
      <div><dt>{t("prequal.max")}</dt><dd><strong>{thb(check.max_principal)}</strong></dd></div>
      <div><dt>{t("prequal.rate")}</dt><dd>{check.products?.length
        ? check.products.map(o => `${t(loanProductLabel(o.key))} ${percent(o.annual_rate)}`).join(" · ")
        : percent(check.annual_rate)}</dd></div>
    </dl>
    <p className="panel-muted" role="status">{sentence}</p>
  </section>;
}

/** Step two: pick the amount, term and product within the pre-check; the repayment plan follows instantly. */
export function LoanChooser({ client, check, choice, onChange, onPreview }: {
  client: WalletClient; check: Prequal; choice: LoanChoice; onChange: (choice: LoanChoice) => void;
  onPreview?: (preview: LoanPreview | null) => void;
}) {
  const { t, lang } = useI18n();
  const show = useShow();
  const thb = (value: string | number | null | undefined) => show(value, "THB", lang).main;
  const max = Number(check.max_principal ?? 0);
  // Table cells are THB without the symbol, so 60 rows stay readable on a phone.
  const num = (value: string) => Number(value).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [preview, setPreview] = useState<LoanPreview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (choice.principal <= 0) { setPreview(null); onPreview?.(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      client.post<LoanPreview>("planning/loan-preview/", { principal: choice.principal.toFixed(2), months: choice.months, product: choice.product },
        `loan-preview:${choice.principal}:${choice.months}:${choice.product}`)
        .then(next => { if (live) { setPreview(next); setError(""); onPreview?.(next); } })
        .catch(e => { if (live) { setPreview(null); onPreview?.(null); setError(e instanceof Error ? e.message : String(e)); } });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [client, choice.principal, choice.months, choice.product]);
  const set = (patch: Partial<LoanChoice>) => onChange({ ...choice, ...patch });
  const offer = (product: LoanProduct) => check.products?.find(o => o.key === product);
  const terms = offer(choice.product)?.terms ?? [...TERMS];
  // A term the new product does not offer (60 months outside the study loan) falls back to its longest one.
  const pickProduct = (product: LoanProduct) => {
    const allowed = offer(product)?.terms ?? [...TERMS];
    set({ product, months: (allowed.includes(choice.months) ? choice.months : Math.max(...allowed)) as Term });
  };
  const amount = (value: number) => Math.max(0, Math.min(max, Math.round(value / STEP) * STEP));
  return <section className="loan-chooser" aria-label={t("choose.title")}>
    <h3 className="panel-section-title">{t("choose.title")}</h3>
    <div className="loan-chooser-row" role="radiogroup" aria-label={t("choose.product")}>
      <span>{t("choose.product")}</span>
      {PRODUCTS.map(p => <button key={p} type="button" role="radio" aria-checked={choice.product === p}
        className={`chip loan-chooser-product${choice.product === p ? " is-selected" : ""}`} onClick={() => pickProduct(p)}>
        <span>{t(loanProductLabel(p))}</span><small>{t("choose.rateOf", { rate: percent(offer(p)?.annual_rate) })}
          {offer(p)?.terms.includes(60) && ` · ${t("choose.longest")}`}</small></button>)}
    </div>
    <label className="loan-chooser-amount"><span>{t("choose.amount")}</span>
      <input type="range" min={0} max={max} step={STEP} value={choice.principal} aria-valuetext={thb(choice.principal)}
        onChange={e => set({ principal: amount(Number(e.target.value)) })} />
      <span className="loan-chooser-figure">
        <input type="number" min={0} max={max} step={STEP} inputMode="decimal" aria-label={t("choose.amount")} value={choice.principal}
          onChange={e => set({ principal: amount(Number(e.target.value)) })} /> THB</span>
      <small className="panel-muted">{t("choose.range", { max: thb(max) })}</small>
    </label>
    <button type="button" className={`chip${choice.principal === 0 ? " is-selected" : ""}`} aria-pressed={choice.principal === 0}
      onClick={() => set({ principal: 0 })}>{t("choose.none")}</button>
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
        <label><input type="radio" name="method" checked readOnly />{t("choose.method.amortized")}</label>
        <label className="is-disabled"><input type="radio" name="method" disabled />{t("choose.method.interestOnly")}
          <span className="panel-tag">{t("choose.soon")}</span></label>
      </fieldset>
      <p className="panel-muted">{t("choose.hint")}</p>
      <div className="loan-chooser-plan" role="status" aria-live="polite">
        <h4>{t("choose.schedule")}</h4>
        {preview ? <>
          <p className="loan-chooser-pay">{t("choose.monthly", { amount: thb(preview.monthly_payment) })}</p>
          <dl className="assessment-facts loan-chooser-facts">
            <div><dt>{t("choose.product")}</dt><dd>{t(loanProductLabel(preview.product))}</dd></div>
            <div><dt>{t("choose.amount")}</dt><dd>{thb(preview.principal)}</dd></div>
            <div><dt>{t("simple.rate")}</dt><dd>{(Number(preview.annual_rate) * 100).toFixed(2).replace(/\.?0+$/, "")}%</dd></div>
            <div><dt>{t("choose.term")}</dt><dd>{t("simple.months", { n: preview.months })}</dd></div>
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
              <tbody>{preview.schedule.map(r => <tr key={r.number}><td>{r.number}</td><td>{r.due_date}</td><td>{num(r.amount)}</td>
                <td>{num(r.principal)}</td><td>{num(r.interest)}</td><td>{num(r.remaining_principal)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="panel-muted">{t("choose.tableNote")}</p>
        </> : error ? <p role="alert">{error}</p> : <p className="panel-muted">{t("simple.saving")}</p>}
      </div>
    </>}
    {choice.principal === 0 && <p className="panel-muted">{t("choose.noLoanNote")}</p>}
  </section>;
}
