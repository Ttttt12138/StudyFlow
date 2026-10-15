import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { ArrowsIn } from "@phosphor-icons/react/dist/csr/ArrowsIn";
import { ArrowsOut } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { ChatCircleText } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CreditCard } from "@phosphor-icons/react/dist/csr/CreditCard";
import { Notebook } from "@phosphor-icons/react/dist/csr/Notebook";
import { Robot } from "@phosphor-icons/react/dist/csr/Robot";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { Coins } from "@phosphor-icons/react/dist/csr/Coins";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { useState, type ComponentType } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { ToolKind } from "./navigation";

const ICONS: Record<ToolKind, ComponentType<{ size?: number; weight?: "light" | "regular"; "aria-hidden"?: boolean | "true" }>> = {
  life: CalendarCheck, wallet: Wallet, payments: CreditCard, agent: Robot,
  compare: Scales, funding: Coins, plan: Notebook, card: ChatCircleText,
};

/**
 * Tool header: icon, title with a one-line purpose, a quiet preview tag and icon actions.
 * Refresh broadcasts the same event a write does, so whichever tool is open reloads its records.
 */
export function DockHeader({ kind, title, preview, canBack, backLabel, onBack, small, expanded, onExpand, onClose }: {
  kind: ToolKind | null; title: string; preview: boolean; canBack: boolean; onBack: () => void;
  /** Where back goes, e.g. "Back to the list" or "Back to Wallet"; shown as the tooltip and read out. */
  backLabel?: string;
  small: boolean; expanded: boolean; onExpand: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [spin, setSpin] = useState(0);
  const Icon = kind ? ICONS[kind] : null;
  return <div className="workspace-dock-header">
    {canBack && <button className="secondary" onClick={onBack} aria-label={backLabel ?? t("ws.back")} title={backLabel ?? t("ws.back")}><ArrowLeft size={16} aria-hidden="true" /></button>}
    {Icon && <span className="dock-icon" aria-hidden="true"><Icon size={20} weight="light" /></span>}
    <div className="dock-title">
      <div className="dock-title-row"><h2 id="workspace-tool-title">{title}</h2>
        {preview && <span className="workspace-preview">{t("agent.preview.title")}</span>}</div>
      {kind && <p className="dock-subtitle">{t(`ws.sub.${kind}` as MessageKey)}</p>}
    </div>
    <button className="secondary dock-refresh" aria-label={t("common.refresh")} data-spin={spin % 2}
      onClick={() => { setSpin((n) => n + 1); window.dispatchEvent(new Event("studyflow:write")); }}><ArrowsClockwise size={16} aria-hidden="true" /></button>
    {!small && <button className="secondary" onClick={onExpand} aria-label={t(expanded ? "ws.restore" : "ws.expand")}>
      {expanded ? <ArrowsIn size={16} aria-hidden="true" /> : <ArrowsOut size={16} aria-hidden="true" />}</button>}
    <button className="secondary" onClick={onClose} aria-label={t("ws.close")}><X size={16} aria-hidden="true" /></button>
  </div>;
}
