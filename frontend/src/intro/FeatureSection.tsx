import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../i18n";
import { featureKey, features, type FeatureId } from "./features";
import { prefersReducedMotion, supportsWebGL2, useScramble } from "./motion";
import { Heading, Reveal, trackPointer } from "./ui";
import { ART_H, ART_W, drawIllustration } from "./wall/illustrations";
import { useWorld } from "./WorldCanvas";

/**
 * The seven features: a flight through the 3D glass helix in the shared world canvas when
 * WebGL 2 and motion are available, otherwise a card grid.
 */
export function Features() {
  const { failed } = useWorld();
  const [capable] = useState(() => !prefersReducedMotion() && supportsWebGL2());
  return capable && !failed ? <FeatureWall /> : <FeatureGrid />;
}

function FeatureGrid() {
  const { t } = useI18n();
  return (
    <section id="features" className="intro-section" aria-labelledby="intro-features-title">
      <p className="intro-eyebrow">{t("intro.features.eyebrow")}</p>
      <Heading id="intro-features-title" text={t("intro.features.title")} className="intro-section-title" />
      <ol className="intro-features">
        {features.map((feature, i) => (
          <Reveal as="li" key={feature.id} className="intro-feature" style={{ "--accent": feature.color, transitionDelay: `${(i % 3) * 80}ms` } as CSSProperties}>
            <a href={feature.href} onPointerMove={trackPointer}>
              <FeatureArt id={feature.id} color={feature.color} />
              <span className="intro-feature-index">{String(i + 1).padStart(2, "0")}</span>
              <span className="intro-feature-tags">{t(featureKey(feature.id, "tags"))}</span>
              <strong className="intro-feature-title">{t(featureKey(feature.id, "title"))}</strong>
              <span className="intro-feature-body">{t(featureKey(feature.id, "body"))}</span>
              <span className="intro-feature-open">{t("intro.features.open")} <span aria-hidden="true">→</span></span>
            </a>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

/** The feature's drawn artwork as a static picture, for the grid that stands in for the helix. */
function FeatureArt({ id, color }: { id: FeatureId; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      canvas.width = ART_W + 48;
      canvas.height = ART_H + 72;
      const ctx = canvas.getContext("2d");
      if (ctx) drawIllustration(ctx, id, color, 24, 48);
    };
    draw();
    let current = true;
    document.fonts?.ready.then(() => { if (current) draw(); });
    return () => { current = false; };
  }, [id, color]);
  return <canvas ref={ref} className="intro-feature-art" aria-hidden="true" />;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A tall section with a sticky stage: scrolling through it flies the world camera along the
 * helix, one slab per step. The copy on the left always describes the slab in focus and
 * carries the real link, so the canvas itself stays decorative.
 */
function FeatureWall() {
  const { world } = useWorld();
  const { lang, t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const activeRef = useRef(0);
  activeRef.current = active;

  const cards = useMemo(() => features.map((feature, index) => ({
    id: feature.id, index, color: feature.color, lang, title: t(featureKey(feature.id, "title")), tags: t(featureKey(feature.id, "tags")),
  })), [lang, t]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  const span = () => {
    const section = sectionRef.current;
    return section ? { top: section.getBoundingClientRect().top + window.scrollY, length: Math.max(1, section.offsetHeight - window.innerHeight) } : null;
  };
  const jump = useCallback((index: number) => {
    const s = span();
    if (s) window.scrollTo({ top: s.top + (index / (features.length - 1)) * s.length, behavior: "smooth" });
  }, []);

  // The copy follows the slab in focus; the world reads the same scroll position for the camera.
  useEffect(() => {
    const onScroll = () => {
      const s = span();
      if (!s) return;
      setActive(Math.round(Math.min(1, Math.max(0, (window.scrollY - s.top) / s.length)) * (features.length - 1)));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!world) return;
    world.setSection("features", sectionRef.current);
    world.setFeatureHandlers({
      // Clicking the slab in focus opens it; clicking another one flies to it first.
      onSelect: (index) => { if (index === activeRef.current) window.location.href = features[index].href; else jump(index); },
      onHover: setHovered,
    });
    return () => { world.setSection("features", null); world.setFeatureHandlers(null); };
  }, [world, jump]);

  useEffect(() => {
    if (!world) return;
    world.setCards(cards);
    // Slab artwork uses the web fonts; redraw once they are in.
    let current = true;
    document.fonts?.ready.then(() => { if (current) world.setCards(cardsRef.current); });
    return () => { current = false; };
  }, [world, cards]);

  const feature = features[active];
  const title = t(featureKey(feature.id, "title"));
  const shownTitle = useScramble(title, true, 450);

  return (
    <section id="features" ref={sectionRef} className="intro-wall" aria-labelledby="intro-features-title" style={{ "--wall-steps": features.length } as CSSProperties}>
      <div className={`intro-wall-stage${hovered !== null ? " is-pointing" : ""}`} ref={stageRef}>
        <div className="intro-wall-copy">
          <p className="intro-eyebrow">{t("intro.features.eyebrow")}</p>
          <Heading id="intro-features-title" text={t("intro.features.title")} className="intro-wall-title" />
          <div className="intro-wall-detail" style={{ "--accent": feature.color } as CSSProperties} aria-live="polite">
            <span className="intro-wall-count" aria-hidden="true">{pad(active + 1)} <span>/ {pad(features.length)}</span></span>
            <span className="intro-feature-tags">{t(featureKey(feature.id, "tags"))}</span>
            <h3 className="intro-wall-feature">
              <span className="intro-visually-hidden">{title}</span>
              <span aria-hidden="true" translate="no">{shownTitle}</span>
            </h3>
            <p key={feature.id} className="intro-wall-body">{t(featureKey(feature.id, "body"))}</p>
            <a className="intro-button" href={feature.href}>{t("intro.features.open")} <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <ol className="intro-wall-index" aria-label={t("intro.features.index")}>
          {features.map((item, i) => (
            <li key={item.id} style={{ "--accent": item.color } as CSSProperties}>
              <button type="button" aria-current={i === active ? "true" : undefined} className={hovered === i ? "is-hovered" : undefined} onClick={() => jump(i)}>
                <span className="intro-wall-index-num">{pad(i + 1)}</span>
                <span className="intro-wall-index-label">{t(featureKey(item.id, "title"))}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="intro-wall-hint" aria-hidden="true">{t("intro.features.hint")}</p>
      </div>
    </section>
  );
}
