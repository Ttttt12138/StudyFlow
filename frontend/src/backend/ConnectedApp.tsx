import { PreviewWalkthrough } from "./PreviewWalkthrough";
import { PreviewConfirmation } from "./PreviewConfirmation";
import { PreviewApplication } from "./PreviewApplication";
import { LiveDashboard } from "../dashboard/LiveDashboard";
import { DashboardPreview } from "../dashboard/DashboardPreview";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, DjangoClient, getAll, type StudyFlowClient } from "./client";
import { PaymentCalendar } from "./PaymentCalendar";
import { FundingComparison } from "./FundingComparison";
import { explainCode, formatDate, formatMoney } from "./presenters";
import { createPreviewClient, previewBudget, previewFunding, previewImport, type PreviewScenario } from "./previewAdapter";
import type {
  Application,
  BackendState,
  BudgetResult,
  Cost,
  Draft,
  FundingResult,
  FundingSource,
  ForecastResult,
  ImportRecord,
  LoanQuote,
  Run,
  Semester,
  Template,
  Versions,
} from "./contracts";
import "../styles.css";

const steps = [
  "Confirm information",
  "Complete expenses",
  "Budget",
  "Funding",
  "Simulated application",
];
const stepHelp = [
  "Check your admission details and the documents behind them.",
  "Review school costs and add expenses you expect to pay.",
  "Compare the budget results for your saved information.",
  "Review possible funding and what is actually available.",
  "Review a quote and follow your simulated application.",
];
const previewStepHelp = [
  "See sample admission details, source evidence, and a conflict that still needs review.",
  "See documented and sample expenses, then try one fixed Food estimate.",
  "Explore budget and calendar results supplied by fixed demo responses.",
  "Compare sample funding sources, conditions, and simulated loan quotes.",
  "Inspect a sample application status and its linked quote terms.",
];
const categories = [
  "tuition",
  "housing",
  "deposit",
  "food",
  "transport",
  "communications",
  "subscription",
  "utilities",
  "insurance",
  "visa",
  "travel",
  "settlement",
];
const money = (value: string | null | undefined, currency = "THB") => formatMoney(value, currency);
function issueText(error: unknown) {
  if (error instanceof ApiError)
    return `${error.status ? `HTTP ${error.status}: ` : ""}${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
function versionsMatch(
  result: { state_version: number; budget_version: number; analysis_version?: number; semester?: string; semester_id?: string } | null,
  state: BackendState | null,
) {
  return (
    !!result &&
    !!state &&
    (!result.semester || result.semester === state.semester_id) &&
    (!result.semester_id || result.semester_id === state.semester_id) &&
    result.state_version === state.state_version &&
    result.budget_version === state.budget_version &&
    (state.analysis_version == null || result.analysis_version === state.analysis_version)
  );
}
export function ConnectedApp({ onDemo, onWallet }: { onDemo: () => void; onWallet: (preview: boolean) => void }) {
  const [session, setSession] = useState<{authenticated: boolean; username: string | null; csrf_token: string} | null>(null);
  const [client, setClient] = useState<StudyFlowClient | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewScenario,setPreviewScenario]=useState<PreviewScenario>("missing");
  const [showConnect,setShowConnect]=useState(false);
  const [expandedCosts,setExpandedCosts]=useState<Record<string,boolean>>({});
  const focusCostRef=useRef<string|null>(null);
  const connectInputRef=useRef<HTMLAnchorElement|null>(null);
  const focusApplicationStatusRef=useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(0);
  const [dashboard, setDashboard] = useState(false);
  const [dashboardPreview, setDashboardPreview] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [asOf, setAsOf] = useState("");
  const [reserve, setReserve] = useState("");
  const [state, setState] = useState<BackendState | null>(null);
  const [semester, setSemester] = useState<Semester | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ocrNotice, setOcrNotice] = useState<{
    version: string;
    text_en: string;
    enabled: boolean;
    configured: boolean;
    policy_configured: boolean;
  } | null>(null);
  const [ocrConsent, setOcrConsent] = useState(false);
  const [ocrLanguage, setOcrLanguage] = useState("zh-en");
  const [transcription, setTranscription] = useState("");
  const [upload, setUpload] = useState<File | null>(null);
  const [material, setMaterial] = useState<ImportRecord | null>(null);
  const [issuer, setIssuer] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [savedFunding, setSavedFunding] = useState<Run<
    Record<string, unknown>
  > | null>(null);
  const [budget, setBudget] = useState<Run<BudgetResult> | null>(null);
  const [forecast, setForecast] = useState<Run<ForecastResult> | null>(null);
  const [funding, setFunding] = useState<Run<FundingResult> | null>(null);
  const [sources, setSources] = useState<FundingSource[]>([]);
  const sourceIdentity = useRef({fingerprint: "", key: ""});
  const [sourceKind, setSourceKind] = useState("family");
  const [sourceAmount, setSourceAmount] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [quotes, setQuotes] = useState<LoanQuote[]>([]);
  const [quoteId, setQuoteId] = useState("");
  const [applications, setApplications] = useState<Application[]>([]);
  const [application, setApplication] = useState<Application | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const [profileMonths, setProfileMonths] = useState<
    Array<{
      month: string;
      income: string | null;
      living_expenses: string | null;
      existing_repayments: string | null;
    }>
  >([]);
  const [unsavedDraft, setUnsavedDraft] = useState<Draft | null>(null);
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("");
  const [fees, setFees] = useState("0.00");
  const [months, setMonths] = useState("12");
  const [firstDue, setFirstDue] = useState("");
  const connectionEpoch = useRef(0);
  const initialized = useRef(false);
  const fileIdentities = useRef(new WeakMap<File, string>());
  const keys = useRef(new Map<string, string>());
  useLayoutEffect(() => {
    if (!client || dashboardPreview || dashboard) return;
    const costId = focusCostRef.current;
    focusCostRef.current = null;
    const target = costId ? document.getElementById(`cost-${costId}`) : null;
    if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    (target ?? document.getElementById("connected-step-title"))?.focus({ preventScroll: true });
  }, [step, client, dashboardPreview, dashboard]);
  useLayoutEffect(() => {
    if (!focusApplicationStatusRef.current || step !== 4 || !application) return;
    const status = document.querySelector<HTMLElement>(".application-live-status");
    if (!status) return;
    focusApplicationStatusRef.current = false;
    status.scrollIntoView({ block: "center", behavior: "instant" });
    status.focus({ preventScroll: true });
  }, [application, step]);
  useLayoutEffect(() => {
    if (client || !showConnect || !connectInputRef.current) return;
    connectInputRef.current.scrollIntoView({ block: "center", behavior: "instant" });
    connectInputRef.current.focus({ preventScroll: true });
  }, [client, showConnect]);
  const versions = (): Versions => ({
    semester_id: state!.semester_id,
    state_version: state!.state_version,
    budget_version: state!.budget_version,
    analysis_version: state!.analysis_version,
  });
  useEffect(() => {
    setApplication(preview ? applications[0] ?? null : applications.find((item) => (item.loan ?? item.quote_id) === quoteId) ?? null);
  }, [applications, quoteId, preview]);
  const dirty = !!draft && !!semester && JSON.stringify(draft) !== JSON.stringify(semester.draft);
  function resultFresh(result: Parameters<typeof versionsMatch>[0], current: BackendState | null) {
    return !dirty && versionsMatch(result, current);
  }
  async function send<T>(
    api: StudyFlowClient,
    path: string,
    body: unknown,
    identity = path,
  ): Promise<T> {
    const fileKey = (file: File) => {
      let id = fileIdentities.current.get(file);
      if (!id) { id = crypto.randomUUID(); fileIdentities.current.set(file, id); }
      return [id, file.name, file.size, file.lastModified];
    };
    const payloadKey = `${identity}:${body instanceof FormData ? JSON.stringify([...body.entries()].map(([name, value]) => [name, value instanceof File ? fileKey(value) : value])) : JSON.stringify(body)}`;
    const key = keys.current.get(payloadKey) ?? crypto.randomUUID();
    keys.current.set(payloadKey, key);
    try {
      const result = await api.post<T>(path, body, key);
      return result;
    } catch (e) {
      setErrorDetails(e instanceof ApiError ? e.details : null);
      if (e instanceof ApiError && e.status === 409)
        keys.current.delete(payloadKey);
      throw e;
    }
  }
  async function refresh(api = client, stillCurrent = () => true) {
    if (!api) return;
    const next = await api.get<BackendState>("readiness/state/");
    const term = await api.get<Semester>(
      `readiness/semesters/${next.semester_id}/`,
    );
    const [fundingSources, loanQuotes, applications, profile, forecasts, recommendations, fundingPlans, budgets] =
      await Promise.all([
        getAll<FundingSource>(api, "funding-sources/"),
        getAll<LoanQuote>(api, "loans/"),
        getAll<Application>(api, "applications/"),
        api
          .get<{
            version: number;
            months: Array<{
              month: string;
              income: string | null;
              living_expenses: string | null;
              existing_repayments: string | null;
            }>;
          }>("affordability-profile/")
,
        api.get<Run<ForecastResult>[]>("readiness/forecasts/"),
        api.get<Run<FundingResult>[]>("readiness/funding-plans/recommend/"),
        api.get<Run<Record<string, unknown>>[]>("readiness/funding-plans/"),
        api.get<Run<BudgetResult>[]>("readiness/budgets/"),
      ]);
    if (!stillCurrent()) return;
    setState(next);
    setSemester(term);
    setDraft(structuredClone(term.draft));
    setSources(fundingSources);
    setQuotes(loanQuotes);
    setApplications(applications);
    if (!quoteId && applications[0]) setQuoteId(applications[0].loan ?? applications[0].quote_id ?? "");
    setProfileVersion(profile.version);
    setProfileMonths(profile.months);
    setForecast(forecasts[0] ?? null);
    setFunding(recommendations[0] ?? null);
    setSavedFunding(fundingPlans[0] ?? null);
    setBudget(budgets[0] ?? null);
    return next;
  }
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setErrorDetails(null);
    setNotice("");
    try {
      await action();
    } catch (e) {
      setErrorDetails(e instanceof ApiError ? e.details : null);
      if (e instanceof ApiError && e.status === 409 && client) {
        const edits = draft ? structuredClone(draft) : null;
        try { await refresh(client); } catch (reloadError) {
          setUnsavedDraft(edits);
          setError(`Your information changed, but the latest data could not be loaded. Retry refreshing before saving. ${issueText(reloadError)}`);
          return;
        }
        setUnsavedDraft(edits);
        setError(
          "A newer state was saved. Review the latest data, then restore your unsaved edits if appropriate.",
        );
      } else setError(issueText(e));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    const epoch = ++connectionEpoch.current;
    await act(async () => {
      const response = await fetch("/api/auth/session/", { credentials: "same-origin" });
      if (!response.ok) throw new ApiError(response.status, "Could not check your sign-in session.");
      const identity = await response.json().catch(() => { throw new Error("The sign-in service returned an unexpected response. Please retry or contact support."); });
      if (epoch !== connectionEpoch.current) return;
      setSession(identity);
      if (!identity.authenticated) return;
      const api = new DjangoClient(identity.csrf_token);
      const list = await api.get<Template[]>("readiness/templates/");
      setOcrNotice(
        await api
          .get<{
            version: string;
            text_en: string;
            enabled: boolean;
            configured: boolean;
            policy_configured: boolean;
          }>("readiness/imports/ocr-notice/")
          .catch(() => null),
      );
      if (epoch !== connectionEpoch.current) return;
      setTemplates(list);
      setSelectedTemplate(list[0]?.key ?? "");
      setClient(api);
      try {
        const restored = await refresh(api, () => epoch === connectionEpoch.current);
        if (epoch !== connectionEpoch.current) return;
        const imports = await api
          .get<ImportRecord[]>("readiness/imports/");
        const pending = imports.find((item) =>
          (!item.semester || item.semester === restored?.semester_id) && ["QUEUED", "NEEDS_REVIEW", "NEEDS_MANUAL_INPUT"].includes(
            item.status,
          ),
        );
        if (pending) {
          const currentImport = await api.get<ImportRecord>(
            `readiness/imports/${pending.id}/`,
          );
          setMaterial(currentImport);
          if (
            currentImport.status === "NEEDS_REVIEW" &&
            currentImport.result.proposed_draft
          ) {
            setDraft(structuredClone(currentImport.result.proposed_draft));
            setSelectedIds(
              currentImport.result.proposed_draft.costs
                .filter((cost) => cost.source_refs?.includes(currentImport.id) || cost.conflict)
                .map((cost) => cost.cost_id),
            );
          }
        }
        setNotice("Existing semester loaded.");
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && JSON.stringify(e.details).includes("NO_ACTIVE_SEMESTER")) {
          setNotice("No active semester. Create one below.");
        } else throw e;
      }
    });
  }
  useEffect(() => { if (!initialized.current) { initialized.current = true; void connect(); } }, []);
  async function startPreview() {
    ++connectionEpoch.current;
    const api = createPreviewClient("missing");
    setPreviewScenario("missing");
    setError("");
    setDashboard(false);
    setPreview(true);
    setClient(api);
    await refresh(api);
    setMaterial(structuredClone(previewImport));
    setSelectedIds(previewImport.result.proposed_draft?.costs
      .filter((cost) => cost.source_refs?.includes(previewImport.id))
      .map((cost) => cost.cost_id) ?? []);
    setBudget(structuredClone(previewBudget));
    setFunding(structuredClone(previewFunding));
    setQuoteId("preview-quote");
    setNotice("Synthetic preview loaded. No Django account or live financial data is connected.");
  }
  async function showPreviewScenario(scenario: PreviewScenario) {
    if (!preview) return;
    const api = createPreviewClient(scenario);
    setBusy(true);
    setError("");
    try {
      await refresh(api);
      focusCostRef.current = "preview-food";
      setClient(api);
      setPreviewScenario(scenario);
    } catch (reason) {
      setError(issueText(reason));
    } finally {
      setBusy(false);
    }
  }
  function leavePreview() {
    ++connectionEpoch.current;
    setPreview(false);
    setShowConnect(true);
    setClient(null);
    setState(null);
    setSemester(null);
    setDraft(null);
    setBudget(null);
    setForecast(null);
    setFunding(null);
    setMaterial(null);
    setApplication(null);
    setApplications([]);
    setStep(0);
    setSources([]);
    setQuotes([]);
    setProfileMonths([]);
    setSavedFunding(null);
    setQuoteId("");
    setUnsavedDraft(null);
    keys.current.clear();
    setError("");
    setNotice("");
  }
  async function createSemester() {
    if (!client) return;
    await act(async () => {
      const template = templates.find((x) => x.key === selectedTemplate);
      const body = {
        template_key: selectedTemplate,
        template_version: template?.version,
        room: selectedTemplate.endsWith("single") ? "single" : "shared",
        opening_balance: openingBalance,
        as_of: asOf,
        reserve: reserve || null,
      };
      await send(client, "readiness/semesters/", body);
      await refresh();
      setUnsavedDraft(null);
      setNotice("Semester created. Review its template and missing costs.");
    });
  }
  async function uploadMaterial() {
    if (!client || !state || !upload) return;
    await act(async () => {
      const form = new FormData();
      for (const [key, value] of Object.entries(versions()))
        if (value !== undefined) form.append(key, String(value));
      form.append(
        "kind",
        upload.type.startsWith("image/")
          ? "image"
          : upload.type === "application/pdf"
            ? "pdf"
            : "text",
      );
      form.append("language", ocrLanguage);
      if (ocrConsent && ocrNotice) {
        form.append("ocr_consent", "true");
        form.append("ocr_notice_version", ocrNotice.version);
      }
      form.append("file", upload);
      const response = await send<ImportRecord>(
        client,
        "readiness/imports/",
        form,
      );
      setMaterial(response);
      setOcrConsent(false);
      setNotice(
        "Upload queued. Refresh its status after the worker processes it.",
      );
    });
  }
  async function refreshImport() {
    if (!client || !material) return;
    await act(async () => {
      const next = await client.get<ImportRecord>(
        `readiness/imports/${material.id}/`,
      );
      setMaterial(next);
      if (next.status === "NEEDS_REVIEW" && next.result.proposed_draft) {
        setDraft(structuredClone(next.result.proposed_draft));
        setSelectedIds(
          next.result.proposed_draft.costs
            .filter((c) => c.source_refs?.includes(next.id) || c.conflict)
            .map((c) => c.cost_id),
        );
      }
    });
  }
  async function transcribeMaterial() {
    if (!client || !material || !transcription.trim()) return;
    await act(async () => {
      const next = await send<ImportRecord>(
        client,
        `readiness/imports/${material.id}/transcribe/`,
        { ...versions(), text: transcription },
      );
      setMaterial(next);
      setNotice("Manual transcription queued for extraction.");
    });
  }
  async function confirmImport() {
    if (!client || !material || !draft || !state) return;
    if (!issuer.trim() || selectedIds.length === 0) {
      setError("Enter the issuer and select at least one extracted cost.");
      return;
    }
    await act(async () => {
      await send(client, `readiness/imports/${material.id}/confirm/`, {
        ...versions(),
        draft,
        issuer,
        selected_cost_ids: selectedIds,
        conflict_resolutions: resolutions,
      });
      await refresh();
      setMaterial(null);
      setNotice("Your document review was saved.");
    });
  }
  async function saveDraft() {
    if (!client || !draft || !state) return;
    await act(async () => {
      await send(client, "readiness/semesters/revise/", {
        ...versions(),
        draft,
      });
      await refresh();
      setUnsavedDraft(null);
      setNotice("Your expense changes were saved.");
    });
  }
  async function calculateBudget() {
    if (!client || !state) return;
    await act(async () => {
      const result = await send<Run<BudgetResult>>(
        client,
        "readiness/budgets/",
        versions(),
      );
      setBudget(result);
      setNotice("Your budget results are ready.");
    });
  }
  async function updateCalendar() {
    if (!client || !state) return;
    await act(async () => {
      const result = await send<Run<ForecastResult>>(
        client,
        "readiness/forecasts/",
        { ...versions(), horizon: 90, conditional: false },
      );
      setForecast(result);
      setNotice("Your payment calendar is ready.");
    });
  }
  async function recommend() {
    if (!client || !state) return;
    await act(async () => {
      const result = await send<Run<FundingResult>>(
        client,
        "readiness/funding-plans/recommend/",
        { ...versions(), allocations: [], actions: [] },
      );
      setFunding(result);
      setNotice("Your funding options are ready.");
    });
  }
  async function saveFundingPlan() {
    if (!client || !state || !funding || !resultFresh(funding, state)) return;
    await act(async () => {
      const result = await send<Run<Record<string, unknown>>>(
        client,
        "readiness/funding-plans/",
        {
          ...versions(),
          allocations: funding.result.nonloan_plan.allocations,
          actions: [],
        },
      );
      setSavedFunding(result);
      setNotice("Your funding choices were reviewed.");
    });
  }
  async function addSource() {
    if (!client) return;
    const fingerprint = JSON.stringify([sourceKind, sourceAmount, sourceDate]);
    if (sourceIdentity.current.fingerprint !== fingerprint) sourceIdentity.current = {fingerprint, key: crypto.randomUUID()};
    await act(async () => {
      await send(client, "funding-sources/", {
        economic_key: sourceIdentity.current.key,
        kind: sourceKind,
        amount: sourceAmount,
        currency: "THB",
        available_on: sourceDate,
        certainty: "estimated",
        already_in_opening: false,
      });
      await refresh();
      sourceIdentity.current = {fingerprint: "", key: ""};
      setNotice("Funding source recorded; it is not received money.");
    });
  }
  async function addQuote() {
    if (!client) return;
    await act(async () => {
      const quote = await send<LoanQuote>(client, "loans/", {
        currency: "THB",
        principal,
        annual_rate: rate,
        fees,
        months: Number(months),
        first_due_date: firstDue,
      });
      setQuoteId(quote.id);
      await refresh();
      setNotice("Your loan quote is ready. Review the repayment schedule before applying.");
    });
  }
  async function createApplication() {
    if (!client || !quoteId) return;
    await act(async () => {
      const result = await send<Application>(client, "applications/", {
        quote_id: quoteId,
      });
      focusApplicationStatusRef.current = true;
      setApplication(result);
      await refresh();
      setNotice("Simulated application draft created.");
    });
  }
  async function submitApplication() {
    if (!client || !application) return;
    await act(async () => {
      const result = await send<Application>(
        client,
        `applications/${application.id}/action/`,
        { expected_version: application.version, action: "submit" },
      );
      focusApplicationStatusRef.current = true;
      setApplication(result);
      await refresh();
      setNotice("Your application status was updated.");
    });
  }
  async function saveProfile() {
    if (!client) return;
    await act(async () => {
      const result = await send<{
        version: number;
        months: typeof profileMonths;
      }>(client, "affordability-profile/", {
        expected_version: profileVersion,
        months: profileMonths,
      });
      setProfileVersion(result.version);
      await refresh();
      setNotice(
        "Your monthly profile was saved for application review.",
      );
    });
  }
  async function reloadApplication() {
    if (!client || !application) return;
    await act(async () =>
      setApplication(
        await client.get<Application>(`applications/${application.id}/`),
      ),
    );
  }
  function editProfile(field: string, value: string) {
    if (!draft) return;
    setDraft({
      ...draft,
      profile: { ...draft.profile, [field]: value || null },
    });
  }
  function editCost(id: string, patch: Partial<Cost>) {
    if (!draft) return;
    setDraft({
      ...draft,
      costs: draft.costs.map((c) =>
        c.cost_id === id
          ? {
              ...c,
              ...patch,
              confidence_type: "UNCONFIRMED",
              verification_reference: null,
            }
          : c,
      ),
    });
  }
  function addCost() {
    if (!draft) return;
    setDraft({
      ...draft,
      costs: [
        ...draft.costs,
        {
          cost_id: `student_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
          category: "food",
          component: "Student entry",
          amount: null,
          currency: "THB",
          period: "monthly",
          paid: false,
          confidence_type: "UNCONFIRMED",
          evidence: [],
          source_refs: [],
        },
      ],
    });
  }
  const conflicts = material?.result.merge_conflicts ?? {};
  const formDraft = draft ?? semester?.draft;
  const missingCostCount = formDraft?.costs.filter((cost) => cost.amount == null && cost.applicability !== "NOT_APPLICABLE").length ?? 0;
  const budgetData = budget?.result ?? state?.budget ?? null;
  const nextScheduledCost = resultFresh(forecast, state) ? forecast?.result.timeline.find((event) => event.kind === "expense") : null;
  const nextAction = !state
    ? "Connect to a saved semester or open the synthetic preview."
    : step === 0
      ? material?.status === "NEEDS_REVIEW" ? "Review the document evidence and confirm your choices." : "Check admission details and upload a document when available."
      : step === 1
        ? preview ? previewScenario === "missing" ? "Find Food and try the clearly labeled sample estimate." : "Sample Food is estimated. Open Budget to see the matching mock result." : formDraft?.costs.some((cost) => cost.applicability !== "NOT_APPLICABLE" && cost.amount == null)
          ? "Review costs with missing amounts, then save your expense revisions."
          : "Review the expense dates and save your revisions."
        : step === 2
          ? preview ? previewScenario === "missing" ? "Find Food and try the sample estimate to see a new demo result." : "Food is estimated in this demo. Review the updated sample result and calendar." : budget && !resultFresh(budget, state) ? "Update the budget after your latest changes." : "Review B’s issues and the payment calendar."
          : step === 3
            ? !funding || !resultFresh(funding, state) ? "Request an updated funding recommendation." : "Review conditions and compare the loan quotes."
            : application ? explainCode(application.status) : "Select a quote, then create a simulated application draft.";
  const paymentCalendar = <PaymentCalendar
    forecast={forecast}
    current={resultFresh(forecast, state)}
    costs={formDraft?.costs ?? []}
    sources={sources}
    busy={busy || preview || dirty}
    preview={preview}
    onUpdate={updateCalendar}
  />;
  if (dashboardPreview) return <DashboardPreview onExit={() => setDashboardPreview(false)} onJourney={(target) => {
    setDashboardPreview(false);
    if (!preview) void startPreview().then(() => setStep(target));
    else setStep(target);
  }} />;
  return (
    <div className={`app connected ${preview ? "preview-mode" : ""}`}>
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setStep(0);
          }}
        >
          <span className="brand-icon">S</span>StudyFlow
          <span className="brand-dot">.</span>
        </a>
        {client && <div className="journey-label">YOUR STUDY PLAN</div>}
        {client && <>
        <button className="mobile-step-toggle secondary" aria-expanded={showSteps} aria-controls="connected-steps" onClick={() => setShowSteps(!showSteps)}>
          {dashboard ? "Dashboard" : `Step ${step + 1} of 5 · ${steps[step]}`} <span aria-hidden="true">{showSteps ? "−" : "+"}</span>
        </button>
        <nav id="connected-steps" className={showSteps ? "steps-open" : ""} aria-label="Study planning steps">
          {!preview && <button className={dashboard ? "active" : ""} aria-current={dashboard ? "page" : undefined} onClick={()=>{setDashboard(true);setShowSteps(false);}}>Dashboard</button>}
          {steps.map((name, i) => (
            <button
              key={name}
              className={!dashboard && step === i ? "active" : ""}
              aria-current={!dashboard && step === i ? "step" : undefined}
              disabled={!state && i > 0}
              onClick={() => { setDashboard(false); setStep(i); setShowSteps(false); }}
            >
              <span className="step-number">0{i + 1}</span>
              {name}
            </button>
          ))}
        </nav>
        </>}
        {!client && <div className="sidebar-note"><strong>Take it one step at a time</strong><p>Start with your admission details. We'll help you see what comes next.</p></div>}
        {client && <details className="student-more-menu"><summary>More options</summary><div>
        {client && <button className="secondary student-side-action" onClick={onDemo}>
          View synthetic demo
        </button>}
        {preview && <button className="secondary dashboard-entry student-side-action" onClick={() => setDashboardPreview(true)}>Preview dashboard</button>}
        {client && <button className="secondary dashboard-entry student-side-action" onClick={() => onWallet(preview)}>{preview ? "Preview wallet & transfers" : "Wallet & transfers"}</button>}
        {preview && <button className="secondary student-side-action" onClick={leavePreview}>Connect to Django instead</button>}
        </div></details>}
      </aside>
      <div className="workspace">
        <header>
          <span>StudyFlow / {dashboard ? "Dashboard" : client ? steps[step] : "Welcome"}</span>
          <span className="avatar">ST</span>
        </header>
        <main>
          {dashboard && client && !preview ? <LiveDashboard api={client as DjangoClient} dirty={dirty} onJourney={(index)=>{setDashboard(false);setStep(index);}}/> : <>
          {client && <div className="section-heading">
            <div>
              <span className="eyebrow">STEP 0{step + 1} / 05</span>
              <h1 id="connected-step-title" tabIndex={-1}>{steps[step]}</h1>
              <p>{preview ? previewStepHelp[step] : stepHelp[step]}</p>
            </div>
          </div>}
          {client && <div className="student-progress" aria-label={`Step ${step + 1} of 5: ${steps[step]}`}><div><span>{preview ? "TOUR POSITION · NOTHING COMPLETED" : "CURRENT STEP"}</span><strong>Step {step + 1} of 5 · {steps[step]}</strong></div><div className="student-progress-track" aria-hidden="true"><span style={{ width: `${(step + 1) * 20}%` }}/></div></div>}
          {preview && <section className="preview-banner" aria-label="Read-only tour"><div><strong>Read-only tour · synthetic data</strong><p>{previewScenario === "estimated" ? "A fixed sample estimate and matching mock results are displayed." : "You are exploring sample information."} Nothing here is saved, confirmed, submitted, or sent to Django.</p><p>{step === 0 ? "To review a real document, resolve conflicts, and confirm values, connect your student account." : step === 1 ? "To add or edit your own expenses and save them, connect your student account." : step === 2 ? "To request a budget for your saved information, connect your student account." : step === 3 ? "To add funding sources or request recommendations, connect your student account." : "To enter affordability details, create a quote, or submit an application, connect your student account."}</p></div><button className="secondary" onClick={leavePreview}>Use my own information</button></section>}
          {error && (
            <div className="stale-banner" role="alert">
              {error}
              {!!errorDetails && <details><summary>View backend response</summary><pre className="backend-json">{JSON.stringify(errorDetails,null,2)}</pre></details>}
              {unsavedDraft && (
                <button
                  className="secondary"
                  onClick={() => {
                    setDraft(unsavedDraft);
                    setUnsavedDraft(null);
                    setError(
                      "Restored local edits on top of the latest version. Review every value before saving.",
                    );
                  }}
                >
                  Restore my unsaved edits
                </button>
              )}
            </div>
          )}
          {notice && (!preview || !notice.startsWith("Synthetic preview loaded")) && (
            <div className="demo" role="status">
              <span aria-hidden="true">✓</span> {notice}
            </div>
          )}
          {client && !preview && <div className="next-action"><strong>Your next step</strong><span>{nextAction}</span></div>}
          {busy && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true"/> Working on your request…</div>}
          {!client ? (
            <div className="student-start">
              <section className="student-welcome" aria-labelledby="welcome-title">
                <span className="eyebrow">WELCOME TO STUDYFLOW</span>
                <h1 id="welcome-title">A clearer plan for studying abroad.</h1>
                <p>Check your admission details, understand upcoming costs, and explore your funding options—one step at a time.</p>
                <div className="student-welcome-actions"><button className="primary" onClick={() => setDashboardPreview(true)}>Preview student dashboard <span aria-hidden="true">→</span></button><button className="secondary" onClick={startPreview}>Explore the five steps</button></div>
                <small>Sample data only. You can explore without signing in or changing anything.</small>
              </section>
              <section className="student-start-grid" aria-label="How StudyFlow helps">
                <article><span aria-hidden="true">01</span><h2>Check your information</h2><p>Review what your documents say and correct anything that needs attention.</p></article>
                <article><span aria-hidden="true">02</span><h2>Plan your expenses</h2><p>Add costs you expect, including ones you don't know yet.</p></article>
                <article><span aria-hidden="true">03</span><h2>See your next steps</h2><p>Explore budget, funding, and application results supplied by the system.</p></article>
              </section>
              <section className="student-developer-tools" id="student-sign-in"><h2>Connect to saved information</h2><p>Sign in with your StudyFlow account to restore your saved progress. The tour uses synthetic data.</p><a ref={connectInputRef} className="primary" href={`/api/auth/login/?next=${encodeURIComponent(window.location.origin+"/")}`}>Sign in to StudyFlow</a><button className="secondary" disabled={busy} onClick={connect}>Refresh sign-in session</button><div className="student-tool-links"><button className="secondary" onClick={()=>onWallet(true)}>Preview wallet & transfers</button><button className="secondary" onClick={onDemo}>Explore the original demo</button></div></section>
            </div>
          ) : (
            <>
              {!preview && <div className="backend-toolbar">
                <span>
                  {state
                    ? `Saved semester · ${semester?.draft.profile.semester || state.semester_id}`
                    : "No semester started yet"}
                </span>
                <button
                  className="secondary"
                  disabled={preview || busy}
                  onClick={() => act(() => refresh())}
                >
                  Refresh saved information
                </button>
              </div>}
              {!state ? (
                <section className="card backend-section">
                  <h2>Create a semester</h2>
                  <p>
                    The template supplies school costs and required categories.
                    Enter a real planning balance and reserve; blank reserve
                    stays unknown.
                  </p>
                  <label>
                    Template
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.key} · v{t.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Opening balance (THB)
                    <input
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Balance as of
                    <input
                      type="date"
                      value={asOf}
                      onChange={(e) => setAsOf(e.target.value)}
                    />
                  </label>
                  <label>
                    Reserve (THB; optional until confirmed)
                    <input
                      value={reserve}
                      onChange={(e) => setReserve(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <button
                    className="primary"
                    disabled={preview || busy || !openingBalance || !asOf}
                    onClick={createSemester}
                  >
                    Create semester
                  </button>
                </section>
              ) : (
                <>
                  {step === 0 && (
                    preview && formDraft ? <PreviewConfirmation draft={formDraft} material={material} onContinue={() => setStep(1)} /> : <fieldset className="preview-form-lock">
                      <section className="card backend-section">
                        <h2>Check your school and dates</h2>
                        <p>
                          Review the details below. You can correct the proposed values while the original document evidence stays available for comparison.
                        </p>
                        {material?.status === "NEEDS_REVIEW" && <div className="expense-intro"><strong>Your document is ready to review</strong><span>Check any conflicting values, then choose which saved costs to confirm below.</span></div>}
                        <div className="backend-fields">{formDraft &&
                          [
                            "school",
                            "campus",
                            "country",
                            "student_type",
                            "program",
                            "semester",
                            "start_date",
                            "end_date",
                          ].map((field) => (
                            <label key={field}>
                              {field.replaceAll("_", " ")}
                              <input
                                value={String(formDraft.profile[field] ?? "")}
                                onChange={(e) =>
                                  editProfile(field, e.target.value)
                                }
                              />
                            </label>
                          ))}</div>
                        <button
                          className="secondary"
                          disabled={preview || busy}
                          onClick={saveDraft}
                        >
                          Save profile corrections
                        </button>
                      </section>
                      <section className="card backend-section">
                        <h2>Upload admission material</h2>
                        <p>
                          Use UTF-8 text, a text PDF, or an image if OCR is
                          enabled. Maximum 5 MiB. Processing is asynchronous.
                        </p>
                        <input
                          type="file"
                          aria-label="Admission document"
                          accept=".txt,.pdf,.png,.jpg,.jpeg"
                          onChange={(e) => {
                            setUpload(e.target.files?.[0] ?? null);
                            setOcrConsent(false);
                          }}
                        />
                        {upload &&
                          (upload.type.startsWith("image/") ||
                            upload.type === "application/pdf") &&
                          ocrNotice && (
                            <div className="backend-review">
                              <p>
                                OCR available:{" "}
                                {String(
                                  ocrNotice.enabled &&
                                    ocrNotice.configured &&
                                    ocrNotice.policy_configured,
                                )}
                                . Text PDFs can use their text layer without
                                OCR.
                              </p>
                              <p>{ocrNotice.text_en}</p>
                              <label>
                                Language
                                <select
                                  value={ocrLanguage}
                                  onChange={(e) =>
                                    setOcrLanguage(e.target.value)
                                  }
                                >
                                  <option value="zh-en">
                                    Chinese and English
                                  </option>
                                  <option value="en">English</option>
                                  <option value="zh">Chinese</option>
                                </select>
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={ocrConsent}
                                  onChange={(e) =>
                                    setOcrConsent(e.target.checked)
                                  }
                                />
                                I agree to OCR for this file if its pages need
                                transcription.
                              </label>
                            </div>
                          )}
                        <button
                          className="primary"
                          disabled={preview || busy || !upload}
                          onClick={uploadMaterial}
                        >
                          Upload for extraction
                        </button>
                        {material && (
                          <div className="backend-review">
                            <p>
                              <strong>Status: {material.status}</strong> · Job:{" "}
                              {material.job_status ?? "not started"}
                              {material.error_code &&
                                ` · ${material.error_code}`}
                            </p>
                            <button
                              className="secondary"
                              disabled={preview || busy}
                              onClick={refreshImport}
                            >
                              Refresh processing status
                            </button>
                            {material.result.issues?.map((i) => (
                              <p key={i.code}>{explainCode(i.code)}</p>
                            ))}
                            {!!material.result.issues?.length && <details><summary>View extraction codes</summary>{material.result.issues.map((i) => <p key={i.code}>{i.code}</p>)}</details>}
                            {material.status === "NEEDS_MANUAL_INPUT" && (
                              <label>
                                Manual transcription
                                <textarea
                                  value={transcription}
                                  onChange={(e) =>
                                    setTranscription(e.target.value)
                                  }
                                  placeholder="Enter the text you reviewed from the document"
                                />
                                <button
                                  className="secondary"
                                  disabled={preview || busy || !transcription.trim()}
                                  onClick={transcribeMaterial}
                                >
                                  Submit transcription
                                </button>
                              </label>
                            )}
                          </div>
                        )}
                      </section>
                      {material?.status === "NEEDS_REVIEW" && (
                        <section className="card backend-section">
                        <h2>Review information from your document</h2>
                          <p>
                            The original extraction stays on this import. The
                            proposed draft below contains any student
                            corrections.
                          </p>
                          <details className="source-evidence">
                            <summary>View original extracted values and sources</summary>
                          {material.result.draft?.profile.evidence?.map(
                            (ev, i) => (
                              <blockquote key={`profile-${i}`}>
                                {ev.quote}
                                <small>
                                  {" "}
                                  {ev.source_id} · {ev.locator}
                                </small>
                              </blockquote>
                            ),
                          )}
                          {material.result.draft?.costs.map((c) => (
                            <div className="backend-row" key={c.cost_id}>
                              <strong>{c.component ?? c.category}</strong>
                              <span>
                                {money(c.amount, c.currency ?? "THB")} ·{" "}
                                {c.due_date ?? "date missing"}
                              </span>
                              <span>{c.confidence_type ?? "UNCONFIRMED"}</span>
                              {c.evidence?.map((ev, i) => (
                                <blockquote key={i}>
                                  {ev.quote}
                                  <small>
                                    {" "}
                                    {ev.source_id} · {ev.locator}
                                  </small>
                                </blockquote>
                              ))}
                            </div>
                          ))}
                          </details>
                          {Object.entries(conflicts).map(([field, value]) => (
                            <label key={field}>
                              Sources disagree about {field.replace(/^profile\./, "").replaceAll("_", " ")}
                              <small>Values found: {Array.isArray(value) ? value.join(" · ") : JSON.stringify(value)}. Check the source and explain which value you chose.</small>
                              <input
                                aria-label={`Resolve conflict: ${field}`} value={resolutions[field] ?? ""}
                                onChange={(e) =>
                                  setResolutions({
                                    ...resolutions,
                                    [field]: e.target.value,
                                  })
                                }
                                placeholder="Explain the selected value and source"
                              />
                            </label>
                          ))}
                          <h3>Check the suggested costs</h3>
                          <p>
                            You can correct a suggested cost here. The value found in your document remains available under original values and sources.
                          </p>
                          {formDraft?.costs
                            .filter(
                              (c) =>
                                c.source_refs?.includes(material.id) ||
                                c.conflict,
                            )
                            .map((c) => (
                              <div
                                className="backend-cost"
                                key={`proposed-${c.cost_id}`}
                              >
                                <strong>
                                  {c.component ?? c.category}
                                </strong>
                                <div className="backend-fields">
                                  <label>
                                    Proposed amount
                                    <input
                                      aria-label={`${c.cost_id} proposed amount`}
                                      value={c.amount ?? ""}
                                      onChange={(e) =>
                                        editCost(c.cost_id, {
                                          amount: e.target.value || null,
                                        })
                                      }
                                      placeholder="Missing"
                                    />
                                  </label>
                                  <label>
                                    Currency
                                    <input
                                      value={c.currency ?? ""}
                                      onChange={(e) =>
                                        editCost(c.cost_id, {
                                          currency:
                                            e.target.value.toUpperCase() ||
                                            null,
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Payment status
                                    <select disabled={preview} aria-label={`${c.cost_id} proposed payment status`} value={c.paid == null ? "" : String(c.paid)} onChange={(e) => editCost(c.cost_id, {paid: e.target.value === "" ? null : e.target.value === "true"})}>
                                      <option value="">Unknown</option><option value="false">Unpaid</option><option value="true">Paid</option>
                                    </select>
                                  </label>
                                  <label>
                                    Due date
                                    <input aria-label={`${c.cost_id} proposed due date`}
                                      type="date"
                                      value={c.due_date ?? ""}
                                      onChange={(e) =>
                                        editCost(c.cost_id, {
                                          due_date: e.target.value || null,
                                        })
                                      }
                                    />
                                  </label>
                                </div>
                                {c.evidence?.map((ev, i) => (
                                  <blockquote key={i}>
                                    {ev.quote}
                                    <small>
                                      {" "}
                                      {ev.source_id} · {ev.locator}
                                    </small>
                                  </blockquote>
                                ))}
                              </div>
                            ))}
                          <h3>Choose the costs to confirm</h3>
                          <p>
                            Select the costs you checked against your document. Your corrections stay separate from the original extraction.
                          </p>
                          {material.result.proposed_draft?.costs
                            .filter(
                              (c) =>
                                c.source_refs?.includes(material.id) ||
                                c.conflict,
                            )
                            .map((c) => (
                              <label className="check" key={c.cost_id}>
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(c.cost_id)}
                                  onChange={(e) =>
                                    setSelectedIds(
                                      e.target.checked
                                        ? [...selectedIds, c.cost_id]
                                        : selectedIds.filter(
                                            (id) => id !== c.cost_id,
                                          ),
                                    )
                                  }
                                />
                                {c.component ?? c.category}
                              </label>
                            ))}
                          {material.result.proposed_draft?.costs
                            .filter((c) => selectedIds.includes(c.cost_id))
                            .map((c) => (
                              <label key={`reason-${c.cost_id}`}>
                                Why you selected {c.component ?? c.category}
                                <input
                                  aria-label={c.conflict ? `Resolve conflict: ${c.cost_id}` : `review reason for ${c.cost_id}`} value={resolutions[c.cost_id] ?? ""}
                                  onChange={(e) =>
                                    setResolutions({
                                      ...resolutions,
                                      [c.cost_id]: e.target.value,
                                    })
                                  }
                                  placeholder="Explain the selected cost and evidence"
                                />
                              </label>
                            ))}
                          <label>
                            Name of the school or issuer on the document
                            <input
                              aria-label="Document issuer" value={issuer}
                              onChange={(e) => setIssuer(e.target.value)}
                            />
                          </label>
                          <button
                            className="primary"
                            disabled={preview || busy}
                            onClick={confirmImport}
                          >
                            Confirm selected information
                          </button>
                        </section>
                      )}
                    </fieldset>
                  )}
                  {step === 1 && formDraft && (
                    <section className="card backend-section">
                      <h2>Complete your expenses</h2>
                      <p>
                        Start with missing costs. You can leave an amount unknown; your budget will show what information is still needed.
                      </p>
                      <label>Reserve (THB)<input disabled={preview} aria-label="Saved reserve (THB)" inputMode="decimal" value={formDraft.reserve ?? ""} onChange={(e) => setDraft({...formDraft, reserve: e.target.value || null})}/></label>
                      <div className="expense-intro"><strong>{missingCostCount} listed {missingCostCount === 1 ? "cost" : "costs"} still need an amount</strong><span>Categories needed for a complete plan: {formDraft.required_categories?.join(", ") || "not supplied"}.</span></div>
                      <h3>Review your costs</h3>
                      <p>{preview ? "This tour shows fixed sample costs. Use the Food example below to switch the entire demo result." : "Items needing an amount or source review appear first. Verified document costs need a new import to change."}</p>
                      {[...formDraft.costs].sort((a, b) => Number(!!b.conflict || b.amount == null && b.applicability !== "NOT_APPLICABLE") - Number(!!a.conflict || a.amount == null && a.applicability !== "NOT_APPLICABLE")).map((c) => (
                        <article className="backend-cost expense-review-card" key={c.cost_id} id={`cost-${c.cost_id}`} tabIndex={-1}>
                          <div className="backend-row"><div><strong>{c.component ?? c.category}</strong><small>{c.source_refs?.length ? "From your document" : c.synthetic && c.amount == null ? "Sample expense · amount unknown" : c.synthetic ? "Sample starting value" : "Added by you"}</small></div><span className={`status ${c.amount == null && c.applicability !== "NOT_APPLICABLE" ? "missing" : (c.locked || c.confidence_type === "VERIFIED") ? "known" : "estimated"}`}>{c.conflict ? "Conflicting sources" : c.applicability === "NOT_APPLICABLE" ? "Not applicable" : c.amount == null ? "Amount unknown" : (c.locked || c.confidence_type === "VERIFIED") ? "Document verified" : c.synthetic ? "Sample amount" : c.source_refs?.length ? "Document value · review" : "Added by you"}</span></div>
                          {preview ? <div className="preview-cost-summary">{c.cost_id === "preview-food" && <div className="preview-cost-context"><span>Step 2 · Complete expenses</span><button className="secondary" onClick={() => setStep(2)}>Back to Budget</button></div>}<strong>{c.amount == null ? "Amount unknown" : `${money(c.amount, c.currency ?? "THB")} · ${c.period ?? "period unknown"}`}</strong>{c.cost_id === "preview-food" && <button className="primary" disabled={busy} onClick={() => void showPreviewScenario(previewScenario === "missing" ? "estimated" : "missing")}>{previewScenario === "missing" ? "Try sample Food estimate: THB 3,000 monthly" : "Reset Food to missing"}</button>}<small>{c.cost_id === "preview-food" ? "This switches all demo expenses, budget, calendar, and funding responses together. Nothing is saved." : c.source_refs?.length ? "Value from the sample document." : "Fixed sample expense."}</small></div> : <details className="cost-details" open={expandedCosts[c.cost_id] ?? (!!c.conflict || c.amount == null && c.applicability !== "NOT_APPLICABLE")} onToggle={(event) => { const open = event.currentTarget.open; setExpandedCosts((previous) => previous[c.cost_id] === open ? previous : { ...previous, [c.cost_id]: open }); }}>
                            <summary>{c.amount == null ? "Review missing cost" : `View details · ${money(c.amount, c.currency ?? "THB")}`}</summary>
                          <div className="backend-fields">
                            <label>
                              Category
                              <select
                                value={c.category}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    category: e.target.value,
                                  })
                                }
                              >
                                {categories.map((x) => (
                                  <option key={x}>{x}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Amount
                              <input
                                aria-label={`${c.cost_id} amount`}
                                value={c.amount ?? ""}
                                disabled={
                                  (c.locked || c.confidence_type === "VERIFIED") ||
                                  c.applicability === "NOT_APPLICABLE"
                                }
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    amount: e.target.value || null,
                                  })
                                }
                                inputMode="decimal"
                                placeholder="Missing"
                              />
                            </label>
                            <label>
                              Currency
                              <input
                                value={c.currency ?? ""}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    currency:
                                      e.target.value.toUpperCase() || null,
                                  })
                                }
                              />
                            </label>
                            <label>Payment status<select aria-label={`${c.cost_id} payment status`} disabled={!!c.locked || c.confidence_type==="VERIFIED"} value={c.paid==null?"":String(c.paid)} onChange={e=>editCost(c.cost_id,{paid:e.target.value===""?null:e.target.value==="true"})}><option value="">Unknown</option><option value="false">Unpaid</option><option value="true">Paid</option></select></label>
                            <label>
                              Period
                              <select
                                value={c.period ?? ""}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    period: (e.target.value || null) as Cost["period"],
                                  })
                                }
                              >
                                <option value="">Unknown</option>
                                {["once", "monthly", "semester", "yearly"].map(
                                  (x) => (
                                    <option key={x}>{x}</option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label>
                              Due date
                              <input
                                type="date"
                                value={c.due_date ?? ""}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    due_date: e.target.value || null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Applicability
                              <select
                                value={c.applicability ?? "APPLICABLE"}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    applicability: e.target
                                      .value as Cost["applicability"],
                                  })
                                }
                              >
                                <option value="APPLICABLE">I expect this cost</option>
                                <option value="NOT_APPLICABLE">This cost does not apply to me</option>
                              </select>
                            </label>
                          </div>
                          {c.applicability === "NOT_APPLICABLE" && (
                            <label>
                              Why this cost does not apply
                              <input
                                value={c.applicability_reason ?? ""}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    applicability_reason:
                                      e.target.value || null,
                                  })
                                }
                              />
                            </label>
                          )}
                          {c.conflict && (
                            <p className="error">
                              Conflicting source values need review.
                            </p>
                          )}
                          {c.amount == null &&
                            c.applicability !== "NOT_APPLICABLE" && (
                              <p className="error">
                                Amount still unknown. Your budget will remain incomplete until this is addressed.
                              </p>
                            )}
                          </details>}
                        </article>
                      ))}
                      {!preview && <><button
                        className="secondary"
                        disabled={busy}
                        onClick={addCost}
                      >
                        Add expense
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={saveDraft}
                      >
                        Save expense revisions
                      </button></>}
                    </section>
                  )}
                  {step === 2 && (
                    <>
                      <section className="card backend-section result-overview" aria-labelledby="budget-overview-title">
                        <span className="eyebrow">YOUR BUDGET</span>
                        {dirty && !preview && <div className="stale-banner" role="status"><h2>Update needed</h2><p>Save your expense edits before requesting or relying on budget results.</p></div>}
                        <h2 id="budget-overview-title">{budgetData ? budget && !resultFresh(budget, state) ? "Update your budget results" : budgetData.complete ? preview ? "Demo budget inputs are complete" : "Your budget is ready to review" : "Your budget needs more information" : "Build your first budget"}</h2>
                        <p>{preview ? "These figures are fixed demo responses for the current example state. Your real result would come from Django." : budgetData ? budgetData.complete ? "These figures reflect the information saved for this result." : "Some information is still missing. The reported amounts may change when you complete it." : "Save your costs, then request a budget result."}</p>
                        {preview && budgetData?.complete && Object.keys(material?.result.merge_conflicts ?? {}).length > 0 && <div className="result-attention" role="note"><strong>Admission review is still unfinished</strong><p>This mock budget reports complete expense inputs after the sample Food estimate. The sample campus conflict on Confirm information is still unresolved; nothing was confirmed or saved.</p></div>}
                        {budget && !resultFresh(budget, state) && <div className="stale-banner" role="status">Your information changed. Update the budget before relying on these figures.</div>}
                        {budgetData && <>
                          <div className="result-highlights"><div><span>Reported funding gap</span><strong>{formatMoney(budgetData.gap, budgetData.currency)}</strong><small>{preview ? budgetData.complete ? "Complete mock result · sample estimate" : "Incomplete mock result · Food missing" : budgetData.complete ? "From your saved budget result" : "Incomplete result · review missing information"}</small></div><div><span>Next scheduled cost</span><strong>{nextScheduledCost ? nextScheduledCost.label : "Check payment calendar"}</strong><small>{nextScheduledCost ? `${formatDate(nextScheduledCost.date)} · ${formatMoney(nextScheduledCost.amount, forecast!.result.currency)}` : "Shown when an up-to-date calendar is available"}</small></div></div>
                          <details className="result-details student-explainer"><summary>What does “funding gap” mean?</summary><p>It is the shortfall reported by the budget service for this result. A missing expense can change the result, so check the completeness label before relying on the figure. StudyFlow does not treat an unknown cost as zero.</p></details>
                          {budgetData.issues.length > 0 && <div className="result-attention"><strong>Before relying on this budget</strong><ul>{budgetData.issues.map((issue) => <li key={issue}>{explainCode(issue)}</li>)}</ul></div>}
                          <details className="result-details"><summary>Compare low, base, and high scenarios</summary><div className="backend-scenarios">{(["low", "base", "high"] as const).map((name) => <div key={name}><span>{name}</span><strong>{formatMoney(budgetData[name], budgetData.currency)}</strong></div>)}</div><p>Remaining base: {formatMoney(budgetData.remaining_base, budgetData.currency)}. These are B's returned figures, not a browser calculation.</p></details>
                          <details className="result-details"><summary>Assumptions and result details</summary>{budgetData.assumptions.length ? <ul>{budgetData.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No assumptions were supplied.</p>}<p>Information: {budgetData.complete ? "complete" : "incomplete"} · B reported gap: {budgetData.sufficient ? "No gap" : "Gap or issues to review"}</p>{budgetData.issues.length > 0 && <details><summary>View backend issue codes</summary><ul>{budgetData.issues.map((item) => <li key={item}>{item}</li>)}</ul></details>}</details>
                        </>}
                        {!preview && <button className="primary" disabled={busy || dirty} onClick={calculateBudget}>Update budget results</button>}
                      </section>
                      {preview && <PreviewWalkthrough scenario={previewScenario} onOpenExpenses={() => { focusCostRef.current = "preview-food"; setStep(1); setShowSteps(false); }} />}
                      {preview ? <details className="preview-calendar-details"><summary>Explore the detailed payment calendar</summary>{paymentCalendar}</details> : paymentCalendar}
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <FundingComparison
                        preview={preview}
                        recommendation={funding}
                        current={resultFresh(funding, state)}
                        sources={sources}
                        quotes={quotes}
                        application={application}
                        savedPlan={savedFunding}
                        onValidatePlan={saveFundingPlan}
                        validationDisabled={preview || busy || !resultFresh(funding, state)}
                        onReviewQuote={(id) => { setQuoteId(id); setStep(4); }}
                      />
                      {!preview && <section className="card backend-section">
                        <h2>Add or update a funding source</h2>
                        <p>
                          Promised or estimated funding is separate from money you have received. Review each source and its conditions.
                        </p>
                        <details className="funding-add-source">
                          <summary>Add a non-loan funding source</summary>
                        <div className="backend-fields">
                          <label>
                            Kind
                            <select
                              value={sourceKind}
                              onChange={(e) => setSourceKind(e.target.value)}
                            >
                              <option>family</option>
                              <option>scholarship</option>
                              <option>external_savings</option>
                            </select>
                          </label>
                          <label>
                            Amount THB
                            <input
                              value={sourceAmount}
                              onChange={(e) => setSourceAmount(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            Available on
                            <input
                              type="date"
                              value={sourceDate}
                              onChange={(e) => setSourceDate(e.target.value)}
                            />
                          </label>
                        </div>
                        <button
                          className="secondary"
                          disabled={preview || busy || !sourceAmount || !sourceDate}
                          onClick={addSource}
                        >
                          Save funding source
                        </button>
                        </details>
                        <button
                          className="primary"
                          disabled={preview || busy}
                          onClick={recommend}
                        >
                          Get funding recommendation
                        </button>
                      </section>}
                    </>
                  )}
                  {step === 4 && (
                    preview ? <PreviewApplication application={application} quotes={quotes} selectedQuoteId={quoteId} onBack={() => setStep(3)} /> : <fieldset className="preview-form-lock">
                      <section className="card backend-section">
                        <h2>{application ? "Your simulated application" : "Prepare a simulated application"}</h2>
                        {application && <div className="application-status application-live-status" role="status" tabIndex={-1}><strong>{explainCode(application.status)}</strong><span>Application {application.id} · version {application.version}</span><span>Assessment: {application.assessment?.status ? explainCode(application.assessment.status) : "Not yet assessed"}</span></div>}
                        <p>
                          Create or select a quote, then submit a draft. You can follow its review status here. This is a simulation; no money moves.
                        </p>
                        <details className="application-group">
                        <summary>1. Monthly affordability profile</summary>
                        <p>
                          Enter each repayment month. Leave unknown values blank and include other debts under existing repayments.
                        </p>
                        {profileMonths.map((row, index) => (
                          <div className="backend-fields" key={index}>
                            <label>
                              Month
                              <input
                                type="month"
                                value={row.month}
                                onChange={(e) =>
                                  setProfileMonths(
                                    profileMonths.map((x, i) =>
                                      i === index
                                        ? { ...x, month: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            {(
                              [
                                "income",
                                "living_expenses",
                                "existing_repayments",
                              ] as const
                            ).map((field) => (
                              <label key={field}>
                                {field.replaceAll("_", " ")}
                                <input
                                  value={row[field] ?? ""}
                                  onChange={(e) =>
                                    setProfileMonths(
                                      profileMonths.map((x, i) =>
                                        i === index
                                          ? {
                                              ...x,
                                              [field]: e.target.value || null,
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  inputMode="decimal"
                                />
                              </label>
                            ))}
                            <button
                              className="secondary"
                              onClick={() =>
                                setProfileMonths(
                                  profileMonths.filter((_, i) => i !== index),
                                )
                              }
                            >
                              Remove month
                            </button>
                          </div>
                        ))}
                        <button
                          className="secondary"
                          onClick={() =>
                            setProfileMonths([
                              ...profileMonths,
                              {
                                month: "",
                                income: null,
                                living_expenses: null,
                                existing_repayments: null,
                              },
                            ])
                          }
                        >
                          Add month
                        </button>
                        <button
                          className="secondary"
                          disabled={preview || busy || profileMonths.some((x) => !x.month)}
                          onClick={saveProfile}
                        >
                          Save monthly profile
                        </button>
                        </details>
                        <details className="application-group" open={!quotes.length}>
                        <summary>2. Create a loan quote</summary>
                        <div className="backend-fields">
                          <label>
                            Principal THB
                            <input
                              value={principal}
                              onChange={(e) => setPrincipal(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            Annual rate as fraction
                            <input
                              value={rate}
                              onChange={(e) => setRate(e.target.value)}
                              placeholder="0.12"
                            />
                          </label>
                          <label>
                            Fees THB
                            <input
                              value={fees}
                              onChange={(e) => setFees(e.target.value)}
                            />
                          </label>
                          <label>
                            Months
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={months}
                              onChange={(e) => setMonths(e.target.value)}
                            />
                          </label>
                          <label>
                            First due date
                            <input
                              type="date"
                              value={firstDue}
                              onChange={(e) => setFirstDue(e.target.value)}
                            />
                          </label>
                        </div>
                        <button
                          className="secondary"
                          disabled={preview || busy || !principal || !rate || !firstDue}
                          onClick={addQuote}
                        >
                          Create loan quote
                        </button>
                        </details>
                        <h3>3. Review a quote and application</h3>
                        <label>
                          Select quote
                          <select
                            value={quoteId}
                            onChange={(e) => setQuoteId(e.target.value)}
                          >
                            <option value="">Select</option>
                            {quotes.map((q) => (
                              <option value={q.id} key={q.id}>
                                {q.id} · {money(q.inputs?.principal ?? null)}
                              </option>
                            ))}
                          </select>
                        </label>
                        {quotes
                          .filter((quote) => quote.id === quoteId)
                          .map((quote) => (
                            <div className="backend-cost" key={quote.id}>
                              <strong>Selected loan quote</strong>
                              <p>
                                Principal: {money(quote.inputs?.principal)} ·
                                Annual rate:{" "}
                                {quote.inputs?.annual_rate ?? "unknown"} · Fees:{" "}
                                {money(quote.inputs?.fees)} · Months:{" "}
                                {quote.inputs?.months ?? "unknown"}
                              </p>
                              <p>
                                Net proceeds: {formatMoney(quote.result?.net_proceeds)}
                                {" "}· Total repayment: {formatMoney(quote.result?.total_repayment)}
                              </p>
                              {Array.isArray(quote.result?.repayments) && (
                                <details>
                                  <summary>View repayment schedule</summary>
                                  <ul>
                                    {(
                                      quote.result.repayments as Array<
                                        Record<string, unknown>
                                      >
                                    ).map((payment, index) => (
                                      <li key={index}>
                                        {String(payment.due_date ?? "")}:{" "}
                                        {formatMoney(payment.amount ?? payment.payment)}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              )}
                            </div>
                          ))}
                        <button
                          className="primary"
                          disabled={preview || busy || !quoteId || !!application}
                          onClick={createApplication}
                        >
                          Create application draft
                        </button>
                        {application && (
                          <>
                            {application.assessment && (
                              <details>
                                <summary>View B assessment</summary>
                                <pre className="backend-json">
                                  {JSON.stringify(
                                    application.assessment,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            )}
                            <button
                              className="primary"
                              disabled={preview || busy || application.status !== "DRAFT"}
                              onClick={submitApplication}
                            >
                              Submit simulated application
                            </button>
                            <button
                              className="secondary"
                              disabled={preview || busy}
                              onClick={reloadApplication}
                            >
                              Reload application state
                            </button>
                          </>
                        )}
                      </section>
                    </fieldset>
                  )}
                  {preview && step >= 1 && step < 4 && <div className="preview-next-step"><span>This tour does not save or complete a step.</span><button className="primary" onClick={() => { setStep(step + 1); setShowSteps(false); }}>Continue to {steps[step + 1]} <span aria-hidden="true">→</span></button></div>}
                </>
              )}
            </>
          )}
        </>}
        </main>
        <footer>
          StudyFlow · Django connected draft
          <span>Backend controls calculations and decisions</span>
        </footer>
      </div>
    </div>
  );
}
