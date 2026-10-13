import { Bank } from "@phosphor-icons/react/dist/csr/Bank";
import { CaretDoubleLeft } from "@phosphor-icons/react/dist/csr/CaretDoubleLeft";
import { CaretDoubleRight } from "@phosphor-icons/react/dist/csr/CaretDoubleRight";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { ChartPie } from "@phosphor-icons/react/dist/csr/ChartPie";
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

type Icon = ComponentType<{ size?: number; weight?: "light" | "regular" | "fill"; "aria-hidden"?: boolean | "true" }>;
type Item = { target: ToolTarget; label: MessageKey; icon: Icon };

/** Price lookup first. A confirmed plan adds its to-dos and payments; the month's spending and the wallet that pays
 *  the bills follow enrollment. The credit record is not a daily tool: it sits in the settings menu. */
const planning: Item[] = [
  { target: { kind: "compare" }, label: "simple.compare", icon: Scales },
  { target: { kind: "funding" }, label: "simple.plan", icon: Coins },
  { target: { kind: "loans" }, label: "simple.loans", icon: Bank },
];
const todo: Item = { target: { kind: "life" }, label: "life.title", icon: ListChecks };
const spending: Item = { target: { kind: "spending" }, label: "plan.monthly.title", icon: ChartPie };
const wallet: Item = { target: { kind: "wallet" }, label: "money.title", icon: ArrowsLeftRight };
const extras: Item[] = [{ target: { kind: "trust" }, label: "side.trust", icon: ShieldCheck }];

const same = (a: ToolTarget | null, b: ToolTarget) => !!a && a.kind === b.kind;

/**
 * The workspace's left sidebar: new price question, the tools for the current stage, then tour and settings.
 * `compact` shows icons only; `drawer` is the phone layout, opened from the top bar.
 */
export function ToolSidebar({ active, status, gap, compact, drawer, preview, stage, account, signingOut,
  onOpen, onNewChat, onToggle, onClose, onStage, onSignOut }: {
  active: ToolTarget | null; status: PlanState["status"]; gap: boolean; compact: boolean; drawer: boolean; preview: boolean;
  stage: PreviewStage; account: string; signingOut: boolean;
  onOpen: (target: ToolTarget) => void; onNewChat: () => void; onToggle: () => void; onClose: () => void;
  onStage: (stage: PreviewStage) => void; onSignOut: () => void;
}) {
  const { t } = useI18n();
  const enrolled = status === "ENROLLED";
  const life = enrolled ? [todo, spending, wallet] : status === "CONFIRMED" ? [todo] : [];
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
      <ul>{planning.map(button)}</ul>
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
