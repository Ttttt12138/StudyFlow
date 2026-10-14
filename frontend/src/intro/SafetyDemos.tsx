import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { prefersReducedMotion } from "./motion";

export type DemoKind = "SIM" | "AI" | "T3";

// Phase lengths (ms) of each looping demo; the last phase is the resting state shown with reduced motion.
const SIM_PHASES = [700, 1500, 900, 1900];
const AI_PHASES = [1600, 1300, 1300, 1900];
const TIER_PHASES = [550, 550, 1300, 900, 1900];

/** Steps through `durations` in a loop while active; rests on phase 0 when inactive. */
function usePhase(active: boolean, durations: number[]) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) { setPhase(0); return; }
    if (prefersReducedMotion()) { setPhase(durations.length - 1); return; }
    let index = 0, timer = 0;
    const next = () => { timer = window.setTimeout(() => { index = (index + 1) % durations.length; setPhase(index); next(); }, durations[index]); };
    setPhase(0);
    next();
    return () => window.clearTimeout(timer);
  }, [active, durations]);
  return phase;
}

/** 0 → 1 over `ms` while `running`; 1 when finished, 0 when not running. */
function useProgress(running: boolean, ms: number) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!running) { setValue(0); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // rAF timestamps can be slightly earlier than performance.now(), so clamp at 0 too.
      const t = Math.min(1, Math.max(0, (now - start) / ms));
      setValue(t);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, ms]);
  return value;
}

const money = (lang: string, currency: string, amount: number) =>
  `${currency} ${new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;

/**
 * A short looping illustration of one safety point; decorative, the card text carries the meaning.
 * Marked translate="no": page-translation extensions swap text nodes, and React then fails to
 * remove the ones it put there as the demo changes state.
 */
export function SafetyDemo({ kind, active }: { kind: DemoKind; active: boolean }) {
  return (
    <div className={`intro-demo intro-demo-${kind.toLowerCase()}`} aria-hidden="true" translate="no">
      {kind === "SIM" ? <SimDemo active={active} /> : kind === "AI" ? <AgentDemo active={active} /> : <TierDemo active={active} />}
    </div>
  );
}

function SimDemo({ active }: { active: boolean }) {
  const { lang, t } = useI18n();
  const phase = usePhase(active, SIM_PHASES);
  const flow = useProgress(phase === 1, SIM_PHASES[1]);
  const received = phase >= 2 ? 23810.5 : 23810.5 * (1 - (1 - flow) ** 3);
  return (
    <>
      <div className="intro-demo-row">
        <span className="intro-demo-chip">{money(lang, "CNY", 5000)}</span>
        <span className={`intro-demo-wire${phase === 1 ? " is-flowing" : ""}`}><i style={{ left: `${(phase >= 2 ? 1 : flow) * 100}%` }} /></span>
        <span className={`intro-demo-chip intro-demo-gold${phase >= 1 ? "" : " is-dim"}`}>{money(lang, "THB", received)}</span>
      </div>
      <div className="intro-demo-row intro-demo-muted">
        <span>{t("intro.demo.sim.bank")}</span>
        <span className="intro-demo-cut" />
        <span className="intro-demo-no">✕ {t("intro.demo.sim.none")}</span>
      </div>
      <span className={`intro-demo-stamp${phase >= 2 ? " is-on" : ""}`}>{t("intro.demo.sim.stamp")}</span>
    </>
  );
}

function AgentDemo({ active }: { active: boolean }) {
  const { t } = useI18n();
  const phase = usePhase(active, AI_PHASES);
  const ask = t("intro.demo.agent.ask");
  const typed = useProgress(phase === 0 && active, AI_PHASES[0] * 0.8);
  const shown = phase === 0 ? ask.slice(0, Math.ceil(ask.length * typed)) : ask;
  const confirmed = phase >= 2;
  return (
    <>
      <div className="intro-demo-row">
        <span className="intro-demo-bot">AI</span>
        <span className="intro-demo-bubble"><span>{shown}</span>{phase === 0 && <b className="intro-demo-caret" />}</span>
      </div>
      <span className={`intro-demo-status${confirmed ? " is-ok" : ""}`}>{t(confirmed ? "intro.demo.agent.confirmed" : "intro.demo.agent.proposed")}</span>
      <div className="intro-demo-row">
        <span className={`intro-demo-btn is-locked${phase === 1 ? " is-shake" : ""}`}>🔒 {t(phase === 1 ? "intro.demo.agent.blocked" : "intro.demo.agent.ai")}</span>
        <span className={`intro-demo-btn intro-demo-you${phase === 2 ? " is-press" : ""}${confirmed ? " is-done" : ""}`}>{t("intro.demo.agent.you")}</span>
      </div>
    </>
  );
}

const tiers: { tier: string; key: MessageKey }[] = [
  { tier: "T0", key: "intro.demo.tiers.t0" },
  { tier: "T1", key: "intro.demo.tiers.t1" },
  { tier: "T2", key: "intro.demo.tiers.t2" },
  { tier: "T3", key: "intro.demo.tiers.t3" },
];

function TierDemo({ active }: { active: boolean }) {
  const { t } = useI18n();
  const phase = usePhase(active, TIER_PHASES);
  const typing = useProgress(phase === 2, TIER_PHASES[2] * 0.85);
  const dots = phase > 2 ? 6 : phase === 2 ? Math.floor(typing * 6) : 0;
  return (
    <ol className="intro-demo-tiers">
      {tiers.map((row, i) => {
        const lit = phase >= i || (i === 3 && phase >= 3);
        const done = i < 2 ? phase >= i : i === 2 ? phase > 2 : phase >= 4;
        return (
          <li key={row.tier} className={`${lit ? "is-lit" : ""}${done ? " is-done" : ""}`}>
            <span className="intro-demo-tier">{row.tier}</span>
            <span className="intro-demo-tier-label">{t(row.key)}</span>
            <span className="intro-demo-tier-state">
              {i === 2 && lit && !done ? <span className="intro-demo-dots"><span>{"●".repeat(dots)}</span><s>{"●".repeat(6 - dots)}</s></span>
                : i === 3 && phase === 3 ? <span className="intro-demo-wait">{t("intro.demo.tiers.pending")}</span>
                : done ? <span>✓</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
