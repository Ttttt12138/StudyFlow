import type { Draft, ImportRecord } from "./contracts";
import { formatDate, formatMoney } from "./presenters";

export function PreviewConfirmation({ draft, material, onContinue }: { draft: Draft; material: ImportRecord | null; onContinue: () => void }) {
  const profile = draft.profile;
  const documented = draft.costs.filter(cost => cost.source_refs?.length);
  const conflicts = Object.entries(material?.result.merge_conflicts ?? {});
  const evidence = material?.result.draft?.profile.evidence ?? [];
  return <div className="preview-story">
    <section className="card preview-story-hero" aria-labelledby="preview-admission-title">
      <span className="eyebrow">YOUR ADMISSION · DEMO</span><h2 id="preview-admission-title">Start with what your documents say.</h2>
      <p>Check the school, dates, and documented costs before planning expenses. The source and any disagreement stay visible.</p>
      <div className="preview-story-facts">
        <div><span>School</span><strong>{profile.school || "Not supplied"}</strong></div>
        <div><span>Program and campus</span><strong>{[profile.program, profile.campus].filter(Boolean).join(" · ") || "Not supplied"}</strong></div>
        <div><span>Term</span><strong>{profile.semester || "Not supplied"}</strong></div>
        <div><span>Study dates</span><strong>{formatDate(profile.start_date)} – {formatDate(profile.end_date)}</strong></div>
      </div>
      {conflicts.length > 0 && <p className="preview-conflict-hint">{conflicts.length} source disagreement{conflicts.length === 1 ? "" : "s"} shown below. The tour cannot resolve or confirm it.</p>}
    </section>
    {conflicts.length > 0 && <section className="card preview-story-panel" aria-labelledby="preview-conflicts"><span className="eyebrow">NEEDS REVIEW</span><h2 id="preview-conflicts">Sources disagree</h2><p>A real student would choose a value before confirming. This preview keeps both source values.</p><ul>{conflicts.map(([field, values]) => <li key={field}><strong>{field.replace(/^profile\./, "").replaceAll("_", " ")}</strong><span>{Array.isArray(values) ? values.join(" or ") : String(values)}</span></li>)}</ul></section>}
    <section className="card preview-story-panel" aria-labelledby="preview-documented-costs"><span className="eyebrow">FROM THE DOCUMENT</span><h2 id="preview-documented-costs">Documented costs</h2>{documented.length ? <ul>{documented.map(cost => <li key={cost.cost_id}><strong>{cost.component || cost.category}</strong><span>{formatMoney(cost.amount, cost.currency ?? "THB")}{cost.due_date ? ` · due ${formatDate(cost.due_date)}` : " · due date missing"}</span></li>)}</ul> : <p>No documented costs were supplied.</p>}<small>Living costs and student estimates are reviewed separately in Complete expenses.</small></section>
    <details className="card preview-story-evidence"><summary>See original document evidence</summary>{evidence.length ? evidence.map((item, index) => <blockquote key={`${item.source_id}-${index}`}><strong>{item.field.replaceAll("_", " ")}</strong><span>{item.quote}</span><small>{item.locator}</small></blockquote>) : <p>No profile evidence was supplied.</p>}{material?.result.draft?.costs.flatMap(cost => cost.evidence ?? []).map((item, index) => <blockquote key={`${item.source_id}-cost-${index}`}><strong>Cost source</strong><span>{item.quote}</span><small>{item.locator}</small></blockquote>)}</details>
    <div className="preview-story-next"><p>In the connected journey, you can correct these fields, review evidence, and confirm your choices. This tour leaves the disagreement unresolved.</p><button className="primary" onClick={onContinue}>Explore expenses in this demo <span aria-hidden="true">→</span></button></div>
  </div>;
}
