import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "../i18n";
import "./panel.css";

export type PanelStep<K extends string> = { key: K; label: string; done?: boolean };

/**
 * One-screen tool layout: step or segment tabs on top, a single card body, actions pinned to the bottom.
 * Only the body scrolls, and only when the viewport is too short for the designed card.
 * Numbered steps describe a sequence (quote → apply → repay); segments are parallel views.
 */
export function ToolPanel<K extends string>({ steps = [], active, onSelect, label, numbered = true, notices, footer, sheet, children }: {
  steps?: PanelStep<K>[]; active?: K; onSelect?: (key: K) => void; label: string; numbered?: boolean;
  notices?: ReactNode; footer?: ReactNode; sheet?: ReactNode; children: ReactNode;
}) {
  const id = useId();
  const tabs = steps.length > 1;
  return <div className="tool-panel">
    {tabs && <div className={`panel-steps${numbered ? "" : " is-segments"}`} role="tablist" aria-label={label}>
      {steps.map((step, index) => <button key={step.key} type="button" role="tab" id={`${id}-${step.key}`}
        aria-selected={step.key === active} aria-controls={`${id}-body`} className={step.done ? "is-done" : ""}
        onClick={() => onSelect?.(step.key)}>
        {numbered && <span className="panel-step-node" aria-hidden="true">{step.done && step.key !== active ? <Check size={12} weight="bold" /> : index + 1}</span>}
        {step.label}
      </button>)}
    </div>}
    {notices && <div className="panel-notices">{notices}</div>}
    <div className="panel-body" id={`${id}-body`} role={tabs ? "tabpanel" : "region"} aria-label={tabs ? undefined : label}
      aria-labelledby={tabs ? `${id}-${active}` : undefined}>{children}</div>
    {footer && <div className="panel-footer">{footer}</div>}
    {sheet}
  </div>;
}

/** Switches between several records of the same kind instead of stacking them. */
export function PanelPager({ index, count, onChange, label }: { index: number; count: number; onChange: (index: number) => void; label: string }) {
  const { t } = useI18n();
  if (count < 2) return null;
  return <div className="panel-pager" role="group" aria-label={label}>
    <button type="button" aria-label={t("panel.previous")} disabled={index <= 0} onClick={() => onChange(index - 1)}><CaretLeft size={14} aria-hidden="true" /></button>
    <span aria-live="polite">{index + 1} / {count}</span>
    <button type="button" aria-label={t("panel.next")} disabled={index >= count - 1} onClick={() => onChange(index + 1)}><CaretRight size={14} aria-hidden="true" /></button>
  </div>;
}

/** Secondary details open over the card, so the card itself never grows. */
export function PanelSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("h3")?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div ref={ref} className="panel-sheet" role="dialog" aria-modal="false" aria-labelledby={id}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="panel-sheet-head"><h3 id={id} tabIndex={-1}>{title}</h3>
      <button type="button" className="panel-icon-button" aria-label={t("panel.closeSheet")} onClick={onClose}><X size={14} aria-hidden="true" /></button></div>
    <div className="panel-sheet-body">{children}</div>
    {footer && <div className="panel-footer">{footer}</div>}
  </div>;
}

/** Large figure with its label, used as the first line of every card. */
export function PanelHero({ label, value, unit, tone, children }: { label: string; value: string; unit?: string; tone?: "warn"; children?: ReactNode }) {
  return <div className={`panel-hero${tone === "warn" ? " is-warn" : ""}`}><span>{label}</span>
    <strong>{value}{unit && <small>{unit}</small>}</strong>{children}</div>;
}

export function PanelFacts({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="panel-facts">{items.map(([term, value], index) => <div key={index}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

/** Client-side paging for a list that would otherwise scroll. */
export function usePage<T>(rows: T[], size: number, page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const index = Math.min(page, pages - 1);
  return { rows: rows.slice(index * size, index * size + size), index, pages };
}
