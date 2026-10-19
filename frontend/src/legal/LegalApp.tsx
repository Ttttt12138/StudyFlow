import { Fragment, type ReactNode } from "react";
import { intlLocale, useI18n } from "../i18n";
import { CONTACT_URL, LEGAL_UPDATED, legalDocs, type LegalKind } from "./content";
import "./legal.css";

export const LEGAL_PATHS: Record<LegalKind, string> = { terms: "/terms", privacy: "/privacy" };

export function legalFromPath(pathname: string): LegalKind | null {
  if (/^\/terms\/?$/.test(pathname)) return "terms";
  if (/^\/privacy\/?$/.test(pathname)) return "privacy";
  return null;
}

/** "Terms of Use · Privacy Notice" links for page footers. */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useI18n();
  return <nav className={className ?? "legal-links"} aria-label={t("legal.label")}>
    <a href={LEGAL_PATHS.terms}>{t("legal.terms")}</a>
    <a href={LEGAL_PATHS.privacy}>{t("legal.privacy")}</a>
  </nav>;
}

/** The sign-up sentence, with {terms} and {privacy} turned into links. */
export function SignupAgreement() {
  const { t } = useI18n();
  const links: Record<string, ReactNode> = {
    terms: <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener">{t("legal.terms")}</a>,
    privacy: <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener">{t("legal.privacy")}</a>,
  };
  const parts = t("legal.signupAgree").split(/\{(terms|privacy)\}/);
  return <p className="auth-agree">{parts.map((part, i) => <Fragment key={i}>{i % 2 ? links[part] : part}</Fragment>)}</p>;
}

/** /terms and /privacy — the Terms of Use and the Privacy Notice, in the interface language. */
export function LegalApp({ kind }: { kind: LegalKind }) {
  const { lang, t } = useI18n();
  const doc = legalDocs[lang][kind];
  const updated = new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${LEGAL_UPDATED}T00:00:00Z`));
  document.title = `${doc.title} · StudyFlow`;
  return <div className="legal-shell">
    <div className="legal-head">
      <a className="brand" href="/" aria-label={t("signin.home")}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
      <nav className="legal-tabs" aria-label={t("legal.label")}>
        {(["terms", "privacy"] as const).map(key => <a key={key} href={LEGAL_PATHS[key]} aria-current={key === kind ? "page" : undefined}>{t(`legal.${key}`)}</a>)}
      </nav>
    </div>
    <main className="legal-main">
      <article className="legal-card" aria-labelledby="legal-title">
        <h1 id="legal-title">{doc.title}</h1>
        <p className="legal-updated">{t("legal.updated", { date: updated })}</p>
        <p className="legal-summary">{doc.summary}</p>
        {doc.sections.map(section => <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        </section>)}
        <div className="legal-foot">
          <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{t("legal.contact")} <span aria-hidden="true">↗</span></a>
          <a href="/">{t("legal.back")}</a>
        </div>
      </article>
    </main>
  </div>;
}
