import { useI18n } from "../i18n";
import { RoleSwitch } from "./ModuleNav";
import "./services.css";

/** Always-visible notice that every amount is simulated, plus the role and interface language switches. */
export function SimulatedStrip() {
  const { lang, setLang, t } = useI18n();
  return (
    <section className="sim-strip" aria-label={t("sim.label")}>
      <span className="sim-pill">{t("sim.pill")}</span>
      <span className="sim-text"><span className="sim-text-full">{t("sim.text")}</span><span className="sim-text-short">{t("sim.short")}</span></span>
      <a className="sim-intro" href="/intro">{t("sim.intro")} <span aria-hidden="true">↗</span></a>
      <RoleSwitch />
      <div className="lang-switch" role="group" aria-label={t("lang.label")}>
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en">English</button>
        <button type="button" aria-pressed={lang === "zh"} onClick={() => setLang("zh")} lang="zh-CN">中文</button>
      </div>
    </section>
  );
}
