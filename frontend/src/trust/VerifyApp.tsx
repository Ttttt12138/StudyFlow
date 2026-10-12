import { useState } from "react";
import { formatDate } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { ServiceShell, ServiceSection } from "../services/ServiceShell";
import { WalletApiError } from "../wallet/client";
import { verifyStatement } from "./credit/client";
import { cleanStatement, expiresAt, isLevel, reasonKey, statementProblem, STATEMENT_MAX, type Verification } from "./credit/logic";
import { previewInvalid, previewStatement, previewValid } from "./credit/previewData";
import "../wallet/wallet.css";
import "./credit/credit.css";

/** Public page where anyone (a landlord, a school) checks a signed statement; no StudyFlow account is needed. */
export function VerifyApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const [text, setText] = useState(() => preview ? previewStatement.statement : "");
  const [result, setResult] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const level = (value: string) => isLevel(value) ? t(`trust.level.${value}` as MessageKey) : value;
  const stamp = (value: Date | string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });

  async function check() {
    if (preview) return;
    const statement = cleanStatement(text);
    const problem = statementProblem(statement);
    if (problem) { setError(t(`credit.verify.err.${problem}` as MessageKey, { max: STATEMENT_MAX })); setResult(null); return; }
    setBusy(true); setError(""); setResult(null);
    try { setResult(await verifyStatement(statement)); }
    catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 429) setError(t("credit.verify.err.throttled"));
      else setError(reason instanceof Error ? reason.message : t("shell.err.generic"));
    } finally { setBusy(false); }
  }

  function show(item: Verification, example?: string) {
    if (!item.valid) return <div className="credit-result invalid" role={example ? undefined : "alert"}>
      <h3>{example ?? t("credit.verify.invalid")}</h3>
      <p>{t(`credit.reason.${reasonKey(item.reason)}` as MessageKey)}</p>
    </div>;
    const expires = expiresAt(item.issued_at);
    return <div className="credit-result valid" role={example ? undefined : "status"}>
      <h3>{example ?? t("credit.verify.valid")}</h3>
      <dl className="comparison-facts">
        <div><dt>{t("credit.field.holder")}</dt><dd>{item.holder}</dd></div>
        <div><dt>{t("credit.col.level")}</dt><dd>{level(item.level)}</dd></div>
        <div><dt>{t("credit.field.onTime")}</dt><dd>{item.on_time}</dd></div>
        <div><dt>{t("credit.field.late")}</dt><dd>{item.late}</dd></div>
        <div><dt>{t("credit.field.overdue")}</dt><dd>{item.overdue}</dd></div>
        <div><dt>{t("credit.col.asOf")}</dt><dd>{formatDate(item.as_of, lang)}</dd></div>
        <div><dt>{t("credit.field.issuedAt")}</dt><dd>{stamp(item.issued_at)}</dd></div>
        {expires && <div><dt>{t("credit.field.expires")}</dt><dd>{stamp(expires)}</dd></div>}
      </dl>
      <p className="service-disclaimer">{t("credit.disclaimer")}</p>
    </div>;
  }

  const sections = [{ id: "verify-check", label: t("credit.verify.check.title") }, { id: "verify-about", label: t("credit.verify.about.title") }];
  return (
    <ServiceShell className="verify-app" eyebrow={t("credit.verify.eyebrow")} title={t("credit.verify.title")} intro={t("credit.verify.intro")}
      sideLabel={t("credit.verify.side.label")} sections={sections} noteTitle={t("credit.verify.side.noteTitle")} noteText={t("credit.verify.side.noteText")}
      preview={preview} previewTitle={t("credit.verify.preview.title")} previewText={t("credit.verify.preview.text")} bannerText={t("credit.verify.banner")}
      signedOut={false} signInUrl="/" signedOutText="" onExit={onExit} publicPage>
      <ServiceSection id="verify-check" title={t("credit.verify.check.title")} text={t("credit.verify.check.text")}>
        <form className="credit-statement" onSubmit={(e) => { e.preventDefault(); void check(); }}>
          <label htmlFor="verify-statement">{t("credit.verify.field")}</label>
          <textarea id="verify-statement" value={text} disabled={preview} spellCheck={false} autoComplete="off"
            onChange={(e) => { setText(e.target.value); setResult(null); setError(""); }} />
          <div className="service-actions">
            <button type="submit" className="primary" disabled={preview || busy || !text.trim()}>{busy ? t("common.loading") : t("credit.verify.submit")}</button>
          </div>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {preview ? <>{show(previewValid, t("credit.verify.example.valid"))}{show(previewInvalid, t("credit.verify.example.invalid"))}</> : result && show(result)}
      </ServiceSection>
      <ServiceSection id="verify-about" title={t("credit.verify.about.title")}>
        <ul className="credit-reveals">
          <li>{t("credit.verify.about.signed")}</li>
          <li>{t("credit.reveals.fields")}</li>
          <li>{t("credit.reveals.expiry")}</li>
          <li>{t("credit.verify.about.private")}</li>
        </ul>
        <p className="service-disclaimer">{t("credit.disclaimer")}</p>
      </ServiceSection>
    </ServiceShell>
  );
}
