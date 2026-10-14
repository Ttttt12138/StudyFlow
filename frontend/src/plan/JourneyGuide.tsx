import { AirplaneTilt } from "@phosphor-icons/react/dist/csr/AirplaneTilt";
import { Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { CalendarX } from "@phosphor-icons/react/dist/csr/CalendarX";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Hourglass } from "@phosphor-icons/react/dist/csr/Hourglass";
import { House } from "@phosphor-icons/react/dist/csr/House";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { Notebook } from "@phosphor-icons/react/dist/csr/Notebook";
import { NotePencil } from "@phosphor-icons/react/dist/csr/NotePencil";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import type { ComponentType, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import type { StudyLife } from "./lifeTypes";
import type { PendingAction, Plan } from "./types";
import { journeyPhase, type JourneyPhase } from "./journeyPhase";

type Icon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
type Row = { icon: Icon; label: string; value?: ReactNode; tone?: "warn" | "ok"; onClick: () => void; disabled?: boolean };

/**
 * The stage summary: a small card in the left sidebar (a list of what to do next, each with its figure on the right).
 * On phones, where the sidebar is a drawer, it stays in the conversation instead.
 */
export function JourneyGuide({ plan, phase = journeyPhase(plan.status), pending, life, ask, confirm, disabled }: {
  plan: Plan; pending?: PendingAction; life?: StudyLife | null; ask: (text: string) => void; confirm: (id: string) => void; disabled: boolean;
  phase?: JourneyPhase;
}) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  if (plan.status === "DRAFT") return null;
  const open = (kind: "life" | "plan", section?: string) => workspace?.open(section ? { kind, section } : { kind });
  const budget = life?.budget;
  // Sidebar figures are short: whole numbers without the currency (the 本月 panel has the full amounts).
  const short = (value: string) => Math.round(Number(value)).toLocaleString(lang === "zh" ? "zh-CN" : "en-US");
  const attention = life?.attention_count ?? 0;
  const month: Row = { icon: CalendarCheck, label: t("life.title"), onClick: () => open("life"),
    value: budget ? `${short(budget.spent)}${budget.budget_known ? ` / ${short(budget.budget)}` : ""}` : undefined };
  const todo: Row = { icon: ListChecks, label: t("life.todo"), onClick: () => open("life"),
    value: attention ? t("guide.items", { n: attention }) : t("guide.none"), tone: attention ? "warn" : "ok" };
  const sections: { title?: string; note?: string; rows: Row[] }[] =
    phase === 0 ? [{ rows: [
      { icon: Buildings, label: t("plan.card.schools"), onClick: () => ask(t("plan.intro.schoolsPrompt")), disabled },
      { icon: Notebook, label: t("ws.plan"), onClick: () => open("plan") }] }]
    : phase === 1 ? [
      { rows: [...(plan.status === "CONFIRMED" ? [todo] : []),
        { icon: House, label: t("plan.journey.housing"), onClick: () => ask(t("plan.journey.housingPrompt")), disabled },
        { icon: AirplaneTilt, label: t("plan.journey.departure"), onClick: () => ask(t("plan.journey.departure")), disabled },
        { icon: Wallet, label: t("plan.journey.firstBudget"), onClick: () => ask(t("plan.journey.firstBudget")), disabled }] },
      ...(plan.status === "CONFIRMED" ? [{ title: t("guide.arrival"), note: t(pending ? "plan.journey.arrival" : "plan.journey.progress"), rows: [
        { icon: CheckCircle, label: t("plan.journey.arrived"), onClick: () => pending ? confirm(pending.id) : ask(t("plan.journey.arrivedPrompt")), disabled,
          tone: pending ? "warn" as const : undefined, value: pending ? t("guide.toConfirm") : undefined },
        { icon: Hourglass, label: t("plan.journey.notReady"), onClick: () => ask(t("plan.journey.notReady")), disabled },
        { icon: CalendarX, label: t("plan.journey.dateChanged"), onClick: () => ask(t("plan.journey.dateChanged")), disabled }] }] : [])]
    : [{ rows: [month, todo,
        { icon: NotePencil, label: t("ws.record"), onClick: () => open("life", "record") },
        { icon: MapPin, label: t("plan.journey.campus"), onClick: () => ask(t("plan.journey.campusPrompt")), disabled }] }];
  const title = t(phase === 0 ? "plan.intro.name.0" : phase === 1 ? "plan.journey.CONFIRMED" : "plan.journey.ENROLLED");
  const body = <>
    <strong className="journey-summary-title">{title}</strong>
    {sections.map((section, index) => <div className="journey-summary-section" key={index}>
      {section.title && <p className="journey-summary-head" title={section.note}>{section.title}</p>}

      <ul>{section.rows.map(row => { const Icon = row.icon; return <li key={row.label}>
        <button type="button" className="journey-summary-row" disabled={row.disabled} onClick={row.onClick}>
          <Icon size={18} aria-hidden="true" /><span className="journey-summary-label">{row.label}</span>
          {row.value && <span className={`journey-summary-value${row.tone ? ` is-${row.tone}` : ""}`}>{row.value}</span>}
        </button></li>; })}</ul>
    </div>)}
    {phase > 0 && <p className="journey-summary-foot">{t(phase === 1 && plan.status === "CONFIRMED" ? "guide.notAdmission" : "guide.noBillPaid")}</p>}
  </>;
  return workspace?.guideHost
    ? createPortal(<section className="journey-summary" id="plan-journey-guide" aria-label={title}>{body}</section>, workspace.guideHost)
    : <li className="journey-summary is-inline" id="plan-journey-guide" aria-label={title}>{body}</li>;
}
