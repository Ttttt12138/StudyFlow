import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import type { StudyLife } from "./lifeTypes";
import type { Plan } from "./types";

export function JourneyGuide({ plan, life }: { plan: Plan; life?: StudyLife | null }) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  if (plan.status !== "CONFIRMED") return null;
  const body = <>
    <strong className="journey-summary-title">{t("side.stage.applied")}</strong>
    <ul className="journey-summary-section">
      <li><button className="journey-summary-row" onClick={() => workspace?.open({ kind: "funding" })}>{t("side.funding")}</button></li>
      <li><button className="journey-summary-row" onClick={() => workspace?.open({ kind: "life" })}>
        {t("life.title")} · {t("guide.items", { n: life?.attention_count ?? 0 })}</button></li>
      <li><button className="journey-summary-row" onClick={() => workspace?.open({ kind: "wallet" })}>{t("side.wallet")}</button></li>
    </ul>
  </>;
  return workspace?.guideHost
    ? createPortal(<section className="journey-summary" id="plan-journey-guide">{body}</section>, workspace.guideHost)
    : <li className="journey-summary is-inline" id="plan-journey-guide">{body}</li>;
}
