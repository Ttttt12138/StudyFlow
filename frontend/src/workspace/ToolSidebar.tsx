import { Bank } from "@phosphor-icons/react/dist/csr/Bank";
import { CaretDoubleLeft } from "@phosphor-icons/react/dist/csr/CaretDoubleLeft";
import { CaretDoubleRight } from "@phosphor-icons/react/dist/csr/CaretDoubleRight";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { Coins } from "@phosphor-icons/react/dist/csr/Coins";
import { Compass } from "@phosphor-icons/react/dist/csr/Compass";
import { GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { LinkSimple } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { PreviewStageSwitch } from "../plan/PreviewStageSwitch";
import type { PreviewStage } from "../plan/preview";
import { RoleSwitch } from "../services/ModuleNav";
import type { PlanState } from "./context";
import type { ToolTarget } from "./navigation";
import { pick } from "../plan/format";
import type { Card, PlanHistory } from "../plan/types";

type Icon = ComponentType<{ size?: number; weight?: "light" | "regular" | "fill"; "aria-hidden"?: boolean | "true" }>;
type Item = { target: ToolTarget; label: MessageKey; icon: Icon };

/** Price lookup first. A confirmed plan adds "This month" (to-dos, payments and, once enrolled, spending);
 *  enrollment adds the wallet that pays the bills. The credit record is not a daily tool: it sits in the settings menu. */
const planning: Item[] = [
  { target: { kind: "compare" }, label: "simple.compare", icon: Scales },
  { target: { kind: "funding" }, label: "simple.plan", icon: Coins },
  { target: { kind: "loans" }, label: "simple.loans", icon: Bank },
];
const todo: Item = { target: { kind: "life" }, label: "life.title", icon: CalendarCheck };
const wallet: Item = { target: { kind: "wallet" }, label: "money.title", icon: ArrowsLeftRight };
const extras: Item[] = [{ target: { kind: "trust" }, label: "side.trust", icon: ShieldCheck }];

const same = (a: ToolTarget | null, b: ToolTarget) => !!a && a.kind === b.kind;
const SHOWN = 3;

/** One line per price lookup: the school and years, or the schools compared. */
function priceLabel(card: Card, t: ReturnType<typeof useI18n>["t"], lang: ReturnType<typeof useI18n>["lang"]) {
  if (card.type === "cost") return `${pick(card.school.name, lang)} · ${t("simple.years", { n: card.estimate.years })}`;
  if (card.type === "comparison") return card.schools.map(s => pick(s.name, lang)).join(" / ");
  return "";
}

/**
 * The workspace's left sidebar: new price question, the tools for the current stage, then tour and settings.
 * `compact` shows icons only; `drawer` is the phone layout, opened from the top bar.
 */
export function ToolSidebar({ active, status, gap, compact, drawer, preview, stage, account, signingOut, history = null, onOpenDraft,
  onOpen, onNewChat, onToggle, onClose, onStage, onSignOut }: {
  active: ToolTarget | null; status: PlanState["status"]; gap: boolean; compact: boolean; drawer: boolean; preview: boolean;
  history?: PlanHistory | null; onOpenDraft?: (id: string) => void;
  stage: PreviewStage; account: string; signingOut: boolean;
  onOpen: (target: ToolTarget) => void; onNewChat: () => void; onToggle: () => void; onClose: () => void;
  onStage: (stage: PreviewStage) => void; onSignOut: () => void;
}) {
  const { t, lang } = useI18n();
  const enrolled = status === "ENROLLED";
  const [allPrices, setAllPrices] = useState(false);
  const life = enrolled ? [todo, wallet] : status === "CONFIRMED" ? [todo] : [];
  const [settings, setSettings] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settings) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setSettings(false); } };
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setSettings(false); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside); };
  }, [settings]);

  const button = (item: Item) => {
    const Icon = item.icon;
    const current = same(active, item.target);
    const dot = item.target.kind === "funding" && gap;
    return <li key={item.label}>
      <button type="button" className="side-item" aria-current={current ? "true" : undefined} title={compact ? t(item.label) : undefined}
        aria-label={compact ? t(item.label) : undefined} onClick={() => onOpen(item.target)}>
        <Icon size={20} weight={current ? "fill" : "regular"} aria-hidden="true" />
        <span className="side-label">{t(item.label)}</span>
        {dot && <span className="side-dot" aria-label={t("side.gap")} role="img" />}
      </button>
      {!compact && item.target.kind === "compare" && history && history.prices.length > 0 && <>
        <ul className="side-history" aria-label={t("side.history.prices")}>
          {(allPrices ? history.prices : history.prices.slice(0, SHOWN)).map(row => <li key={row.id}>
            <button type="button" className="side-history-item" aria-current={active?.kind === "card" && active.cardId === row.id ? "true" : undefined}
              title={priceLabel(row.card, t, lang)} onClick={() => onOpen({ kind: "card", cardId: row.id })}>
              <span className="side-history-text">{priceLabel(row.card, t, lang)}</span></button></li>)}
        </ul>
        {history.prices.length > SHOWN && <button type="button" className="side-history-more" aria-expanded={allPrices}
          onClick={() => setAllPrices(!allPrices)}>{t(allPrices ? "side.history.less" : "side.history.more", { n: history.prices.length - SHOWN })}</button>}
      </>}
      {!compact && item.target.kind === "funding" && history && history.drafts.length > 0 &&
        <ul className="side-history" aria-label={t("side.history.drafts", { n: history.draft_limit })}>
          {history.drafts.map(draft => <li key={draft.id}>
            <button type="button" className="side-history-item" aria-current={draft.current ? "true" : undefined}
              disabled={draft.current ? false : !onOpenDraft || (status !== null && status !== "DRAFT")}
              title={!draft.current && status !== null && status !== "DRAFT" ? t("side.history.locked")
                : `${pick(draft.name, lang) || draft.school_key} · ${t("simple.years", { n: draft.years })}`}
              onClick={() => draft.current ? onOpen({ kind: "funding" }) : onOpenDraft?.(draft.id)}>
              <span className="side-history-text">{pick(draft.name, lang) || draft.school_key} · {t("simple.years", { n: draft.years })}</span>
              {draft.current && <small>{t("side.history.current")}</small>}</button></li>)}
        </ul>}
    </li>;
  };

  return <nav className={`tool-sidebar${compact ? " is-compact" : ""}${drawer ? " is-drawer" : ""}`} aria-label={t("ws.tools")}>
    <div className="side-head">
      <a className="side-brand" href="/" onClick={event => { event.preventDefault(); onClose(); }}>
        <span className="side-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17c4 0 5-10 9-10s4 6 7 6" /></svg></span>
        <span className="side-label">StudyFlow</span>
      </a>
      {drawer
        ? <button type="button" className="side-icon-button" aria-label={t("side.closeMenu")} onClick={onToggle}><X size={20} aria-hidden="true" /></button>
        : <button type="button" className="side-icon-button side-collapse" aria-label={t(compact ? "side.expand" : "side.collapse")}
          aria-expanded={!compact} onClick={onToggle}>{compact ? <CaretDoubleRight size={18} aria-hidden="true" /> : <CaretDoubleLeft size={18} aria-hidden="true" />}</button>}
    </div>
    <button type="button" className="side-item side-new" title={compact ? t("side.new") : undefined} aria-label={compact ? t("side.new") : undefined}
      disabled={preview} onClick={onNewChat}><Plus size={20} aria-hidden="true" /><span className="side-label">{t("side.new")}</span></button>
    <div className="side-scroll">
      <p className="side-group">{t("side.group.price")}</p>
      <ul>{planning.filter(item => item.target.kind !== "loans" || enrolled).map(button)}</ul>
      {life.length > 0 && <>
        <p className="side-group side-group-life">{t("side.group.life")}</p>
        <ul>{life.map(button)}</ul>
      </>}
      {!enrolled && !compact && <p className="side-later">{t(status === "CONFIRMED" ? "side.laterEnrolled" : "side.later")}</p>}
    </div>
    <div className="side-foot" ref={menu}>
      <a className="side-item" href="/?tour=1" title={compact ? t("side.tour") : undefined} aria-label={compact ? t("side.tour") : undefined}>
        <Compass size={20} aria-hidden="true" /><span className="side-label">{t("side.tour")}</span></a>
      <button type="button" className="side-item" aria-expanded={settings} aria-controls="side-settings" title={compact ? t("side.settings") : undefined}
        aria-label={compact ? t("side.settings") : undefined} onClick={() => setSettings(!settings)}>
        <GearSix size={20} aria-hidden="true" /><span className="side-label">{t("side.settings")}</span></button>
      {settings && <div id="side-settings" className="side-settings">
        <p className="side-account">{account || t("ws.signedOut")}</p>
        {preview && <><strong>{t("plan.preview.stage")}</strong><PreviewStageSwitch stage={stage} onChange={value => { setSettings(false); onStage(value); }} /></>}
        <button type="button" className="side-menu-item" onClick={() => { setSettings(false); onOpen({ kind: "family-links" }); }}>
          <LinkSimple size={18} aria-hidden="true" />{t("side.familyLinks")}</button>
        {enrolled && extras.map(item => { const Icon = item.icon; return <button key={item.label} type="button" className="side-menu-item"
          onClick={() => { setSettings(false); onOpen(item.target); }}><Icon size={18} aria-hidden="true" />{t(item.label)}</button>; })}
        <a className="side-menu-item" href="/intro">{t("sim.intro")}</a>
        <div className="side-role"><strong>{t("role.label")}</strong><RoleSwitch /></div>
        {account && !preview && <button type="button" className="side-menu-item" disabled={signingOut} onClick={onSignOut}>
          <SignOut size={18} aria-hidden="true" />{t(signingOut ? "ws.signingOut" : "ws.signOut")}</button>}
      </div>}
    </div>
  </nav>;
}
import { ArrowsLeftRight } from "@phosphor-icons/react/dist/csr/ArrowsLeftRight";
