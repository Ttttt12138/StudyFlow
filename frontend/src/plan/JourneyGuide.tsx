import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import type { PendingAction, Plan } from "./types";

export function JourneyGuide({ plan, pending, ask, confirm, disabled }: {
  plan: Plan; pending?: PendingAction; ask: (text: string) => void; confirm: (id: string) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const preparing = plan.status === "CONFIRMED";
  if (plan.status === "DRAFT") return null;
  return <li className="plan-journey-guide" id="plan-journey-guide" aria-label={t("plan.journey.next")}>
    <strong>{t(preparing ? "plan.journey.CONFIRMED" : "plan.journey.ENROLLED")}</strong>
    <p>{t(preparing ? "plan.journey.preparing" : "plan.journey.daily")}</p>
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
    {preparing && <div className="plan-arrival-check">
      <p>{t(pending ? "plan.journey.arrival" : "plan.journey.progress")}</p>
      <div className="plan-card-actions">
        <button className="chip" disabled={disabled} onClick={() => pending ? confirm(pending.id) : ask(t("plan.journey.arrivedPrompt"))}>{t("plan.journey.arrived")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.notReady"))}>{t("plan.journey.notReady")}</button>
        <button className="chip" disabled={disabled} onClick={() => ask(t("plan.journey.dateChanged"))}>{t("plan.journey.dateChanged")}</button>
      </div>
    </div>}
  </li>;
}
