import type { PreviewScenario } from "./previewAdapter";

export function PreviewWalkthrough({ scenario, onOpenExpenses }: { scenario: PreviewScenario; onOpenExpenses: () => void }) {
  const estimated = scenario === "estimated";
  return <section className="preview-walkthrough" aria-labelledby="walkthrough-title">
    <span className="eyebrow">GUIDED DEMO</span>
    <h3 id="walkthrough-title">{estimated ? "Food is now an estimate in this demo" : "What could you do about the missing food cost?"}</h3>
    <p>{estimated ? "The expense, budget, payment calendar, and funding figures now come from one fixed example response set. Your real result may differ." : "Food has no amount in this sample. Open its expense card and try a fixed example estimate to see how the whole plan changes."}</p>
    <div className="preview-walkthrough-actions"><button className="primary" onClick={onOpenExpenses}>{estimated ? "Review or reset sample Food" : "Find the missing food cost"} <span aria-hidden="true">→</span></button></div>
    {estimated && <p className="preview-example-note">These are demo calculations supplied by mock responses. No value was calculated in your browser or saved to a student account.</p>}
  </section>;
}
