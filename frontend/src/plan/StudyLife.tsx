import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useToolRefresh, useWorkspace } from "../workspace/context";
import { PanelAlert, PanelSkeleton, ToolPanel } from "../workspace/ToolPanel";
import { formatMoney } from "../backend/presenters";
import { pick } from "./format";
import { LifeItemDetail, LifeItemRow, titleOf } from "./LifeItems";
import { ClockForm, TaskForm } from "./LifeForms";
import { PanelPage } from "../workspace/PanelPage";
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

type View = { page: "list" } | { page: "item"; key: string } | { page: "add" } | { page: "clock" };
type Filter = "soon" | "later" | "done";
const SOON = new Set(["overdue", "due", "tomorrow", "week", "unknown"]);

/**
 * To-dos, bills, wallet coverage and loan installments in one place. Rows open their own
 * page (back returns to the list); nothing is folded away.
 */
export function StudyLifePanel({ control, preview, ask }: { control: LifeControl; preview: boolean; ask: (text: string) => void }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const data = control.data;
  const [view, setView] = useState<View>({ page: "list" });
  const [filter, setFilter] = useState<Filter>("soon");
  const stale = useToolRefresh(control.refresh);
  // Links into the panel: ?section=<source key> opens that item.
  const section = workspace?.target?.kind === "life" ? workspace.target.section : undefined;
  useEffect(() => {
    if (section) setView({ page: "item", key: section });
  }, [section]);
  const open = (_item: LifeItem) => workspace?.open({ kind: "funding" });
  const back = () => setView({ page: "list" });
  const page = (title: string, body: ReactNode) => <ToolPanel label={t("life.title")} notices={stale}><div className="life-panel">
    {control.error && <PanelAlert message={control.error} onRetry={() => void control.refresh()} />}
    <PanelPage title={title} onBack={back}>{body}</PanelPage></div></ToolPanel>;

  if (data && view.page === "item") {
    const item = data.items.find(row => row.source_key === view.key);
    if (item) return page(titleOf(item, lang), <LifeItemDetail item={item} control={control} preview={preview} onOpen={open} />);
  }
  if (view.page === "add") return page(t("life.add"), <TaskForm control={control} preview={preview} onDone={back} />);
  if (view.page === "clock") return page(t("life.clock"), <ClockForm control={control} preview={preview} onDone={back} />);
  const gapDate = null;
  const open7 = data ? data.items.filter(item => !item.done && SOON.has(item.stage)) : [];
  const groups: Record<Filter, LifeItem[]> = { soon: open7,
    later: data ? data.items.filter(item => !item.done && !SOON.has(item.stage)) : [], done: data ? data.items.filter(item => item.done) : [] };
  const currency = open7.find(item => item.amount !== null)?.currency ?? "THB";
  const dueSoon = open7.filter(item => item.amount !== null && item.stage !== "unknown" && item.currency === currency);
  const dueSum = dueSoon.reduce((sum, item) => sum + Number(item.amount), 0);
  // Shortfalls use today's balance only, so only the next 7 days earn the warning banner; later ones get a quiet
  // line on their own tab, oldest due date first, saying what the check is based on.
  const short = groups.soon.filter(item => item.at_risk);
  const shortLater = groups.later.filter(item => item.at_risk).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const walletChecked = data?.items.some(item => !item.done && item.shortfall_basis === "wallet");
  const money = (value: string | number, cur = currency) => formatMoney(String(value), cur, lang);

  return <ToolPanel label={t("life.title")} notices={stale}><div className="life-panel">
    {control.error && <PanelAlert message={control.error} onRetry={() => void control.refresh()} />}
    {!data ? <PanelSkeleton /> : <>
      <div className="life-head">
        <button type="button" className="link-button life-date" onClick={() => setView({ page: "clock" })}>{t("life.date")} {data.today}</button>
        <button type="button" className="link-button" disabled={preview} onClick={() => setView({ page: "add" })}>＋ {t("life.add")}</button>
      </div>

      <section className="life-todo" aria-label={t("life.todo")}>
        <div className="life-section-head"><h3>{t("life.todo")}</h3>
          <div className="life-filter" role="group" aria-label={t("life.todo")}>{(["soon", "later", "done"] as const).map(key =>
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{t(`life.filter.${key}` as MessageKey)} {groups[key].length}</button>)}</div>
        </div>
        {filter === "soon" && dueSoon.length > 0 && <p className="life-summary-line">{t("life.dueSoon", { n: dueSoon.length, amount: money(dueSum) })}</p>}
        {short.length > 0 ? <button type="button" className="life-gap" onClick={() => setView({ page: "item", key: short[0].source_key })}>
            {t("life.notEnough", { title: titleOf(short[0], lang), n: short.length })} →</button>
          : filter === "later" && shortLater.length > 0 ? <button type="button" className="life-summary-line" onClick={() => setView({ page: "item", key: shortLater[0].source_key })}>
            {t("life.laterShort", { title: titleOf(shortLater[0], lang), date: shortLater[0].due_date ?? "", n: shortLater.length })}</button>
          : walletChecked && !shortLater.length && <p className="life-ok">{t("life.enough")}</p>}
        <div className="life-list">{groups[filter].map(item => <LifeItemRow key={item.source_key} item={item} gapDate={gapDate}
          onSelect={row => setView({ page: "item", key: row.source_key })} />)}
          {!groups[filter].length && <p className="life-empty">{t(filter === "soon" ? "life.nothingSoon" : filter === "later" ? "life.nothingLater" : "life.nothingDone")}</p>}</div>
      </section>

    </>}
  </div></ToolPanel>;
}
