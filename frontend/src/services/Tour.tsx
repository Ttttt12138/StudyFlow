import { useEffect, useRef } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { ToolKind } from "../workspace/navigation";
import type { PreviewStage } from "../plan/preview";

/** Where a tour stop lands: the planner preview at a journey stage, optionally with one workspace tool
 *  open beside the conversation, or one of the separate role pages (family member, operator, verifier). */
export type TourTarget = { kind: "home"; stage: PreviewStage; tool?: ToolKind } | { kind: "sponsor" | "ops" | "verify" };
type TourStop = { target: TourTarget; extra?: TourTarget };

// Follows the planner's journey: consultation and funding, preparing before enrollment, then daily life
// with the money tools, then sharing the record. Tool stops keep the conversation at the matching stage behind them.
// Each stop may offer one side trip: another tool, or the other person involved.
export const tourStops: TourStop[] = [
  { target: { kind: "home", stage: "plan" } },
  { target: { kind: "home", stage: "plan", tool: "family" }, extra: { kind: "sponsor" } },
  { target: { kind: "home", stage: "plan", tool: "loans" }, extra: { kind: "home", stage: "plan", tool: "copilot" } },
  { target: { kind: "home", stage: "prepare" } },
  { target: { kind: "home", stage: "school" }, extra: { kind: "home", stage: "school", tool: "spending" } },
  { target: { kind: "home", stage: "school", tool: "wallet" }, extra: { kind: "ops" } },
  { target: { kind: "home", stage: "school", tool: "payments" } },
  { target: { kind: "home", stage: "school", tool: "agent" } },
  { target: { kind: "home", stage: "school", tool: "trust" }, extra: { kind: "verify" } },
];

/** Bottom bar for the guided demo: what this stop shows, a side trip, and back / next / exit. */
export function TourBar({ index, onGo, onExtra, onExit }: { index: number; onGo: (index: number) => void; onExtra: (target: TourTarget) => void; onExit: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLElement | null>(null);
  const stop = tourStops[index];
  const last = index === tourStops.length - 1;
  // Pages reserve room for the bar so it never covers their last section.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--tour-height", `${(ref.current?.offsetHeight ?? 0) + 24}px`);
    sync();
    root.classList.add("has-tour");
    const observer = new ResizeObserver(sync);
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); root.classList.remove("has-tour"); root.style.removeProperty("--tour-height"); };
  }, []);
  return (
    <section ref={ref} className="tour-bar" aria-label={t("tour.label")}>
      <div className="tour-count">
        <span>{t("tour.label")} · {t("tour.step", { n: index + 1, total: tourStops.length })}</span>
        <div className="tour-dots">
          {tourStops.map((_, i) => <button key={i} type="button" className={i < index ? "done" : ""} aria-current={i === index ? "step" : undefined}
            aria-label={`${t("tour.step", { n: i + 1, total: tourStops.length })}: ${t(`tour.${i}.title` as MessageKey)}`} onClick={() => onGo(i)} />)}
        </div>
      </div>
      <div className="tour-copy" aria-live="polite">
        <strong>{t(`tour.${index}.title` as MessageKey)}</strong>
        <p>{t(`tour.${index}.text` as MessageKey)}</p>
        {stop.extra && <button type="button" className="tour-extra" onClick={() => onExtra(stop.extra!)}>{t(`tour.${index}.extra` as MessageKey)} →</button>}
      </div>
      <div className="tour-actions">
        <button type="button" className="tour-exit" onClick={onExit}>{t("tour.exit")}</button>
        <button type="button" className="secondary" disabled={index === 0} onClick={() => onGo(index - 1)}>{t("tour.prev")}</button>
        <button type="button" className="primary" onClick={() => last ? onExit() : onGo(index + 1)}>{last ? t("tour.finish") : t("tour.next")}</button>
      </div>
    </section>
  );
}
