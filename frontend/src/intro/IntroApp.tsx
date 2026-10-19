import "@fontsource-variable/space-grotesk";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "./intro.css";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { IntroNav } from "./IntroNav";
import { WorldCanvas, WorldContext, type WorldState } from "./WorldCanvas";
import { Loader } from "./Loader";
import { Features } from "./FeatureSection";
import { Safety, Start } from "./ClosingSections";
import { Heading } from "./ui";
import { LegalLinks } from "../legal/LegalApp";

const LOADED_KEY = "studyflow.introLoaded";

/**
 * Catches a runtime error anywhere in the intro so the page drops to its static version instead
 * of unmounting (which would leave the app's blank light background). The error is still logged.
 */
class IntroBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) {
    console.error("[intro] render error, switching to the static page", error);
    this.props.onError();
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function loadedThisSession(): boolean {
  try { return sessionStorage.getItem(LOADED_KEY) === "1"; } catch { return false; }
}

export function IntroApp() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(() => !loadedThisSession());
  const [world, setWorld] = useState<WorldState>({ world: null, failed: false });
  const [crashed, setCrashed] = useState(false);
  const shownWorld: WorldState = crashed ? { world: null, failed: true } : world;

  useEffect(() => {
    document.documentElement.classList.add("intro-page");
    return () => document.documentElement.classList.remove("intro-page");
  }, []);
  useEffect(() => { document.title = t("intro.title"); }, [t]);
  useEffect(() => { document.documentElement.classList.toggle("intro-locked", loading); }, [loading]);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      document.documentElement.style.setProperty("--intro-scroll", String(max > 0 ? window.scrollY / max : 0));
      // The opening copy clears out early in the dive so it never sits over the descending slabs.
      const heroOut = Math.min(1, window.scrollY / (window.innerHeight * 0.4));
      document.documentElement.style.setProperty("--hero-out", heroOut.toFixed(3));
      document.documentElement.classList.toggle("intro-hero-gone", heroOut >= 0.99);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const finishLoading = () => {
    try { sessionStorage.setItem(LOADED_KEY, "1"); } catch { /* the loader just shows again next time */ }
    setLoading(false);
  };


  return (
    <WorldContext.Provider value={shownWorld}>
    <div className="intro" id="top">
      {!crashed && <WorldCanvas active={!loading} onChange={setWorld} />}
      <div className="intro-atmosphere" aria-hidden="true"><span className="intro-glow intro-glow-a" /><span className="intro-glow intro-glow-b" /><span className="intro-grain" /></div>
      <div className="intro-scrollbar" aria-hidden="true"><span /></div>
      {loading && <Loader onDone={finishLoading} />}
      <IntroNav />
      <main aria-busy={loading}>
        <section className="intro-hero intro-hero-cinema" aria-labelledby="intro-hero-title">
          <a className="intro-scroll-down" href="#features">{t("intro.hero.scroll")}</a>
          <div className="intro-hero-caption">
            <p className="intro-eyebrow">{t("intro.hero.eyebrow")}</p>
            <Heading level="h1" id="intro-hero-title" ready={!loading} text={t("intro.hero.title")} className="intro-hero-title" />
            <p className="intro-lede">{t("intro.hero.lede")}</p>
          </div>
          <div className="intro-hero-cta">
            <a className="intro-pill" href="/?tour=1">{t("intro.hero.start")}</a>
            <a className="intro-pill intro-pill-ghost" href="#features">{t("intro.hero.explore")}</a>
          </div>
        </section>

        <IntroBoundary key={crashed ? "static" : "cinema"} onError={() => setCrashed(true)}>
          <Features />
          <Safety />
          <Start />
        </IntroBoundary>
      </main>
      <footer className="intro-footer">
        <span>{t("intro.footer")}</span>
        <span>{t("sim.text")}</span>
        <LegalLinks className="intro-legal" />
        <span className="intro-credit">{t("intro.credit")}</span>
      </footer>
    </div>
    </WorldContext.Provider>
  );
}
