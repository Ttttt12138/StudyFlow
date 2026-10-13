import { createContext, useContext } from "react";
import { useI18n, type MessageKey } from "../i18n";

/** Every page Root can show. "home" is the agent-first planner; sponsor and verify are public. */
export type Module = "home" | "wallet" | "payments" | "trust" | "loans" | "agent" | "insights" | "family" | "copilot" | "ops" | "sponsor" | "verify";
export type ModuleNavState = {
  current: Module;
  preview: boolean;
  open(module: Module, preview: boolean): void;
  /** Opens the AI assistant drawer over the current page; absent where there is no drawer. */
  openAssistant?(): void;
};
export const ModuleNavContext = createContext<ModuleNavState | null>(null);

/** Hook for in-page links to another module, keeping the current preview or signed-in mode. */
export function useModuleLink() {
  const nav = useContext(ModuleNavContext);
  return (module: Module) => nav?.open(module, nav.preview);
}

type Item = { id: Module; label: MessageKey; color: string };
// Students see their pages grouped along the timeline: plan before leaving, then manage money there.
// The AI assistant is a drawer on every page; operations is a separate role (RoleSwitch).
const home: Item = { id: "home", label: "plan.title", color: "#4ff2c6" };
const groups: { label: MessageKey; items: Item[] }[] = [
  { label: "nav.group.plan", items: [
    { id: "family", label: "nav.family", color: "#f2d29a" },
  ] },
  { label: "nav.group.money", items: [
    { id: "wallet", label: "wallet.title", color: "#6fe3c8" },
    { id: "payments", label: "nav.payments", color: "#9fd2f2" },
    { id: "loans", label: "nav.loans", color: "#f29ab4" },
  ] },
  { label: "nav.group.account", items: [
    { id: "trust", label: "nav.trust", color: "#f2b98a" },
  ] },
];

/**
 * Module directory in each student page's sidebar: the planner, then the grouped modules, the current
 * one marked. Switching keeps the session's preview or signed-in mode. A group of buttons rather than
 * a <nav>, so pages keep a single navigation landmark.
 */
export function ModuleNav() {
  const { t } = useI18n();
  const nav = useContext(ModuleNavContext);
  if (!nav) return null;
  const button = (item: Item) => (
    <button key={item.id} type="button" style={{ "--c": item.color } as React.CSSProperties}
      aria-current={item.id === nav.current ? "page" : undefined}
      onClick={() => { if (item.id !== nav.current) nav.open(item.id, nav.preview); }}>
      <i aria-hidden="true" />
      <span>{t(item.label)}</span>
    </button>
  );
  return (
    <div className="module-nav" role="group" aria-label={t("mod.label")}>
      {button(home)}
      {groups.map((group) => (
        <div key={group.label} className="module-nav-group" role="group" aria-label={t(group.label)}>
          <span className="module-nav-label" aria-hidden="true">{t(group.label)}</span>
          {group.items.map(button)}
        </div>
      ))}
    </div>
  );
}

/** Student / operations switch in the top strip; hidden on the public sponsor and verify pages. */
export function RoleSwitch() {
  const { t } = useI18n();
  const nav = useContext(ModuleNavContext);
  if (!nav || nav.current === "sponsor" || nav.current === "verify") return null;
  const ops = nav.current === "ops";
  return (
    <div className="role-switch" role="group" aria-label={t("role.label")}>
      <button type="button" aria-pressed={!ops} onClick={() => { if (ops) nav.open("home", nav.preview); }}>{t("role.student")}</button>
      <button type="button" aria-pressed={ops} onClick={() => { if (!ops) nav.open("ops", nav.preview); }}>{t("role.ops")}</button>
    </div>
  );
}
