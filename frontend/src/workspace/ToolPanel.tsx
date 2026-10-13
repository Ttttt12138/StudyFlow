import { CaretLeft } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { CloudSlash } from "@phosphor-icons/react/dist/csr/CloudSlash";
import { UserSwitch } from "@phosphor-icons/react/dist/csr/UserSwitch";
import { Tray } from "@phosphor-icons/react/dist/csr/Tray";
import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { useWorkspace } from "./context";
import { classifyError, signOut } from "./session";
import "./panel.css";

export type PanelStep<K extends string> = { key: K; label: string; done?: boolean };

/**
 * One-screen tool layout: step or segment tabs on top, a single card body, actions pinned to the bottom.
 * Only the body scrolls, and only when the viewport is too short for the designed card.
 * Numbered steps describe a sequence (quote → apply → repay); segments are parallel views.
 */
export function ToolPanel<K extends string>({ steps = [], active, onSelect, label, numbered = true, notices, footer, sheet, tools, aside, children }: {
  steps?: PanelStep<K>[]; active?: K; onSelect?: (key: K) => void; label: string; numbered?: boolean;
  notices?: ReactNode; footer?: ReactNode; sheet?: ReactNode;
  /** Small controls at the end of the tab bar (for example a "more" menu). */
  tools?: ReactNode;
  /** Secondary detail shown as a second column only when the tool is expanded. */
  aside?: ReactNode; children: ReactNode;
}) {
  const id = useId();
  const tabs = steps.length > 1;
  return <div className="tool-panel">
    {(tabs || tools) && <div className="panel-bar">{tabs && <div className={`panel-steps${numbered ? "" : " is-segments"}`} role="tablist" aria-label={label}>
      {steps.map((step, index) => <button key={step.key} type="button" role="tab" id={`${id}-${step.key}`}
        aria-selected={step.key === active} aria-controls={`${id}-body`} className={step.done ? "is-done" : ""}
        onClick={() => onSelect?.(step.key)}>
        {numbered && <span className="panel-step-node" aria-hidden="true">{step.done && step.key !== active ? <Check size={12} weight="bold" /> : index + 1}</span>}
        {step.label}
      </button>)}
    </div>}{tools && <div className="panel-tools">{tools}</div>}</div>}
    {notices && <div className="panel-notices">{notices}</div>}
    <div className={`panel-main${aside ? " has-aside" : ""}`}>
      <div className="panel-body" id={`${id}-body`} role={tabs ? "tabpanel" : "region"} aria-label={tabs ? undefined : label}
        aria-labelledby={tabs ? `${id}-${active}` : undefined}>{children}</div>
      {aside && <aside className="panel-aside">{aside}</aside>}
    </div>
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

/** A long explanation tucked behind an info button instead of occupying the card. */
export function PanelInfo({ children, label }: { children: ReactNode; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  return <span className="panel-info">
    <button type="button" className="panel-icon-button" aria-label={label ?? t("panel.info")} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><Info size={14} aria-hidden="true" /></button>
    {open && <span className="panel-info-text" id={id} role="note">{children}</span>}
  </span>;
}

/** "More" popover for rarely used controls such as preview scenarios. */
export function PanelMenu({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return <div className="panel-menu" ref={ref} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className="panel-icon-button" aria-label={t("panel.more")} aria-expanded={open} onClick={() => setOpen(!open)}><DotsThree size={16} weight="bold" aria-hidden="true" /></button>
    <div className="panel-menu-pop" hidden={!open}>{children}</div>
  </div>;
}

/** Invitation-style empty state: icon, one line and the next step. */
export function PanelEmpty({ icon: Icon = Tray, title, text, action }: { icon?: ComponentType<{ size?: number; weight?: "light" }>; title: string; text?: string; action?: ReactNode }) {
  return <div className="panel-empty">
    <span className="panel-empty-icon" aria-hidden="true"><Icon size={26} weight="light" /></span>
    <p className="panel-empty-title">{title}</p>{text && <p>{text}</p>}{action}
  </div>;
}

/** Card-shaped placeholder while the first read is in flight. */
export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return <div className="panel-skeleton" role="status" aria-label={t("panel.loading")}>
    <span className="is-hero" />{Array.from({ length: rows }, (_, n) => <span key={n} />)}
  </div>;
}

/** A failed read in plain words, with the next step (retry, or switch to a student account). */
export function PanelAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const { kind, detail } = classifyError(message);
  if (kind === "account") return <div className="panel-alert is-account" role="alert"><UserSwitch size={20} aria-hidden="true" />
    <p>{workspace?.account ? t("panel.err.account", { account: workspace.account }) : t("panel.err.accountUnknown")}</p>
    <button type="button" className="secondary" onClick={() => void signOut()}>{t("panel.signOut")}</button></div>;
  if (kind === "offline") return <div className="panel-alert" role="alert"><CloudSlash size={20} aria-hidden="true" />
    <p>{t("panel.err.offline")}<small>{detail}</small></p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>{t("panel.retry")}</button>}</div>;
  if (kind === "signin") return <div className="panel-alert" role="alert"><UserSwitch size={20} aria-hidden="true" />
    <p>{t("panel.err.signin")}</p><a className="secondary" href={`/auth?next=${encodeURIComponent(window.location.href)}`}>{t("panel.signIn")}</a></div>;
  return <div className="panel-alert" role="alert"><p>{detail}</p>{onRetry && <button type="button" className="secondary" onClick={onRetry}>{t("panel.retry")}</button>}</div>;
}
