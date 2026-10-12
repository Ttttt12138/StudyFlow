import type { ReactNode } from "react";
import { useI18n } from "../i18n";
import { ModuleNav } from "./ModuleNav";
import "./services.css";
import { useEmbedded } from "../workspace/context";

export type ShellSection = { id: string; label: string };

/**
 * Sidebar, header, simulated-money banner and signed-out card shared by the service pages
 * (the same layout WalletApp/TrustApp/PaymentsApp spell out by hand). A public page (a family member
 * confirming support, anyone verifying a statement) shows no student navigation.
 */
export function ServiceShell({ className, eyebrow, title, intro, sideLabel, sections, noteTitle, noteText, preview,
  previewTitle, previewText, bannerText, signedOut, signInUrl, signedOutText, onExit, onRefresh, refreshing, publicPage = false, children }: {
  className: string; eyebrow: string; title: string; intro: string; sideLabel: string; sections: ShellSection[];
  noteTitle: string; noteText: string; preview: boolean; previewTitle: string; previewText: string; bannerText: string;
  signedOut: boolean; signInUrl: string; signedOutText: string; onExit: () => void; onRefresh?: () => void; refreshing?: boolean;
  publicPage?: boolean; children: ReactNode;
}) {
  const { t } = useI18n();
  const embedded = useEmbedded();
  if (embedded) return <div className={`embedded-module ${className}`}>
    {signedOut && !preview && <p>{signedOutText} <a href={signInUrl}>{t("common.signIn")}</a></p>}
    {onRefresh && !preview && <button className="secondary" disabled={refreshing} onClick={onRefresh}>{t("common.refresh")}</button>}
    {children}
  </div>;
  return (
    <div className={`app connected service-app ${className}${publicPage ? " public-page" : ""}`}>
      <aside>
        {publicPage
          ? <a className="brand" href="/intro"><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>
          : <a className="brand" href="#" onClick={(event) => { event.preventDefault(); onExit(); }}><span className="brand-icon">S</span>StudyFlow<span className="brand-dot">.</span></a>}
        {!publicPage && <ModuleNav />}
        <div className="journey-label">{sideLabel}</div>
        <nav aria-label={t("shell.sections", { title })}>
          {sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
        </nav>
        <div className="sidebar-note"><strong>{noteTitle}</strong><p>{noteText}</p></div>
        {!publicPage && <button className="secondary" onClick={onExit}>{t("common.backToPlan")}</button>}
      </aside>
      <div className="workspace">
        <header><span>StudyFlow / {title}</span>{!publicPage && <span className="avatar">ST</span>}</header>
        <main>
          <div className="section-heading"><div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>
          {!preview && onRefresh && <button className="secondary" disabled={refreshing} onClick={onRefresh}>{t("common.refresh")}</button>}
          </div>
          <div className="preview-banner" role="status">
            <strong>{preview ? previewTitle : t("common.simulatedMoney")}</strong>
            <span>{preview ? previewText : bannerText}</span>
          </div>
          {signedOut && !preview && <div className="card service-card"><div className="service-card-body service-empty">
            <p>{signedOutText}</p><a className="primary" href={signInUrl}>{t("common.signIn")}</a>
          </div></div>}
          {children}
        </main>
        <footer>{t("common.footer")}<span>{t("common.simulatedFooter")}</span></footer>
      </div>
    </div>
  );
}

/** Section card used by the service pages. */
export function ServiceSection({ id, title, text, children, tier }: { id: string; title: ReactNode; text?: string; children: ReactNode; tier?: ReactNode }) {
  return (
    <section className="card service-card" id={id} aria-labelledby={`${id}-title`}>
      <div className="service-card-body">
        <h2 id={`${id}-title`}>{tier}{tier && " "}{title}</h2>
        {text && <p className="service-muted">{text}</p>}
        {children}
      </div>
    </section>
  );
}
