import { createContext, useContext } from "react";
import { useI18n, type MessageKey } from "../i18n";

export type Module = "journey" | "wallet" | "trust" | "agent";
export type ModuleNavState = { current: Module; preview: boolean; open(module: Module, preview: boolean): void };
export const ModuleNavContext = createContext<ModuleNavState | null>(null);

const modules: { id: Module; label: MessageKey; color: string; index: string }[] = [
  { id: "journey", label: "mod.journey", color: "#4ff2c6", index: "00" },
  { id: "wallet", label: "wallet.title", color: "#6fe3c8", index: "01" },
  { id: "trust", label: "nav.trust", color: "#f2b98a", index: "03" },
  { id: "agent", label: "nav.agent", color: "#c6a6f6", index: "05" },
];

/**
 * Module directory at the top of each service page's sidebar: every module with its colour,
 * the current one marked. Switching keeps the session's preview or signed-in mode. A group of
 * buttons rather than a <nav>, so pages keep a single navigation landmark.
 */
export function ModuleNav() {
  const { t } = useI18n();
  const nav = useContext(ModuleNavContext);
  if (!nav) return null;
  return (
    <div className="module-nav" role="group" aria-label={t("mod.label")}>
      <span className="module-nav-label">{t("mod.label")}</span>
      {modules.map((module) => (
        <button key={module.id} type="button" style={{ "--c": module.color } as React.CSSProperties}
          aria-current={module.id === nav.current ? "page" : undefined}
          onClick={() => { if (module.id !== nav.current) nav.open(module.id, nav.preview); }}>
          <i aria-hidden="true" />
          <span>{t(module.label)}</span>
          <small aria-hidden="true">{module.index}</small>
        </button>
      ))}
    </div>
  );
}
