import { useWorkspaceNavigation } from "./useWorkspaceNavigation";
import { useStripHeight, useSmallScreen, useDockKeyboard } from "./useDockLayout";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PlanApp } from "../plan/PlanApp";
import { ModuleNavContext, type Module } from "../services/ModuleNav";
import { useI18n, type MessageKey } from "../i18n";
import { ToolSlot, WorkspaceContext } from "./context";
import { studentTools, type StudentTool, type ToolTarget } from "./navigation";
import "./workspace.css";

const components = {
  wallet: lazy(() => import("../wallet/WalletApp").then(m => ({ default: m.WalletApp }))),
  payments: lazy(() => import("../payments/PaymentsApp").then(m => ({ default: m.PaymentsApp }))),
  agent: lazy(() => import("../agent/AgentApp").then(m => ({ default: m.AgentApp }))),
  trust: lazy(() => import("../trust/TrustApp").then(m => ({ default: m.TrustApp }))),
  loans: lazy(() => import("../loans/LoansApp").then(m => ({ default: m.LoansApp }))),
  insights: lazy(() => import("../insights/InsightsApp").then(m => ({ default: m.InsightsApp }))),
  family: lazy(() => import("../family/FamilyApp").then(m => ({ default: m.FamilyApp }))),
  copilot: lazy(() => import("../copilot/CopilotApp").then(m => ({ default: m.CopilotApp }))),
};
const labels: Record<ToolTarget["kind"], MessageKey> = {
  plan: "ws.plan", bills: "ws.bills", spending: "plan.monthly.title", "family-links": "ws.family", card: "ws.history", agent: "ws.finance",
  wallet: "wallet.title", payments: "nav.payments", trust: "nav.trust", loans: "nav.loans", insights: "nav.insights", family: "nav.family", copilot: "nav.copilot",
};
const groups: { label: MessageKey; tools: ToolTarget["kind"][] }[] = [
  { label: "ws.planTools", tools: ["plan", "spending", "bills", "copilot"] },
  { label: "ws.moneyTools", tools: ["wallet", "payments", "loans", "insights", "agent"] },
  { label: "ws.accountTools", tools: ["family-links", "family", "trust"] },
];

export function StudentWorkspace({ preview, onExternal }: { preview: boolean; onExternal: (kind: Module, preview: boolean) => void }) {
  const [identity, setIdentity] = useState<string | null>(preview ? "" : null);
  useEffect(() => {
    if (preview) return;
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/auth/session/", { credentials: "same-origin" });
        if (!r.ok) { if (alive) setIdentity(value => r.status === 401 ? "" : value ?? ""); return; }
        const account = await r.json();
        if (alive) setIdentity(account.authenticated ? account.username : "");
      } catch { if (alive) setIdentity(value => value ?? ""); }
    };
    const expired = () => { setIdentity(""); };
    void check();
    window.addEventListener("focus", check);
    window.addEventListener("studyflow:auth-lost", expired);
    return () => { alive = false; window.removeEventListener("focus", check); window.removeEventListener("studyflow:auth-lost", expired); };
  }, [preview]);
  if (identity === null) return <p role="status">StudyFlow…</p>;
  return <WorkspaceBody key={`${identity}:${preview}`} username={identity} preview={preview} onExternal={onExternal} />;
}

function WorkspaceBody({ username, preview, onExternal }: { username: string; preview: boolean; onExternal: (kind: Module, preview: boolean) => void }) {
  const { t } = useI18n();
  const control = useWorkspaceNavigation(preview);
  const { route, stack, menu, setMenu, expanded, setExpanded, open, close, back } = control;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const dock = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const small = useSmallScreen();
  useStripHeight(frame);
  useDockKeyboard(dock, { targetKey: JSON.stringify(route.tool), modal: small || expanded, menu }, close);
  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenu(false); } };
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest(".workspace-topbar")) setMenu(false); };
    document.addEventListener("keydown", closeMenu); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", closeMenu); document.removeEventListener("pointerdown", outside); };
  }, [menu, setMenu]);

  const nav = { current: "home" as Module, preview: route.preview,
    open: (kind: Module, asPreview: boolean) => {
      if (kind === "home") { close(); return; }
      if (studentTools.includes(kind as StudentTool) && asPreview === route.preview) open({ kind: kind as StudentTool });
      else onExternal(kind, asPreview);
    }, openAssistant: () => open({ kind: "agent" }),
  };
  return <ModuleNavContext.Provider value={nav}><WorkspaceContext.Provider value={{ target: route.tool, host, open, close,
    setStage: control.setStage }}>
    <div ref={frame} className={`student-workspace${route.tool ? " has-tool" : ""}${expanded ? " tool-expanded" : ""}`}>
      <header className="workspace-topbar">
        <a className="workspace-brand" href="/" onClick={event => { event.preventDefault(); close(); }}>StudyFlow<span>.</span></a>
        <h1>{t("plan.title")}</h1>
        <span className="workspace-account">{username || t("ws.signedOut")}</span>
        <button className="secondary" aria-expanded={menu} aria-controls="workspace-tools" onClick={() => setMenu(!menu)}>{t("ws.tools")}</button>
        {menu && <nav id="workspace-tools" className="workspace-tools" aria-label={t("ws.tools")}>
          {groups.map(group => <div key={group.label}><strong>{t(group.label)}</strong>{group.tools.map(kind =>
            <button key={kind} onClick={() => open({ kind })}>{t(labels[kind])}</button>)}</div>)}
        </nav>}
      </header>
      <div className="workspace-body">
        <main className="workspace-conversation" inert={!!route.tool && (small || expanded)}>
          <PlanApp key={`${route.preview}:${route.stage}`} account={username} preview={route.preview} initialStage={route.stage} onExit={close} />
        </main>
        <section ref={dock} className="workspace-dock" hidden={!route.tool} role={small || expanded ? "dialog" : "region"}
          aria-modal={small || expanded ? true : undefined} aria-labelledby="workspace-tool-title">
          <div className="workspace-dock-header">
            {stack.length > 1 && <button className="secondary" onClick={back} aria-label={t("ws.back")}>←</button>}
            <h2 id="workspace-tool-title">{route.tool ? t(labels[route.tool.kind]) : ""}</h2>
            {!small && <button className="secondary" onClick={() => setExpanded(!expanded)} aria-label={t(expanded ? "ws.restore" : "ws.expand")}>{expanded ? "↙" : "↗"}</button>}
            <button className="secondary" onClick={close} aria-label={t("ws.close")}>×</button>
          </div>
          {route.preview && <p className="workspace-preview">{t("agent.preview.title")}</p>}
          <div className="workspace-tool-host" ref={setHost} />
        </section>
      </div>
      {studentTools.map(kind => { const Component = components[kind]; return <ToolSlot key={kind} kind={kind}>
        <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
          {kind === "agent" && <p className="service-muted finance-hint">{t("ws.financeHint")}</p>}
          <Component preview={route.preview} onExit={close} />
        </Suspense>
      </ToolSlot>; })}
    </div>
  </WorkspaceContext.Provider></ModuleNavContext.Provider>;
}
