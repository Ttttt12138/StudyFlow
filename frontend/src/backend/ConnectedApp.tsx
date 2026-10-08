import { LiveDashboard } from "../dashboard/LiveDashboard";
import { DashboardPreview } from "../dashboard/DashboardPreview";
import { useEffect, useRef, useState } from "react";
import { ApiError, DjangoClient, getAll, type StudyFlowClient } from "./client";
import { PaymentCalendar } from "./PaymentCalendar";
import { FundingComparison } from "./FundingComparison";
import { explainCode, formatMoney } from "./presenters";
import { createPreviewClient, previewBudget, previewFunding, previewImport } from "./previewAdapter";
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
export function ConnectedApp({ onDemo }: { onDemo: () => void }) {
  const [session, setSession] = useState<{authenticated: boolean; username: string | null; csrf_token: string} | null>(null);
  const [client, setClient] = useState<StudyFlowClient | null>(null);
  const [preview, setPreview] = useState(false);
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
  const versions = (): Versions => ({
    semester_id: state!.semester_id,
    state_version: state!.state_version,
    budget_version: state!.budget_version,
    analysis_version: state!.analysis_version,
  });
  useEffect(() => {
    setApplication(applications.find((item) => (item.loan ?? item.quote_id) === quoteId) ?? null);
  }, [applications, quoteId]);
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
    const api = createPreviewClient();
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
  function leavePreview() {
    ++connectionEpoch.current;
    setPreview(false);
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
  const conflicts = { ...(material?.result.merge_conflicts ?? {}) };
  if (material?.status === "NEEDS_REVIEW" && draft && semester) {
    for (const cost of draft.costs) {
      const saved = semester.draft.costs.find((row) => row.cost_id === cost.cost_id);
      if (selectedIds.includes(cost.cost_id) && saved &&
          ["amount", "currency", "beneficiary_id"].some((field) => saved[field] !== cost[field])) {
        conflicts[cost.cost_id] ??= "Explain your reviewed correction to the saved document cost.";
      }
    }
  }
  const formDraft = draft ?? semester?.draft;
  const nextAction = !state
    ? "Connect to a saved semester or open the synthetic preview."
    : step === 0
      ? material?.status === "NEEDS_REVIEW" ? "Review the document evidence and confirm your choices." : "Check admission details and upload a document when available."
      : step === 1
        ? formDraft?.costs.some((cost) => cost.applicability !== "NOT_APPLICABLE" && cost.amount == null)
          ? "Review costs with missing amounts, then save your expense revisions."
          : "Review the expense dates and save your revisions."
        : step === 2
          ? budget && !resultFresh(budget, state) ? "Update the budget after your latest changes." : "Review B’s issues and the payment calendar."
          : step === 3
            ? !funding || !resultFresh(funding, state) ? "Request an updated funding recommendation." : "Review conditions and compare the loan quotes."
            : application ? explainCode(application.status) : "Select a quote, then create a simulated application draft.";
  if (dashboardPreview) return <DashboardPreview onExit={() => setDashboardPreview(false)} onJourney={(index) => { setDashboardPreview(false); void startPreview().then(() => setStep(index)); }}/>;
  return (
    <div className={`app connected ${preview ? "preview-mode" : ""}`}>
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDashboard(false);
            setStep(0);
          }}
        >
          <span className="brand-icon">S</span>StudyFlow
          <span className="brand-dot">.</span>
        </a>
        <div className="journey-label">YOUR STUDY PLAN</div>
        <button className="mobile-step-toggle secondary" aria-expanded={showSteps} aria-controls="connected-steps" onClick={() => setShowSteps(!showSteps)}>
          {dashboard ? "Dashboard" : `Step ${step + 1} of 5 · ${steps[step]}`} <span aria-hidden="true">{showSteps ? "−" : "+"}</span>
        </button>
        <nav id="connected-steps" className={showSteps ? "steps-open" : ""} aria-label="Study planning steps">
          {!preview && client && <button className={dashboard ? "active" : ""} onClick={() => { setDashboard(true); setShowSteps(false); }}>Dashboard</button>}
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
        <div className="sidebar-note">
          <strong>Your study plan</strong>
          <p>Review each step at your own pace. Your saved information is available when you return.</p>
        </div>
        <button className="secondary" onClick={onDemo}>
          View synthetic demo
        </button>
        {preview && <button className="secondary" onClick={leavePreview}>Connect to Django instead</button>}
      </aside>
      <div className="workspace">
        <header>
          <span>StudyFlow / {dashboard ? "Dashboard" : steps[step]}</span>
          <span className="avatar" aria-label={session?.username ?? "Student"}>{session?.username?.slice(0, 2).toUpperCase() ?? "ST"}</span>
        </header>
        <main>
          {dashboard && client && !preview ? <LiveDashboard api={client as DjangoClient} dirty={dirty} onJourney={(index) => { setDashboard(false); setStep(index); }} /> : <>
          <div className="section-heading">
            <div>
              <span className="eyebrow">STEP 0{step + 1} / 05</span>
              <h1>{steps[step]}</h1>
              <p>{stepHelp[step]}</p>
            </div>
          </div>
          {preview && <div className="preview-banner" role="status"><strong>UI preview · synthetic data</strong><span>Explore all five connected screens without a token. Preview data cannot be saved, and calculation actions are disabled. Nothing is sent to Django.</span></div>}
          {error && (
            <div className="stale-banner" role="alert">
              {error}
              {!!errorDetails && <details><summary>View backend response</summary><pre className="backend-json">{JSON.stringify(errorDetails, null, 2)}</pre></details>}
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
          {notice && (
            <div className="demo" role="status">
              <span aria-hidden="true">✓</span> {notice}
            </div>
          )}
          {client && <div className="next-action"><strong>What to do next</strong><span>{nextAction}</span></div>}
          {busy && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true"/> Working on your request…</div>}
          {!client ? (
            <section className="card backend-section">
              <h2>Start your study plan</h2>
              <p>Connect your student account to review saved admission information, expenses, and results.</p>
              <div className="setup-details">
                <p>Sign in with your StudyFlow account to restore your saved progress.</p>
                <a className="primary" href={`/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/")}`}>Sign in to StudyFlow</a>
                <button className="secondary" disabled={busy} onClick={connect}>Refresh sign-in session</button>
              </div>
              <div className="preview-prompt"><span>Just looking around?</span><button className="secondary" onClick={startPreview}>Preview connected pages</button><button className="secondary" onClick={onDemo}>Explore the original demo</button><button className="secondary" onClick={() => setDashboardPreview(true)}>Preview student dashboard</button></div>
            </section>
          ) : (
            <>
              <div className="backend-toolbar">
                <span>
                  {state
                    ? `Saved semester · ${semester?.draft.profile.semester || state.semester_id}`
                    : "No semester started yet"}
                </span>
                {!preview && <a className="secondary" href={`/api/auth/login/?next=${encodeURIComponent(window.location.origin + "/")}`}>Account sign-in</a>}
                <button
                  className="secondary"
                  disabled={preview || busy}
                  onClick={() => act(() => refresh())}
                >
                  Refresh saved information
                </button>
              </div>
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
                    <select disabled={preview}
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
                    <input disabled={preview}
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    Balance as of
                    <input disabled={preview}
                      type="date"
                      value={asOf}
                      onChange={(e) => setAsOf(e.target.value)}
                    />
                  </label>
                  <label>
                    Reserve (THB; optional until confirmed)
                    <input disabled={preview}
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
                    <>
                      <section className="card backend-section">
                        <h2>Admission information</h2>
                        <p>
                          Current saved profile. Extracted evidence and
                          conflicts appear after an upload.
                        </p>
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
                              <input disabled={preview}
                                value={String(formDraft.profile[field] ?? "")}
                                onChange={(e) =>
                                  editProfile(field, e.target.value)
                                }
                              />
                            </label>
                          ))}</div>
                        <button
                          className="secondary"
                          disabled={preview || busy || material?.status === "NEEDS_REVIEW"}
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
                        <input disabled={preview}
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
                                <select disabled={preview}
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
                                <input disabled={preview}
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
                                <textarea disabled={preview}
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
                              Resolve conflict: {field}
                              <small>{JSON.stringify(value)}</small>
                              <input disabled={preview}
                                value={resolutions[field] ?? ""}
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
                          <h3>Correct proposed values</h3>
                          <p>
                            These edits change the proposed draft only. The
                            original extraction and evidence remain above.
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
                                  {c.component ?? c.category} · {c.cost_id}
                                </strong>
                                <div className="backend-fields">
                                  <label>
                                    Proposed amount
                                    <input disabled={preview}
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
                                    <input disabled={preview}
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
                                    <input disabled={preview} aria-label={`${c.cost_id} proposed due date`}
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
                          <h3>Select merged costs to confirm</h3>
                          <p>
                            Extraction candidate IDs may differ from saved
                            semester cost IDs. Only costs in the merged draft
                            can be confirmed.
                          </p>
                          {material.result.proposed_draft?.costs
                            .filter(
                              (c) =>
                                c.source_refs?.includes(material.id) ||
                                c.conflict,
                            )
                            .map((c) => (
                              <label className="check" key={c.cost_id}>
                                <input disabled={preview}
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
                                {c.component ?? c.category} · {c.cost_id}
                              </label>
                            ))}
                          {material.result.proposed_draft?.costs
                            .filter((c) => selectedIds.includes(c.cost_id))
                            .map((c) => (
                              <label key={`reason-${c.cost_id}`}>
                                Review reason for {c.component ?? c.category} (
                                {c.cost_id})
                                <input disabled={preview}
                                  value={resolutions[c.cost_id] ?? ""}
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
                            Document issuer
                            <input disabled={preview}
                              value={issuer}
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
                    </>
                  )}
                  {step === 1 && formDraft && (
                    <section className="card backend-section">
                      <h2>Semester expenses</h2>
                      <p>
                        Backend required categories:{" "}
                        {formDraft.required_categories?.join(", ") ||
                          "not supplied"}
                        . Unknown amounts remain blank. Verified costs require a
                        new import to change.
                      </p>
                      <label>Reserve (THB)<input disabled={preview} aria-label="Saved reserve (THB)" inputMode="decimal" value={formDraft.reserve ?? ""} onChange={(e) => setDraft({...formDraft, reserve: e.target.value || null})}/></label>
                      {formDraft.costs.map((c) => (
                        <article className="backend-cost" key={c.cost_id}>
                          <div className="backend-row">
                            <strong>
                              {c.component ?? c.category} · {c.cost_id}
                            </strong>
                            <span>
                              {c.confidence_type ?? "UNCONFIRMED"} ·{" "}
                              {c.source_refs?.length
                                ? "document extraction"
                                : c.synthetic
                                  ? "template/demo"
                                  : "student entry"}
                            </span>
                          </div>
                          <div className="backend-fields">
                            <label>
                              Category
                              <select
                                value={c.category}
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
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
                                disabled={preview ||
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
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    currency:
                                      e.target.value.toUpperCase() || null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Period
                              <select
                                value={c.period ?? ""}
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
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
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    due_date: e.target.value || null,
                                  })
                                }
                              />
                            </label>
                            <label>
                              Payment status
                              <select aria-label={`${c.cost_id} payment status`} disabled={preview || (c.locked || c.confidence_type === "VERIFIED")} value={c.paid == null ? "" : String(c.paid)} onChange={(e) => editCost(c.cost_id, {paid: e.target.value === "" ? null : e.target.value === "true"})}>
                                <option value="">Unknown</option><option value="false">Unpaid</option><option value="true">Paid</option>
                              </select>
                            </label>
                            <label>
                              Applicability
                              <select
                                value={c.applicability ?? "APPLICABLE"}
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    applicability: e.target
                                      .value as Cost["applicability"],
                                  })
                                }
                              >
                                <option>APPLICABLE</option>
                                <option>NOT_APPLICABLE</option>
                              </select>
                            </label>
                          </div>
                          {c.applicability === "NOT_APPLICABLE" && (
                            <label>
                              Reason
                              <input
                                value={c.applicability_reason ?? ""}
                                disabled={preview || (c.locked || c.confidence_type === "VERIFIED")}
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
                                Amount missing; B will mark the budget
                                incomplete.
                              </p>
                            )}
                        </article>
                      ))}
                      <button
                        className="secondary"
                        disabled={preview || busy}
                        onClick={addCost}
                      >
                        Add expense
                      </button>
                      <button
                        className="primary"
                        disabled={preview || busy}
                        onClick={saveDraft}
                      >
                        Save expense revisions
                      </button>
                    </section>
                  )}
                  {step === 2 && (
                    <>
                      <section className="card backend-section">
                        <h2>Your budget scenarios</h2>
                        <p>
                          These figures come from your saved budget result. Request a new result after changing your information.
                        </p>
                        <button
                          className="primary"
                          disabled={preview || busy || dirty}
                          onClick={calculateBudget}
                        >
                          Update budget results
                        </button>
                      </section>
                      {(budget?.result ?? state.budget) && (
                        <section className="card backend-section">
                          <div className="backend-row">
                            <h2>
                              {dirty || (budget && !resultFresh(budget, state))
                                ? "Update needed"
                                : "Current budget"}
                            </h2>
                            <span>
                              Currency:{" "}
                              {(budget?.result ?? state.budget).currency}
                            </span>
                          </div>
                          {(dirty || (budget && !resultFresh(budget, state))) && (
                            <p className="error">
                              Your information changed. Save your edits and update the budget before relying on these figures.
                            </p>
                          )}
                          <div className="backend-scenarios">
                            {(["low", "base", "high"] as const).map((name) => (
                              <div key={name}>
                                <span>{name}</span>
                                <strong>
                                  {money(
                                    (budget?.result ?? state.budget)[name],
                                  )}
                                </strong>
                              </div>
                            ))}
                          </div>
                          <p>Planning funds: {money(state.assets.planning_balance, state.assets.currency)} · Basis: {state.assets.basis.replaceAll("_", " ")} · Reserve: {money(semester?.draft.reserve, state.assets.currency)}</p>
                          <p>
                            Remaining base:{" "}
                            {money(
                              (budget?.result ?? state.budget).remaining_base,
                            )}{" "}
                            · Funding gap:{" "}
                            {money((budget?.result ?? state.budget).gap)}
                          </p>
                          <p>
                            Information {((budget?.result ?? state.budget).complete) ? "complete" : "incomplete"} · {((budget?.result ?? state.budget).sufficient) ? "No gap reported" : "Review the funding gap and issues below"}
                          </p>
                          <h3>Assumptions</h3>
                          <ul>{(budget?.result ?? state.budget).assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
                          <h3>Issues</h3>
                          {(budget?.result ?? state.budget).issues.length ? (
                            <ul>
                              {(budget?.result ?? state.budget).issues.map(
                                (x) => (
                                  <li key={x}>{explainCode(x)}</li>
                                ),
                              )}
                            </ul>
                          ) : (
                            <p>No issues reported for this budget.</p>
                          )}
                          {!!(budget?.result ?? state.budget).issues.length && <details><summary>View backend issue codes</summary><ul>{(budget?.result ?? state.budget).issues.map((x) => <li key={x}>{x}</li>)}</ul></details>}
                        </section>
                      )}
                      <PaymentCalendar
                        forecast={forecast}
                        current={resultFresh(forecast, state)}
                        costs={formDraft?.costs ?? []}
                        sources={sources}
                        busy={busy || preview || dirty}
                        onUpdate={updateCalendar}
                      />
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <section className="card backend-section">
                        <h2>Funding sources</h2>
                        <p>
                          Promised or estimated funding is separate from money you have received. Review each source and its conditions.
                        </p>
                        <details className="funding-add-source">
                          <summary>Add a non-loan funding source</summary>
                        <div className="backend-fields">
                          <label>
                            Kind
                            <select disabled={preview}
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
                            <input disabled={preview}
                              value={sourceAmount}
                              onChange={(e) => setSourceAmount(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            Available on
                            <input disabled={preview}
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
                          disabled={preview || busy || dirty}
                          onClick={recommend}
                        >
                          Get funding recommendation
                        </button>
                      </section>
                      <FundingComparison
                        recommendation={funding}
                        current={resultFresh(funding, state)}
                        sources={sources}
                        quotes={quotes}
                        application={application}
                        savedPlan={savedFunding}
                        savedPlanCurrent={resultFresh(savedFunding, state)}
                        onValidatePlan={saveFundingPlan}
                        validationDisabled={preview || busy || !resultFresh(funding, state)}
                        onReviewQuote={(id) => { setQuoteId(id); setStep(4); }}
                      />
                    </>
                  )}
                  {step === 4 && (
                    <>
                      <section className="card backend-section">
                        <h2>Simulated loan application</h2>
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
                              <input disabled={preview}
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
                                <input disabled={preview}
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
                              disabled={preview || busy}
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
                          disabled={preview || busy}
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
                            <input disabled={preview}
                              value={principal}
                              onChange={(e) => setPrincipal(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            Annual rate as fraction
                            <input disabled={preview}
                              value={rate}
                              onChange={(e) => setRate(e.target.value)}
                              placeholder="0.12"
                            />
                          </label>
                          <label>
                            Fees THB
                            <input disabled={preview}
                              value={fees}
                              onChange={(e) => setFees(e.target.value)}
                            />
                          </label>
                          <label>
                            Months
                            <input disabled={preview}
                              type="number"
                              min="1"
                              max="60"
                              value={months}
                              onChange={(e) => setMonths(e.target.value)}
                            />
                          </label>
                          <label>
                            First due date
                            <input disabled={preview}
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
                          <select disabled={preview}
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
                            <p className="application-status"><strong>{explainCode(application.status)}</strong><span>Application {application.id} · version {application.version}</span></p>
                            <p>
                              Assessment:{" "}
                              {application.assessment?.status ? explainCode(application.assessment.status) : "Not yet assessed"}
                            </p>
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
                    </>
                  )}
                </>
              )}
            </>
          )}
        </>}
        </main>
        <footer>
          StudyFlow · Student journey
          <span>Backend controls calculations and decisions</span>
        </footer>
      </div>
    </div>
  );
}
