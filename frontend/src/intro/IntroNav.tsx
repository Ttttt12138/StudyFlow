import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

const sections = [
  { href: "#features", key: "intro.nav.features" },
  { href: "#safety", key: "intro.nav.safety" },
  { href: "#start", key: "intro.nav.start" },
] as const;

/** Wordmark top left; a glass panel top right with section links, language and the app entry. */
export function IntroNav() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const languages = (
    <div className="intro-lang" role="group" aria-label={t("lang.label")}>
      <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">EN</button>
      <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")} lang="zh-CN">中文</button>
    </div>
  );

  return (
    <header className="intro-header">
      <a className="intro-wordmark" href="#top" aria-label={t("intro.nav.home")}>
        <span className="intro-mark" aria-hidden="true">S/</span>
        <span>StudyFlow</span>
      </a>
      <nav className={`intro-panel${open ? " is-open" : ""}`} aria-label={t("intro.nav.label")}>
        <span className="intro-sim-pill">{t("sim.pill")}</span>
        <ul className="intro-links">
          {sections.map((item) => (
            <li key={item.href}><a href={item.href} onClick={() => setOpen(false)}>{t(item.key)}</a></li>
          ))}
        </ul>
        {languages}
        <a className="intro-button intro-button-small" href="/">{t("intro.nav.openApp")}</a>
      </nav>
      <button type="button" className="intro-menu-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t("intro.nav.close") : t("intro.nav.menu")}
      </button>
    </header>
  );
}
