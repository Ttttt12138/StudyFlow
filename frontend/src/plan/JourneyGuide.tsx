import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import type { PendingAction, Plan } from "./types";
import { journeyPhase, type JourneyPhase } from "./journeyPhase";

export function JourneyGuide({ plan, phase = journeyPhase(plan.status), pending, ask, confirm, disabled }: {
  plan: Plan; pending?: PendingAction; ask: (text: string) => void; confirm: (id: string) => void; disabled: boolean;
  phase?: JourneyPhase;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const preparing = phase === 1;
  if (plan.status === "DRAFT") return null;
  if (phase === 0) return <li className="plan-journey-guide" id="plan-journey-guide" aria-label={t("plan.journey.next")}>
    <strong>{t("plan.intro.name.0")}</strong><p>{t("plan.intro.description.0")}</p>
    <div className="plan-card-actions">
      <button className="chip" disabled={disabled} onClick={() => ask(t("plan.intro.schoolsPrompt"))}>{t("plan.card.schools")}</button>
      <button className="chip" onClick={() => workspace?.open({ kind: "plan" })}>{t("ws.plan")}</button>
    </div>
  </li>;
  return <li className="plan-journey-guide" id="plan-journey-guide" aria-label={t("plan.journey.next")}>
    <strong>{t(preparing ? "plan.journey.CONFIRMED" : "plan.journey.ENROLLED")}</strong>
    <p>{t(preparing ? plan.status === "ENROLLED" ? "plan.intro.description.1" : "plan.journey.preparing" : "plan.journey.daily")}</p>
    <div className="plan-card-actions">
      {preparing ? <>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.housingPrompt"))}>{t("plan.journey.housing")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.departure"))}>{t("plan.journey.departure")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.firstBudget"))}>{t("plan.journey.firstBudget")}</button>
      </> : <>
        <button className="chip" onClick={() => workspace?.open({ kind: "bills" })}>{t("plan.journey.month")}</button>
        <button className="chip" onClick={() => workspace?.open({ kind: "bills", section: "expense" })}>{t("ws.record")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.campusPrompt"))}>{t("plan.journey.campus")}</button>
      </>}
    </div>
    {preparing && plan.status === "CONFIRMED" && <div className="plan-arrival-check">
      <p>{t(pending ? "plan.journey.arrival" : "plan.journey.progress")}</p>
      <div className="plan-card-actions">
        <button className="chip" disabled={disabled} onClick={() => pending ? confirm(pending.id) : ask(t("plan.journey.arrivedPrompt"))}>{t("plan.journey.arrived")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.notReady"))}>{t("plan.journey.notReady")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.dateChanged"))}>{t("plan.journey.dateChanged")}</button>
      </div>
    </div>}
  </li>;
}
