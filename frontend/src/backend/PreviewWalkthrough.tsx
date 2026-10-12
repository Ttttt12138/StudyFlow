import { useI18n } from "../i18n";
import type { PreviewScenario } from "./previewAdapter";

export function PreviewWalkthrough({ scenario, onOpenExpenses }: { scenario: PreviewScenario; onOpenExpenses: () => void }) {
  const { t } = useI18n();
  const estimated = scenario === "estimated";
  return <section className="preview-walkthrough" aria-labelledby="walkthrough-title">
    <span className="eyebrow">{t("pv.walk.eyebrow")}</span>
    <h3 id="walkthrough-title">{estimated ? t("pv.walk.estimatedTitle") : t("pv.walk.missingTitle")}</h3>
    <p>{estimated ? t("pv.walk.estimatedText") : t("pv.walk.missingText")}</p>
    <div className="preview-walkthrough-actions"><button className="primary" onClick={onOpenExpenses}>{estimated ? t("pv.walk.review") : t("pv.walk.find")} <span aria-hidden="true">→</span></button></div>
    {estimated && <p className="preview-example-note">{t("pv.walk.note")}</p>}
  </section>;
}
