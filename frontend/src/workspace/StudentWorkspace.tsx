import { useWorkspaceNavigation } from "./useWorkspaceNavigation";
import { useStripHeight, useSmallScreen, useWideScreen, useDockKeyboard } from "./useDockLayout";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { PlanApp } from "../plan/PlanApp";
import { ModuleNavContext, type Module } from "../services/ModuleNav";
import { useI18n, type MessageKey } from "../i18n";
import { ToolSlot, WorkspaceContext, type PlanState } from "./context";
import { AccountMenu } from "./AccountMenu";
import { DockHeader } from "./DockHeader";
import { ToolSidebar } from "./ToolSidebar";
import { signOut as endSession } from "./session";
import { studentTools, toolAvailable, type StudentTool, type ToolTarget } from "./navigation";
import "./workspace.css";
import "./panel-system.css";
import "./mobile.css";

// The finance sub-assistant and the comparison copilot are merged into the planner conversation, and spending
// insights into the monthly spending panel; navigation.ts sends their old links there.
const components: Partial<Record<StudentTool, ReturnType<typeof lazy>>> = {
  // Wallet, exchange, transfers and payments are one money tool; ?payments= links open its Pay tab.
  wallet: lazy(() => import("../wallet/MoneyHub").then(m => ({ default: m.MoneyHub }))),
  trust: lazy(() => import("../trust/TrustApp").then(m => ({ default: m.TrustApp }))),
  loans: lazy(() => import("../loans/LoansApp").then(m => ({ default: m.LoansApp }))),
  family: lazy(() => import("../family/FamilyApp").then(m => ({ default: m.FamilyApp }))),
};
const labels: Record<ToolTarget["kind"], MessageKey> = {
  life: "life.title",
  plan: "ws.plan", compare: "simple.compare", funding: "simple.plan", bills: "ws.record", spending: "plan.monthly.title",
  "family-links": "side.familyLinks", card: "ws.history", agent: "ws.finance", wallet: "money.title", payments: "money.title",
  trust: "side.trust", loans: "simple.loans", insights: "nav.insights", family: "side.family", copilot: "side.copilot",
};
const STAGE: Record<string, MessageKey> = { DRAFT: "side.stage.plan", CONFIRMED: "side.stage.prepare", ENROLLED: "side.stage.school" };
const COLLAPSED = "studyflow.sidebar.collapsed";

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED) === "1"; } catch { return false; }
}

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
  const { route, menu, setMenu, expanded, setExpanded, open, close, back, backTarget, registerBack } = control;
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [bellHost, setBellHost] = useState<HTMLDivElement | null>(null);
  const [guideHost, setGuideHost] = useState<HTMLElement | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [notice, setNotice] = useState("");
  async function signOut() { setSigningOut(true); await endSession(); }
  const dock = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const small = useSmallScreen();
  // Wide screens get a right rail beside the conversation for the stage summary; it gives way to an open tool.
  const wide = useWideScreen();
  const enrolled = plan ? plan.status === "ENROLLED" : null;
  // A money tool asked for before enrollment (an old link, another module's button) waits for the plan, then is refused.
  const blocked = !!route.tool && !toolAvailable(route.tool.kind, enrolled);
  const tool = blocked ? null : route.tool;
  useStripHeight(frame);
  useDockKeyboard(dock, { targetKey: JSON.stringify(tool), modal: small || expanded, menu }, close);
  useEffect(() => {
    if (!blocked || enrolled === null) return;
    close(); setNotice(t("side.lockedNotice"));
  }, [blocked, enrolled, close, t]);
  useEffect(() => { if (tool) setNotice(""); }, [tool]);
  useEffect(() => {
    if (route.tool?.kind === "payments" && enrolled) open({ kind: "wallet", section: "pay" });
  }, [route.tool?.kind, enrolled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (route.tool?.kind !== "agent") return;
    close(); setNotice(t("side.agentMerged"));
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".plan-composer textarea")?.focus());
  }, [route.tool?.kind, close, t]);
  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenu(false); } };
    const outside = (event: PointerEvent) => { if (!(event.target as Element).closest(".tool-sidebar, .workspace-menu-button")) setMenu(false); };
    document.addEventListener("keydown", closeMenu); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", closeMenu); document.removeEventListener("pointerdown", outside); };
  }, [menu, setMenu]);
  const toggleCollapsed = () => setCollapsed(value => {
    try { localStorage.setItem(COLLAPSED, value ? "0" : "1"); } catch { /* the choice still holds for this page */ }
    return !value;
  });
  const reportPlan = useCallback((state: PlanState) => setPlan(state), []);

  const nav = { current: "home" as Module, preview: route.preview,
    open: (kind: Module, asPreview: boolean) => {
      if (kind === "home") { close(); return; }
      if (studentTools.includes(kind as StudentTool) && asPreview === route.preview) open({ kind: kind as StudentTool });
      else onExternal(kind, asPreview);
    }, openAssistant: () => { close(); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".plan-composer textarea")?.focus()); },
  };
  const sidebar = (drawer: boolean) => <ToolSidebar active={tool} status={plan?.status ?? null} gap={!!plan?.gap} drawer={drawer}
    history={plan?.history ?? null} onOpenDraft={plan?.openDraft}
    compact={!drawer && (collapsed || !!tool)} preview={route.preview} stage={route.stage} account={username} signingOut={signingOut}
    onOpen={open} onClose={close} onToggle={drawer ? () => setMenu(false) : toggleCollapsed}
    onNewChat={() => { setMenu(false); close(); window.dispatchEvent(new Event("studyflow:new-conversation")); }}
    onStage={stage => { setMenu(false); control.setStage(stage); }} onSignOut={() => void signOut()} />;
  const backLabel = backTarget === "page" ? t("ws.backToList") : backTarget ? t("ws.backTo", { name: t(labels[backTarget.kind]) }) : undefined;
  return <ModuleNavContext.Provider value={nav}><WorkspaceContext.Provider value={{ target: tool, host, bellHost, guideHost, open: target => open(target), close,
    setStage: control.setStage, account: username, reportPlan, registerBack }}>
    <div ref={frame} className={`student-workspace${tool ? " has-tool" : ""}${expanded ? " tool-expanded" : ""}`}>
      {!small && sidebar(false)}
      {small && menu && <><div className="side-overlay" aria-hidden="true" />{sidebar(true)}</>}
      <div className="workspace-main" inert={!!tool && (small || expanded)}>
        <header className="workspace-topbar">
          {small && <button type="button" className="workspace-menu-button" aria-expanded={menu} aria-label={t("ws.tools")}
            onClick={() => setMenu(!menu)}><List size={22} aria-hidden="true" /></button>}
          {small && <span className="workspace-brand" aria-hidden="true">StudyFlow</span>}
          <h1 className="sr-only">{t("plan.title")}</h1>
          <span className="workspace-stage"><span aria-hidden="true" />{t(STAGE[plan?.status ?? "DRAFT"])}</span>
          {notice && <p className="workspace-notice" role="status">{notice}</p>}
          <div className="workspace-top-end">
            {username ? (route.preview ? <span className="workspace-account">{username}</span>
              : <AccountMenu account={username} signingOut={signingOut} onSignOut={() => void signOut()} />)
              : <a className="workspace-signin" href={`/auth?next=${encodeURIComponent(window.location.origin + "/")}`}>{t("ws.signIn")}</a>}
            <div className="workspace-bell" ref={setBellHost} />
          </div>
        </header>
        <main className={`workspace-conversation${wide ? " has-rail" : ""}`}>
          <PlanApp key={`${route.preview}:${route.stage}`} account={username} preview={route.preview} initialStage={route.stage} onExit={close} />
          {wide && <aside className="workspace-rail" ref={setGuideHost} hidden={!!tool} aria-label={t("guide.rail")} />}
        </main>
      </div>
      <section ref={dock} className="workspace-dock" hidden={!tool} role={small || expanded ? "dialog" : "region"}
        aria-modal={small || expanded ? true : undefined} aria-labelledby="workspace-tool-title">
        <DockHeader kind={tool?.kind ?? null} title={tool ? t(labels[tool.kind]) : ""} preview={route.preview}
          canBack={backTarget !== null} backLabel={backLabel} onBack={back} small={small} expanded={expanded} onExpand={() => setExpanded(!expanded)} onClose={close} />
        <div className="workspace-tool-host" ref={setHost} />
      </section>
      {studentTools.map(kind => { const Component = components[kind]; return Component && <ToolSlot key={kind} kind={kind}>
        <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
          <Component preview={route.preview} onExit={close} />
        </Suspense>
      </ToolSlot>; })}
    </div>
  </WorkspaceContext.Provider></ModuleNavContext.Provider>;
}
