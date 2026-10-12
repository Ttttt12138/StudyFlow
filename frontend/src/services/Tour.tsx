import { useEffect, useRef } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { Module } from "./ModuleNav";

/** Where a tour stop lands: a stage of the planner preview, or a module preview. */
export type TourTarget = { kind: "home"; stage: "plan" | "school" } | { kind: Exclude<Module, "home"> };
type TourStop = { target: TourTarget; extra?: TourTarget };

// Follows the student's timeline: plan before leaving, then manage money, then share the record.
// Each stop may offer one side trip to the other person involved (family, operator, verifier).
export const tourStops: TourStop[] = [
  { target: { kind: "home", stage: "plan" } },
  { target: { kind: "home", stage: "school" } },
  { target: { kind: "family" }, extra: { kind: "sponsor" } },
  { target: { kind: "loans" }, extra: { kind: "copilot" } },
  { target: { kind: "wallet" }, extra: { kind: "ops" } },
  { target: { kind: "payments" } },
  { target: { kind: "agent" } },
  { target: { kind: "trust" }, extra: { kind: "verify" } },
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
