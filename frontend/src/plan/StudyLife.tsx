import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../workspace/context";
import { PanelAlert, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { formatMoney } from "../backend/presenters";
import { pick } from "./format";
import { LifeItemCard } from "./LifeItems";
import { LifeBudget, LifeClock, TaskForm } from "./LifeForms";
import type { LifeControl } from "./useStudyLife";
import type { LifeItem } from "./lifeTypes";
import "./life.css";

/**
 * Reminder bell in the workspace top bar: the badge counts items needing attention (overdue, due within a week or
 * undated); the panel lists the first three and opens the to-do tool. A failed read shows a warning mark, not a count.
 */
export function UpcomingReminders({ control }: { control: LifeControl }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  const data = control.data;
  const count = data?.attention_count ?? 0;
  const go = (section?: string) => { setOpen(false); workspace?.open(section ? { kind: "life", section } : { kind: "life" }); };
  const bell = <div className="life-bell" ref={root}>
    <button ref={button} type="button" className={`life-bell-button${open ? " is-open" : ""}`} aria-expanded={open} aria-controls="life-bell-panel"
      aria-label={count ? t("life.bell", { n: count }) : t("life.bellNone")} title={t("life.recent")} onClick={() => setOpen(!open)}>
      <Bell size={20} weight={open ? "fill" : "regular"} aria-hidden="true" />
      {control.error && !data ? <span className="life-bell-badge is-error" aria-hidden="true">!</span>
        : count > 0 && <span className={`life-bell-badge${data?.unread_count ? " is-unread" : ""}`} aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </button>
    {open && <section id="life-bell-panel" className="life-bell-panel" aria-label={t("life.recent")}>
      <div className="life-bell-head"><strong>{t("life.recent")}</strong>{data && <small>{t("life.date")}: {data.today}</small>}</div>
      {!data ? <div className="life-bell-state">
        <p>{control.error ? t("life.failed") : t("common.loading")}</p>
        {control.error && <button type="button" className="chip" onClick={() => void control.refresh()}>{t("life.retry")}</button>}
      </div> : <>
        {data.upcoming.map(item => <button type="button" className={`life-bell-item is-${item.stage}`} key={item.source_key} onClick={() => go(item.source_key)}>
          <span className="life-bell-title">{item.unread && <i className="life-bell-new" aria-label={t("life.new")} />}
            {typeof item.title === "string" ? item.title : pick(item.title, lang)}</span>
          <small>{item.due_date ? `${item.due_date} · ${t(`life.${item.stage}` as MessageKey)}` : t("life.unknown")}</small>
        </button>)}
        {!data.upcoming.length && <p className="life-bell-state">{t("life.empty")}</p>}
        {count > data.upcoming.length && <p className="life-bell-more">{t("life.more", { n: count - data.upcoming.length })}</p>}
        {control.error && <p className="life-bell-more" role="alert">{t("life.failed")}</p>}
      </>}
      <button type="button" className="life-bell-all" onClick={() => go()}>{t("life.open")} →</button>
    </section>}
  </div>;
  // Rendered into the top bar; outside the workspace (no slot) it stays where it is mounted.
  return workspace?.bellHost ? createPortal(bell, workspace.bellHost) : bell;
}

export function StudyLifePanel({ control, preview, ask }: { control: LifeControl; preview: boolean; ask: (text: string) => void }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const data = control.data;
  const loaded = data !== null;
  const panel = useRef<HTMLDivElement>(null);
  const section = workspace?.target?.kind === "life" ? workspace.target.section : undefined;
  useEffect(() => {
    if (!section) return;
    const item = Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-source]") ?? []).find(node => node.dataset.source === section);
    const details = item?.closest("details");
    if (details) details.open = true;
    item?.scrollIntoView({ block: "nearest" });
  }, [section, loaded]);
  const open = (item: LifeItem) => {
    if (item.kind === "enrollment") { workspace?.close(); ask(lang === "zh" ? "我已完成报到，确认入学" : "I have completed registration. Confirm enrollment."); }
    else workspace?.open({ kind: "loans", section: item.source_key.split(":")[1] });
  };
  return <ToolPanel label={t("life.title")}><div className="life-panel" ref={panel}>
    <p className="panel-muted">{t(preview ? "life.preview" : "life.channel")}</p>
    {control.error && <PanelAlert message={control.error} onRetry={() => void control.refresh()} />}
    {!data ? <PanelSkeleton /> : <><p>{t("life.date")}: <strong>{data.today}</strong></p>
      <TaskForm control={control} preview={preview} />
      <section><h3>{t("life.recent")}</h3>{data.upcoming.map(item => <LifeItemCard key={item.source_key} item={item} control={control} preview={preview} onOpen={open} />)}
        {!data.upcoming.length && <p>{t("life.empty")}</p>}</section>
      <details><summary>{t("life.all")} ({data.items.length})</summary>
        {data.items.filter(item => !data.upcoming.some(r => r.source_key === item.source_key)).map(item =>
          <LifeItemCard key={item.source_key} item={item} control={control} preview={preview} onOpen={open} />)}</details>
      <section><h3>{t("life.forecast")}</h3>
        {data.funding.current ? <><p>{data.funding.as_of} → {data.funding.end_date}</p>
          <p>{t("life.gap")}: <strong>{formatMoney(data.funding.gap, "THB", lang)}</strong></p><p className="panel-muted">{t("life.forecastHint")}</p></>
          : <p>{t("life.stale")}{data.funding.as_of && ` (${data.funding.as_of})`}</p>}
        <button className="link-button" onClick={() => workspace?.open({ kind: "funding" })}>{t("life.plan")}</button></section>
      <LifeBudget control={control} preview={preview} /><LifeClock control={control} preview={preview} />
    </>}
  </div></ToolPanel>;
}
