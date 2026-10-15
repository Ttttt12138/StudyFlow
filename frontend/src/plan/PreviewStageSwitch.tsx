import { useI18n, type MessageKey } from "../i18n";
import { previewStages, type PreviewStage } from "./preview";

const labels: Record<PreviewStage, MessageKey> = {
  plan: "plan.preview.stage1", prepare: "plan.preview.stagePrepare",
};

export function PreviewStageSwitch({ stage, onChange }: { stage: PreviewStage; onChange: (stage: PreviewStage) => void }) {
  const { t } = useI18n();
  return <div className="plan-stage-switch" role="group" aria-label={t("plan.preview.stage")}>
    {previewStages.map(item => <button key={item} type="button" aria-pressed={stage === item}
      onClick={() => onChange(item)}>{t(labels[item])}</button>)}
  </div>;
}
