import { useI18n } from "../i18n";
import { Donut, num } from "../workspace/PanelCharts";
import { useShow } from "./currency";
import { pick } from "./format";
import type { PlanningAssessment } from "./assessmentTypes";
import type { Estimate } from "./types";

const GROUPS = [["tuition", "#1677ff"], ["living", "#ff8a3d"], ["essentials", "#7fd0f0"]] as const;

export function PlanVisual({ data }: { data: PlanningAssessment }) {
  const { t, lang } = useI18n();
  const show = useShow();
  const estimate = data.estimate;
  if (!estimate) return null;
  const total = show(estimate.total, estimate.currency, lang);
  return <div className="plan-visual">
    <section className="plan-visual-hero">
      <p className="panel-muted">{data.plan?.school && pick(data.plan.school.name, lang)} · {t("simple.years", { n: estimate.years })}</p>
      <strong aria-label={t("simple.total")}>{total.main}</strong>
      {total.original && <small className="panel-muted">{total.original}</small>}
      <span className="panel-muted">{t("simple.firstYear")} {show(estimate.first_year, estimate.currency, lang).main}
        {estimate.complete === false && ` · ${t("simple.incomplete")}`}</span>
    </section>
    <CostMix estimate={estimate} />
  </div>;
}

function CostMix({ estimate }: { estimate: Estimate }) {
  const { t, lang } = useI18n();
  const show = useShow();
  return <section><h3 className="panel-section-title">{t("simple.costMix")}</h3>
    <Donut label={t("simple.costMix")} center={<strong>{t("simple.years", { n: estimate.years })}</strong>}
      slices={GROUPS.map(([group, color]) => ({ key: group, color, value: num(estimate.groups[group]),
        label: t(`plan.cost.group.${group}`), display: show(estimate.groups[group], estimate.currency, lang).main }))} />
  </section>;
}
