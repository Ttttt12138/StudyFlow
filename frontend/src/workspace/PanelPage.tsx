import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";

/**
 * A detail page inside a tool panel: it replaces the panel content and has its own back button, instead of
 * folding details away in the list. Focus moves to the back button so keyboard users land on the new page.
 */
export function PanelPage({ title, onBack, children }: { title: ReactNode; onBack: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus(); }, []);
  return <section className="panel-page">
    <div className="panel-page-head">
      <button ref={back} type="button" className="panel-page-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{t("common.back")}</button>
      <h3>{title}</h3>
    </div>
    <div className="panel-page-body">{children}</div>
  </section>;
}

/** A row that opens a detail page. */
export function PanelLink({ children, onClick, note }: { children: ReactNode; onClick: () => void; note?: ReactNode }) {
  return <button type="button" className="panel-page-link" onClick={onClick}>
    <span>{children}{note && <small>{note}</small>}</span><CaretRight size={16} aria-hidden="true" /></button>;
}
