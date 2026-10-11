import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { prefersReducedMotion, supportsWebGL2, useScramble } from "./motion";
import { Heading, Reveal } from "./ui";
import { useWorld } from "./WorldCanvas";
import { SafetyDemo, type DemoKind } from "./SafetyDemos";

const safety: { title: MessageKey; body: MessageKey; mark: DemoKind; color: string }[] = [
  { title: "intro.safety.sim.title", body: "intro.safety.sim.body", mark: "SIM", color: "#f2c879" },
  { title: "intro.safety.agent.title", body: "intro.safety.agent.body", mark: "AI", color: "#c6a6f6" },
  { title: "intro.safety.tiers.title", body: "intro.safety.tiers.body", mark: "T3", color: "#f2b98a" },
];

/** Whether the closing chapters can ride the world camera (same rule as the features). */
function useCinematic() {
  const { failed } = useWorld();
  const [capable] = useState(() => !prefersReducedMotion() && supportsWebGL2());
  return capable && !failed;
}

/** Index of the step in view while a tall section with a sticky stage scrolls past. */
function useStep(ref: React.RefObject<HTMLElement | null>, steps: number) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(1, el.offsetHeight - window.innerHeight);
      setStep(Math.round(Math.min(1, Math.max(0, (window.scrollY - top) / span)) * (steps - 1)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [ref, steps]);
  return step;
}

export function Safety() {
  return useCinematic() ? <SafetyVault /> : <SafetyList />;
}

export function Start() {
  return useCinematic() ? <StartFinale /> : <StartPlain />;
}

/**
 * The camera holds on the hexagonal vault while three safety points take turns; the copy
 * names the one in view and the wall's light pattern changes with it.
 */
function SafetyVault() {
  const { t } = useI18n();
  const { world } = useWorld();
  const ref = useRef<HTMLElement>(null);
  const step = useStep(ref, safety.length);
  const title = t("intro.safety.title");
  const shown = useScramble(title, true, 600);

  useEffect(() => {
    if (!world) return;
    world.setSection("safety", ref.current);
    return () => world.setSection("safety", null);
  }, [world]);

  return (
    <section id="safety" ref={ref} className="intro-vault" aria-labelledby="intro-safety-title" style={{ "--vault-steps": safety.length } as CSSProperties}>
      <div className="intro-vault-stage">
        <div className="intro-vault-head">
          <p className="intro-eyebrow">{t("intro.safety.eyebrow")}</p>
          <h2 id="intro-safety-title" className="intro-vault-title">
            <span className="intro-visually-hidden">{title}</span>
            <span aria-hidden="true"><span className="intro-vault-slash">\ </span>{shown}<span className="intro-vault-arrow"> →</span></span>
          </h2>
          <p className="intro-vault-statement">{t("intro.safety.statement")}</p>
        </div>
        <ol className="intro-vault-points">
          {safety.map((item, i) => (
            <li key={item.mark} aria-current={i === step ? "true" : undefined} style={{ "--accent": item.color } as CSSProperties}>
              <span className="intro-vault-mark" aria-hidden="true">{String(i + 1).padStart(2, "0")} · {item.mark}</span>
              <h3>{t(item.title)}</h3>
              <p>{t(item.body)}</p>
              <SafetyDemo kind={item.mark} active={i === step} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The globe chapter: the plan as one line of display type, the ways in, and the simulation notice. */
function StartFinale() {
  const { t } = useI18n();
  const { world } = useWorld();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!world) return;
    world.setSection("start", ref.current);
    return () => world.setSection("start", null);
  }, [world]);

  const links: { href: string; key: MessageKey }[] = [
    { href: "/?wallet=preview", key: "intro.start.link.wallet" },
    { href: "/?trust=preview", key: "intro.start.link.trust" },
    { href: "/?agent=preview", key: "intro.start.link.agent" },
    { href: "/", key: "intro.start.link.app" },
  ];
  return (
    <section id="start" ref={ref} className="intro-finale" aria-labelledby="intro-start-title">
      <p className="intro-finale-mark"><span aria-hidden="true">✦ </span>StudyFlow<span aria-hidden="true"> ✦</span></p>
      <h2 id="intro-start-title" className="intro-finale-flow">
        <span>{t("intro.start.flow1")}</span><i aria-hidden="true">→</i>
        <span>{t("intro.start.flow2")}</span><i aria-hidden="true">→</i>
        <span>{t("intro.start.flow3")}</span>
      </h2>
      <p className="intro-finale-lede">{t("intro.start.title")} {t("intro.start.lede")}</p>
      <div className="intro-finale-cta">
        <a className="intro-pill" href="/">{t("intro.start.plan")}</a>
        <a className="intro-pill intro-pill-ghost" href="/?agent=preview">{t("intro.start.preview")}</a>
      </div>
      <ul className="intro-finale-links" aria-label={t("intro.start.links")}>
        {links.map((link) => <li key={link.key}><a href={link.href}>{t(link.key)}</a></li>)}
      </ul>
      <p className="intro-finale-note"><span>[ {t("sim.pill")} ]</span> {t("intro.start.note")}</p>
    </section>
  );
}

function SafetyList() {
  const { t } = useI18n();
  return (
    <section id="safety" className="intro-section" aria-labelledby="intro-safety-title">
      <p className="intro-eyebrow">{t("intro.safety.eyebrow")}</p>
      <Heading id="intro-safety-title" text={t("intro.safety.title")} className="intro-section-title" />
      <div className="intro-safety">
        {safety.map((item, i) => (
          <Reveal key={item.mark} className="intro-safety-item" style={{ transitionDelay: `${i * 90}ms` }}>
            <span className="intro-safety-mark" aria-hidden="true">{item.mark}</span>
            <h3>{t(item.title)}</h3>
            <p>{t(item.body)}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function StartPlain() {
  const { t } = useI18n();
  return (
    <section id="start" className="intro-section intro-start" aria-labelledby="intro-start-title">
      <Heading id="intro-start-title" text={t("intro.start.title")} className="intro-start-title" />
      <p className="intro-lede">{t("intro.start.lede")}</p>
      <div className="intro-actions">
        <a className="intro-button" href="/">{t("intro.start.plan")}</a>
        <a className="intro-button intro-button-ghost" href="/?agent=preview">{t("intro.start.preview")}</a>
      </div>
    </section>
  );
}
