import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { FocusDialog } from "../workspace/FocusDialog";
import { useWorkspace } from "../workspace/context";
import { needsJourneyIntro, readJourney, rememberJourney, type JourneyPhase } from "./journeyPhase";
import "./journeyIntro.css";

const PHASES = [0, 1, 2] as const;
const PARTICLES = [[4, 26], [12, 68], [18, 9], [23, 85], [32, 21], [39, 74], [47, 3], [53, 92],
  [61, 14], [68, 78], [75, 5], [81, 53], [87, 89], [94, 27], [7, 94], [96, 69]];

function AmbientParticles() {
  return <div className="journey-intro-ambient" aria-hidden="true">{PARTICLES.map(([left, top], index) =>
    <span key={index} style={{ left: `${left}%`, top: `${top}%`, width: `${2 + index % 3}px`, height: `${2 + index % 3}px`,
      animationDelay: `${-index * .7}s`, animationDuration: `${7 + index % 4}s` }} />)}</div>;
}

function useOtherDialog() {
  const [occupied, setOccupied] = useState(false);
  useEffect(() => {
    const check = () => setOccupied(!!document.querySelector("dialog[open]"));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    check();
    return () => observer.disconnect();
  }, []);
  return occupied;
}

function StageIcon({ phase }: { phase: JourneyPhase }) {
  const paths = ["M3 8 12 3l9 5-9 5-9-5Zm4 3v6c3 3 7 3 10 0v-6M21 8v9",
    "M8 6V4h8v2M5 7h14v14H5V7Zm3 0v14M16 7v14M3 11h18",
    "M3 6h16v3H3V6Zm0 3v12h18V9H3Zm13 4h5v4h-5v-4"];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[phase]} /></svg>;
}

function IntroCards({ current, selected, select }: { current: JourneyPhase; selected: JourneyPhase; select: (phase: JourneyPhase) => void }) {
  const { t } = useI18n();
  return <div className="journey-intro-cards">{PHASES.map(phase => <button type="button" key={phase}
    className={`journey-intro-card${selected === phase ? " is-focused" : ""}`}
    data-phase={phase} aria-pressed={selected === phase} aria-current={current === phase ? "step" : undefined}
    onClick={() => select(phase)}>
    <span className="journey-intro-card-top"><span>0{phase + 1}</span><span>{t(phase < current ? "plan.intro.done" : phase === current ? "plan.intro.current" : "plan.intro.future")}</span></span>
    <StageIcon phase={phase} /><strong>{t(`plan.intro.name.${phase}`)}</strong>
    <span className="journey-intro-description">{t(`plan.intro.description.${phase}`)}</span>
    <span className="journey-intro-complete" aria-hidden="true">{phase < current ? "✓" : ""}</span>
  </button>)}</div>;
}

export function JourneyIntro({ account, phase, blocked, preview }: {
  account: string; phase: JourneyPhase | undefined; blocked: boolean; preview: boolean;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const [seen, setSeen] = useState(() => readJourney(account));
  const [open, setOpen] = useState<JourneyPhase | null>(null);
  const [selected, setSelected] = useState<JourneyPhase>(0);
  const initial = useRef<JourneyPhase | undefined>(undefined);
  const occupied = useOtherDialog();
  const show = (value: JourneyPhase) => { setSelected(value); setOpen(value); };
  useEffect(() => {
    if (phase === undefined) return;
    initial.current ??= phase;
    if (open !== null || blocked || occupied || preview || !needsJourneyIntro(account, phase, seen)) return;
    if (workspace?.target && phase <= initial.current) return;
    show(phase);
  }, [account, phase, seen, blocked, occupied, preview, workspace?.target, open]);
  const close = () => {
    if (open !== null && !preview) { rememberJourney(account, open); setSeen(value => Math.max(value, open)); }
    setOpen(null);
  };
  return <>
    <button type="button" className="status-chip" disabled={phase === undefined || blocked}
      aria-label={t("plan.intro.review")} onClick={() => phase !== undefined && !occupied && show(phase)}>
      {phase === undefined ? t("plan.intro.review") : t(`plan.intro.name.${phase}`)} <span aria-hidden="true">↗</span>
    </button>
    {open !== null && <FocusDialog title={t("plan.intro.title")} onClose={close} className="journey-intro" initialFocusSelector="[aria-current='step']">
      <AmbientParticles />
      <div className="journey-intro-heading"><span className="journey-intro-eyebrow">STUDYFLOW · 0{open + 1} / 03</span>
        <h2>{t("plan.intro.title")}</h2><p>{t(`plan.intro.reason.${open}`)}</p></div>
      <IntroCards current={open} selected={selected} select={setSelected} />
      <p className="journey-intro-note">{t("plan.intro.note")}</p>
      <div className="journey-intro-actions"><button className="secondary" onClick={close}>{t("plan.intro.skip")}</button>
        <button className="primary" onClick={close}>{t(`plan.intro.start.${open}`)} <span aria-hidden="true">→</span></button></div>
    </FocusDialog>}
  </>;
}
