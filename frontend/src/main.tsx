import { StudentWorkspace } from "./workspace/StudentWorkspace";
import { OperationsApp } from "./operations/OperationsApp";
import { SimulatedStrip } from "./services/SimulatedStrip";
import { AppBackdrop } from "./services/AppBackdrop";
import { AuthApp } from "./auth/AuthApp";
import { LegalApp, legalFromPath } from "./legal/LegalApp";
import { ModuleNavContext, type Module } from "./services/ModuleNav";
import { TourBar, tourStops, type TourTarget } from "./services/Tour";
import { previewStage, workspaceUrl } from "./workspace/navigation";
import "./student-start.css";
import "./sprint4.css";
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PreviewStage } from './plan/preview';
import './styles.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './theme.css';
import './services/ia.css';

type Service = Exclude<Module, "home">;
const services = ["wallet", "payments", "agent", "ops"] as const;
// Retired pages (loans, insights, trust, family, copilot, sponsor, verify): their old links open the workspace,
// which sends them where the job lives now (workspace/navigation.ts); =preview still opens the preview.
const retired = ["loans", "insights", "trust", "family", "copilot", "sponsor", "verify"];
// ?wallet=1, ?payments=1, … open a signed-in service; =preview opens its read-only synthetic preview.
// /ops is the operations console's own address, separate from the student pages.
function serviceFromUrl(): { kind: Service; preview: boolean } | null {
 if (/^\/ops\/?$/.test(window.location.pathname)) return { kind: "ops", preview: new URLSearchParams(window.location.search).get("ops") === "preview" };
 const query = new URLSearchParams(window.location.search);
 for (const kind of services) if (query.has(kind)) return { kind, preview: query.get(kind) === "preview" };
 return null;
}
// The home page is the agent-first planner (src/plan). ?plan=preview[&stage=prepare] opens its recorded
// preview; old ?journey=preview links land on the same preview.
function homeFromUrl(): { preview: boolean; stage: PreviewStage } {
 const query = new URLSearchParams(window.location.search);
 const preview = query.get("plan") === "preview" || query.get("journey") === "preview" || retired.some(kind => query.get(kind) === "preview");
 return { preview, stage: previewStage(query.get("stage")) };
}
const homeUrl = (preview: boolean, stage: PreviewStage) => preview ? workspaceUrl({ preview, stage, tool: null }) : "/";
// A tour stop's address: the planner preview (with its tool open) or a separate role page's preview.
const tourUrl = (target: TourTarget) => target.kind === "home"
 ? workspaceUrl({ preview: true, stage: target.stage, tool: target.tool ? { kind: target.tool } : null })
 : "/ops?ops=preview";
// ?tour=1 starts the guided demo at its first stop (or ?tour=N at stop N).
function tourFromUrl(): number | null {
 const value = new URLSearchParams(window.location.search).get("tour");
 if (value === null) return null;
 const index = Number(value) - 1;
 return Number.isInteger(index) && index >= 0 && index < tourStops.length ? index : 0;
}
function Root() {
 const [tour, setTour] = useState(tourFromUrl);
 const [initial] = useState(() => {
  const stop = tour === null ? null : tourStops[tour].target;
  const home = stop?.kind === "home" ? { preview: true, stage: stop.stage } : homeFromUrl();
  const service = stop && stop.kind !== "home" ? { kind: stop.kind, preview: true } : serviceFromUrl();
  if (stop) history.replaceState(null, "", tourUrl(stop));
  return { home, service };
 });
 const [home, setHome] = useState(initial.home);
 const [service, setService] = useState<{ kind: Service; preview: boolean } | null>(initial.service);
 useEffect(() => {
  const sync = () => { setService(serviceFromUrl()); setHome(homeFromUrl()); };
  window.addEventListener("popstate", sync);
  return () => window.removeEventListener("popstate", sync);
 }, []);

 const open = (kind: Service, preview: boolean) => {
  setService({ kind, preview });
  history.replaceState(null, "", kind === "ops" ? `/ops${preview ? "?ops=preview" : ""}` : `/?${kind}=${preview ? "preview" : "1"}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
 };
 const toHome = (preview: boolean, stage: PreviewStage = "plan") => {
  setHome({ preview, stage });
  setService(null);
  history.replaceState(null, "", homeUrl(preview, stage));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
 };
 const exit = () => toHome(service?.preview ?? home.preview);
 const go = (target: TourTarget) => {
  if (target.kind !== "home") return open(target.kind, true);
  setHome({ preview: true, stage: target.stage });
  setService(null);
  history.replaceState(null, "", tourUrl(target));
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
 };
 const goTour = (index: number) => { setTour(index); go(tourStops[index].target); };
 const preview = service ? service.preview : home.preview;
 const current: Module = service?.kind ?? "home";
 const moduleNav = {
  current, preview,
  open: (module: Module, asPreview: boolean) => {
    if (module === "home") toHome(asPreview); else open(module, asPreview);
  },
 };
 return <ModuleNavContext.Provider value={moduleNav}>{service?.kind !== "ops" && <AppBackdrop/>}<SimulatedStrip/>
  {service?.kind !== "ops" && <StudentWorkspace key={String(preview)} preview={preview} onExternal={(kind, mode) => kind === "home" ? toHome(mode) : open(kind, mode)} />}
  {service?.kind==="ops"&&<OperationsApp key={String(service.preview)} preview={service.preview} onExit={exit}/>}
  {tour !== null && <TourBar index={tour} onGo={goTour} onExtra={go} onExit={() => setTour(null)}/>}
 </ModuleNavContext.Provider>;
}
// /intro is the product introduction; it loads as its own chunk so the app bundle stays unchanged.
const IntroApp = lazy(() => import('./intro/IntroApp').then(module => ({ default: module.IntroApp })));
const isIntro = /^\/intro\/?$/.test(window.location.pathname);
// /auth is the sign-in page every "Sign in to StudyFlow" link opens.
const isAuth = /^\/auth\/?$/.test(window.location.pathname);
// /terms and /privacy are the Terms of Use and the Privacy Notice.
const legal = legalFromPath(window.location.pathname);
createRoot(document.getElementById('root')!).render(<React.StrictMode>{isIntro ? <Suspense fallback={null}><IntroApp/></Suspense>
  : isAuth ? <><AppBackdrop/><SimulatedStrip/><AuthApp/></>
  : legal ? <><AppBackdrop/><SimulatedStrip/><LegalApp kind={legal}/></> : <Root/>}</React.StrictMode>);
