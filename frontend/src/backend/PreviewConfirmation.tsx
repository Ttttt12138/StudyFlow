import { useI18n } from "../i18n";
import type { Draft, ImportRecord } from "./contracts";
import { formatDate, formatMoney } from "./presenters";

export function PreviewConfirmation({ draft, material, onContinue }: { draft: Draft; material: ImportRecord | null; onContinue: () => void }) {
  const { lang, t } = useI18n();
  const profile = draft.profile;
  const documented = draft.costs.filter(cost => cost.source_refs?.length);
  const conflicts = Object.entries(material?.result.merge_conflicts ?? {});
  const evidence = material?.result.draft?.profile.evidence ?? [];
  return <div className="preview-story">
    <section className="card preview-story-hero" aria-labelledby="preview-admission-title">
      <span className="eyebrow">{t("pv.conf.eyebrow")}</span><h2 id="preview-admission-title">{t("pv.conf.title")}</h2>
      <p>{t("pv.conf.intro")}</p>
      <div className="preview-story-facts">
        <div><span>{t("pv.conf.school")}</span><strong>{profile.school || t("plan.notSupplied")}</strong></div>
        <div><span>{t("pv.conf.program")}</span><strong>{[profile.program, profile.campus].filter(Boolean).join(" · ") || t("plan.notSupplied")}</strong></div>
        <div><span>{t("pv.conf.term")}</span><strong>{profile.semester || t("plan.notSupplied")}</strong></div>
        <div><span>{t("pv.conf.dates")}</span><strong>{formatDate(profile.start_date, lang)} – {formatDate(profile.end_date, lang)}</strong></div>
      </div>
      {conflicts.length > 0 && <p className="preview-conflict-hint">{t(conflicts.length === 1 ? "pv.conf.conflictOne" : "pv.conf.conflictMany", { count: conflicts.length })}</p>}
    </section>
    {conflicts.length > 0 && <section className="card preview-story-panel" aria-labelledby="preview-conflicts"><span className="eyebrow">{t("pv.conf.reviewEyebrow")}</span><h2 id="preview-conflicts">{t("pv.conf.disagree")}</h2><p>{t("pv.conf.disagreeText")}</p><ul>{conflicts.map(([field, values]) => <li key={field}><strong>{field.replace(/^profile\./, "").replaceAll("_", " ")}</strong><span>{Array.isArray(values) ? values.join(t("pv.conf.or")) : String(values)}</span></li>)}</ul></section>}
    <section className="card preview-story-panel" aria-labelledby="preview-documented-costs"><span className="eyebrow">{t("pv.conf.docEyebrow")}</span><h2 id="preview-documented-costs">{t("pv.conf.documented")}</h2>{documented.length ? <ul>{documented.map(cost => <li key={cost.cost_id}><strong>{cost.component || cost.category}</strong><span>{formatMoney(cost.amount, cost.currency ?? "THB", lang)}{cost.due_date ? t("pv.conf.due", { date: formatDate(cost.due_date, lang) }) : t("pv.conf.dueMissing")}</span></li>)}</ul> : <p>{t("pv.conf.noDocumented")}</p>}<small>{t("pv.conf.living")}</small></section>
    <details className="card preview-story-evidence"><summary>{t("pv.conf.evidence")}</summary>{evidence.length ? evidence.map((item, index) => <blockquote key={`${item.source_id}-${index}`}><strong>{item.field.replaceAll("_", " ")}</strong><span>{item.quote}</span><small>{item.locator}</small></blockquote>) : <p>{t("pv.conf.noEvidence")}</p>}{material?.result.draft?.costs.flatMap(cost => cost.evidence ?? []).map((item, index) => <blockquote key={`${item.source_id}-cost-${index}`}><strong>{t("pv.conf.costSource")}</strong><span>{item.quote}</span><small>{item.locator}</small></blockquote>)}</details>
    <div className="preview-story-next"><p>{t("pv.conf.next")}</p><button className="primary" onClick={onContinue}>{t("pv.conf.continue")} <span aria-hidden="true">→</span></button></div>
  </div>;
}
