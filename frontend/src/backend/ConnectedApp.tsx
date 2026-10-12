import { useI18n, type MessageKey } from "../i18n";
import { PreviewWalkthrough } from "./PreviewWalkthrough";
import { PreviewConfirmation } from "./PreviewConfirmation";
import { PreviewApplication } from "./PreviewApplication";
import { DashboardPreview } from "../dashboard/DashboardPreview";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, DjangoClient, getAll, type StudyFlowClient } from "./client";
import { PaymentCalendar } from "./PaymentCalendar";
import { FundingComparison } from "./FundingComparison";
import { ModuleNav } from "../services/ModuleNav";
import { explainCode, formatDate, formatMoney } from "./presenters";
import { createPreviewClient, previewBudget, previewFunding, previewImport, type PreviewScenario } from "./previewAdapter";
import { importTouched, rebaseOnSaved, templateId, uploadKind, versionsMatch } from "./logic";
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

// Step names and help are translated at render time (see ConnectedApp).
const stepIndexes = [0, 1, 2, 3, 4] as const;
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
function issueText(error: unknown) {
  if (error instanceof ApiError)
    return `${error.status ? `HTTP ${error.status}: ` : ""}${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
/** Opens the read-only tour straight away at a step, optionally with the payment calendar expanded (from /intro links). */
export type InitialPreview = { step: number; calendar: boolean };
export function ConnectedApp({ onDemo, initialPreview }: { onDemo: () => void; onWallet: (preview: boolean) => void; onAgent: (preview: boolean) => void; onTrust: (preview: boolean) => void; initialPreview?: InitialPreview | null }) {
  const { lang, t } = useI18n();
  const steps = stepIndexes.map((i) => t(`jr.step.${i}` as MessageKey));
  const stepHelp = stepIndexes.map((i) => t(`jr.help.${i}` as MessageKey));
  const previewStepHelp = stepIndexes.map((i) => t(`jr.previewHelp.${i}` as MessageKey));
  const money = (value: string | null | undefined, currency = "THB") => formatMoney(value, currency, lang);
  const [client, setClient] = useState<StudyFlowClient | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewScenario,setPreviewScenario]=useState<PreviewScenario>("missing");
  const [expandedCosts,setExpandedCosts]=useState<Record<string,boolean>>({});
  const focusCostRef=useRef<string|null>(null);
  const focusApplicationStatusRef=useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const [step, setStep] = useState(0);
  const [dashboardPreview, setDashboardPreview] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
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
      rowKey: string;
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
  const actionKeys = useRef<string[]>([]);
  // Last saved draft seen from Django, to tell local edits apart from changes saved elsewhere.
  const savedDraft = useRef<{ semesterId: string; draft: Draft } | null>(null);
  useLayoutEffect(() => {
    if (!client || dashboardPreview) return;
    const costId = focusCostRef.current;
    focusCostRef.current = null;
    const target = costId ? document.getElementById(`cost-${costId}`) : null;
    if (target) target.scrollIntoView({ block: "center", behavior: "instant" });
    else window.scrollTo({ top: 0, behavior: "instant" });
    (target ?? document.getElementById("connected-step-title"))?.focus({ preventScroll: true });
  }, [step, client, dashboardPreview]);
  useLayoutEffect(() => {
    if (!focusApplicationStatusRef.current || step !== 4 || !application) return;
    const status = document.querySelector<HTMLElement>(".application-live-status");
    if (!status) return;
    focusApplicationStatusRef.current = false;
    status.scrollIntoView({ block: "center", behavior: "instant" });
    status.focus({ preventScroll: true });
  }, [application, step]);
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
  const reviewing = material?.status === "NEEDS_REVIEW" && !!material.result.proposed_draft;
  // Review answers belong to one document; never carry them over to the next upload.
  useEffect(() => {
    setIssuer("");
    setResolutions({});
    setTranscription("");
  }, [material?.id]);
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
    actionKeys.current.push(payloadKey);
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
  // keepEdits=false after saving, confirming or switching data sources: Django's draft replaces local edits.
  async function refresh(api = client, stillCurrent = () => true, keepEdits = true) {
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
    const previous = savedDraft.current;
    savedDraft.current = { semesterId: term.id, draft: structuredClone(term.draft) };
    setState(next);
    setSemester(term);
    if (!keepEdits || !dirty || !draft || !previous || previous.semesterId !== term.id) setDraft(structuredClone(term.draft));
    else if (JSON.stringify(previous.draft) !== JSON.stringify(term.draft)) {
      // Saved elsewhere since these edits started: never send them on top of the newer draft unseen.
      if (reviewing && material) setDraft(rebaseOnSaved(draft, term.draft, material.id));
      else {
        setUnsavedDraft(structuredClone(draft));
        setDraft(structuredClone(term.draft));
      }
    }
    setSources(fundingSources);
    setQuotes(loanQuotes);
    setApplications(applications);
    if (!quoteId && applications[0]) setQuoteId(applications[0].loan ?? applications[0].quote_id ?? "");
    setProfileVersion(profile.version);
    setProfileMonths(profile.months.map((row) => ({ ...row, rowKey: crypto.randomUUID() })));
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
    actionKeys.current = [];
    try {
      await action();
      // Retries after a failed reload reuse their keys; a later deliberate repeat gets a new result.
      for (const payloadKey of actionKeys.current) keys.current.delete(payloadKey);
    } catch (e) {
      setErrorDetails(e instanceof ApiError ? e.details : null);
      if (e instanceof ApiError && e.status === 409 && client) {
        // refresh() keeps unsaved edits that still apply and sets aside those overtaken by a newer save.
        try { await refresh(client); } catch (reloadError) {
          setError(`${t("jr.err.reloadFailed")} ${issueText(reloadError)}`);
          return;
        }
        setError(t("jr.err.newerState"));
      } else setError(issueText(e));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    const epoch = ++connectionEpoch.current;
    await act(async () => {
      const response = await fetch("/api/auth/session/", { credentials: "same-origin" })
        .catch(() => { throw new Error(t("common.err.unreachable")); });
      if (!response.ok) throw new ApiError(response.status, t("jr.err.session"));
      const identity = await response.json().catch(() => { throw new Error(t("jr.err.sessionResponse")); });
      if (epoch !== connectionEpoch.current) return;
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
      setSelectedTemplate(list[0] ? templateId(list[0]) : "");
      setClient(api);
      try {
        const restored = await refresh(api, () => epoch === connectionEpoch.current);
        if (epoch !== connectionEpoch.current) return;
        const imports = await api
          .get<ImportRecord[]>("readiness/imports/");
        const pending = imports.find((item) =>
          (!item.semester_id || item.semester_id === restored?.semester_id) && ["QUEUED", "NEEDS_REVIEW", "NEEDS_MANUAL_INPUT"].includes(
            item.status,
          ),
        );
        if (pending) {
          const currentImport = await api.get<ImportRecord>(
            `readiness/imports/${pending.id}/`,
          );
          setMaterial(currentImport);
          if (savedDraft.current) loadProposal(currentImport, savedDraft.current.draft);
        }
        setNotice(t("jr.notice.semesterLoaded"));
      } catch (e) {
        if (e instanceof ApiError && e.status === 400 && JSON.stringify(e.details).includes("NO_ACTIVE_SEMESTER")) {
          setNotice(t("jr.notice.noSemester"));
        } else throw e;
      }
    });
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!initialPreview) { void connect(); return; }
    void startPreview().then((started) => {
      if (!started) return;
      setShowWelcome(false);
      setStep(initialPreview.step);
      if (initialPreview.calendar) openCalendarWhenReady();
    });
  }, []);
  // The tour's calendar sits in a closed <details> on the budget step; open it once rendered.
  function openCalendarWhenReady(tries = 60) {
    const details = document.querySelector<HTMLDetailsElement>(".preview-calendar-details");
    if (!details) { if (tries > 0) requestAnimationFrame(() => openCalendarWhenReady(tries - 1)); return; }
    details.open = true;
    details.scrollIntoView({ block: "start" });
  }
  function loadProposal(record: ImportRecord, base: Draft) {
    const proposed = record.status === "NEEDS_REVIEW" ? record.result.proposed_draft : undefined;
    if (!proposed) return;
    const next = rebaseOnSaved(proposed, base, record.id);
    setDraft(next);
    setSelectedIds(next.costs.filter((cost) => importTouched(cost, record.id)).map((cost) => cost.cost_id));
  }
  async function startPreview() {
    const epoch = ++connectionEpoch.current;
    const api = createPreviewClient("missing");
    setPreviewScenario("missing");
    setError("");
    setShowWelcome(false);
    setPreview(true);
    setClient(api);
    try {
      await refresh(api, () => epoch === connectionEpoch.current, false);
    } catch (reason) {
      setError(issueText(reason));
      return false;
    }
    if (epoch !== connectionEpoch.current) return false;
    setMaterial(structuredClone(previewImport));
    setSelectedIds(previewImport.result.proposed_draft?.costs
      .filter((cost) => cost.source_refs?.includes(previewImport.id))
      .map((cost) => cost.cost_id) ?? []);
    setBudget(structuredClone(previewBudget));
    setFunding(structuredClone(previewFunding));
    setQuoteId("preview-quote");
    setNotice(t("jr.notice.previewLoaded"));
    return true;
  }
  async function showPreviewScenario(scenario: PreviewScenario) {
    if (!preview) return;
    const api = createPreviewClient(scenario);
    const epoch = connectionEpoch.current;
    setBusy(true);
    setError("");
    try {
      await refresh(api, () => epoch === connectionEpoch.current, false);
      if (epoch !== connectionEpoch.current) return;
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
    savedDraft.current = null;
    keys.current.clear();
    setError("");
    setNotice("");
    setDashboardPreview(false);
    setShowWelcome(true);
  }
  function openStudyStep(target: number) {
    setShowWelcome(false);
    setDashboardPreview(false);
    setShowSteps(false);
    if (!client) void startPreview().then((started) => { if (started) setStep(target); });
    else setStep(target);
  }
  async function createSemester() {
    if (!client) return;
    await act(async () => {
      const template = templates.find((x) => templateId(x) === selectedTemplate);
      const body = {
        template_key: template?.key,
        template_version: template?.version,
        room: template?.key.endsWith("single") ? "single" : "shared",
        opening_balance: openingBalance,
        as_of: asOf,
        reserve: reserve || null,
      };
      await send(client, "readiness/semesters/", body);
      await refresh(client, undefined, false);
      setUnsavedDraft(null);
      setNotice(t("jr.notice.semesterCreated"));
    });
  }
  async function uploadMaterial() {
    if (!client || !state || !upload) return;
    const kind = uploadKind(upload);
    if (!kind) {
      setError(t("jr.err.uploadKind"));
      return;
    }
    await act(async () => {
      const form = new FormData();
      for (const [key, value] of Object.entries(versions()))
        if (value !== undefined) form.append(key, String(value));
      form.append("kind", kind);
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
      setNotice(t("jr.notice.uploadQueued"));
    });
  }
  async function refreshImport() {
    if (!client || !material) return;
    await act(async () => {
      const next = await client.get<ImportRecord>(
        `readiness/imports/${material.id}/`,
      );
      setMaterial(next);
      const base = draft ?? savedDraft.current?.draft;
      if (base) loadProposal(next, base);
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
      setNotice(t("jr.notice.transcriptionQueued"));
    });
  }
  async function confirmImport() {
    if (!client || !material || !draft || !state) return;
    if (!issuer.trim() || selectedIds.length === 0) {
      setError(t("jr.err.issuer"));
      return;
    }
    const relevant = new Set([...selectedIds, ...Object.keys(conflicts)]);
    const conflictResolutions = Object.fromEntries(
      Object.entries(resolutions)
        .map(([id, reason]) => [id, reason.trim()])
        .filter(([id, reason]) => relevant.has(id) && reason),
    );
    await act(async () => {
      await send(client, `readiness/imports/${material.id}/confirm/`, {
        ...versions(),
        draft,
        issuer,
        selected_cost_ids: selectedIds,
        conflict_resolutions: conflictResolutions,
      });
      await refresh(client, undefined, false);
      setMaterial(null);
      setNotice(t("jr.notice.reviewSaved"));
    });
  }
  async function saveDraft() {
    if (!client || !draft || !state) return;
    await act(async () => {
      await send(client, "readiness/semesters/revise/", {
        ...versions(),
        draft,
      });
      await refresh(client, undefined, false);
      setUnsavedDraft(null);
      setNotice(t("jr.notice.expensesSaved"));
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
      setNotice(t("jr.notice.budgetReady"));
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
      setNotice(t("jr.notice.calendarReady"));
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
      setNotice(t("jr.notice.fundingReady"));
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
      setNotice(t("jr.notice.fundingReviewed"));
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
      setNotice(t("jr.notice.sourceRecorded"));
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
      setNotice(t("jr.notice.quoteReady"));
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
      setNotice(t("jr.notice.applicationCreated"));
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
      setNotice(t("jr.notice.applicationUpdated"));
    });
  }
  async function saveProfile() {
    if (!client) return;
    await act(async () => {
      const result = await send<{
        version: number;
        months: Array<Omit<(typeof profileMonths)[number], "rowKey">>;
      }>(client, "affordability-profile/", {
        expected_version: profileVersion,
        months: profileMonths.map(({ rowKey: _rowKey, ...row }) => row),
      });
      setProfileVersion(result.version);
      await refresh();
      setNotice(t("jr.notice.profileSaved"));
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
    ? t("jr.next.connect")
    : step === 0
      ? material?.status === "NEEDS_REVIEW" ? t("jr.next.reviewEvidence") : t("jr.next.checkAdmission")
      : step === 1
        ? preview ? previewScenario === "missing" ? t("jr.next.previewFindFood") : t("jr.next.previewFoodEstimated") : formDraft?.costs.some((cost) => cost.applicability !== "NOT_APPLICABLE" && cost.amount == null)
          ? t("jr.next.missingAmounts")
          : t("jr.next.expenseDates")
        : step === 2
          ? preview ? previewScenario === "missing" ? t("jr.next.previewBudgetFind") : t("jr.next.previewBudgetEstimated") : budget && !resultFresh(budget, state) ? t("jr.next.updateBudget") : t("jr.next.reviewBudget")
          : step === 3
            ? !funding || !resultFresh(funding, state) ? t("jr.next.requestFunding") : t("jr.next.compareQuotes")
            : application ? explainCode(application.status, lang) : t("jr.next.selectQuote");
  const paymentCalendar = <PaymentCalendar
    forecast={forecast}
    current={resultFresh(forecast, state)}
    costs={formDraft?.costs ?? []}
    sources={sources}
    busy={busy || preview || dirty}
    preview={preview}
    onUpdate={updateCalendar}
  />;
  return (
    <div className={`app connected ${preview ? "preview-mode" : ""}`}>
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDashboardPreview(false);
            setShowWelcome(true);
          }}
        >
          <span className="brand-icon">S</span>StudyFlow
          <span className="brand-dot">.</span>
        </a>
        <ModuleNav />
        <div className="journey-label">{t("jr.journeyLabel")}</div>
        <button className="mobile-step-toggle secondary" aria-expanded={showSteps} aria-controls="connected-steps" onClick={() => setShowSteps(!showSteps)}>
          {showWelcome ? t("jr.welcomeNav") : dashboardPreview ? t("jr.previewDashboard") : t("jr.stepOf", { n: step + 1, name: steps[step] })} <span aria-hidden="true">{showSteps ? "−" : "+"}</span>
        </button>
        <nav id="connected-steps" className={showSteps ? "steps-open" : ""} aria-label={t("jr.stepsNav")}>
          <button className={showWelcome ? "active" : ""} aria-current={showWelcome ? "page" : undefined} onClick={() => { setShowWelcome(true); setDashboardPreview(false); setShowSteps(false); }}>{t("jr.welcomeNav")}</button>
          <button className={dashboardPreview ? "active" : ""} aria-current={dashboardPreview ? "page" : undefined} onClick={() => { setShowWelcome(false); setDashboardPreview(true); setShowSteps(false); }}>{t("jr.previewDashboard")}</button>
          {steps.map((name, i) => (
            <button
              key={name}
              className={!showWelcome && !dashboardPreview && step === i ? "active" : ""}
              aria-current={!showWelcome && !dashboardPreview && step === i ? "step" : undefined}
              onClick={() => openStudyStep(i)}
            >
              <span className="step-number">0{i + 1}</span>
              {name}
            </button>
          ))}
        </nav>
        {!client && <div className="sidebar-note"><strong>{t("jr.side.title")}</strong><p>{t("jr.side.text")}</p></div>}
        {client && <button className="secondary student-side-action" onClick={onDemo}>
          {t("jr.viewDemo")}
        </button>}
      </aside>
      <div className="workspace">
        <header>
          <span>StudyFlow / {showWelcome ? t("jr.welcomeNav") : dashboardPreview ? t("jr.previewDashboard") : steps[step]}</span>
          <span className="avatar">ST</span>
        </header>
        <main>
          {dashboardPreview ? <DashboardPreview embedded onExit={() => { setDashboardPreview(false); setShowWelcome(true); }} onJourney={openStudyStep} /> : <>
          {client && !showWelcome && <div className="section-heading">
            <div>
              <span className="eyebrow">{t("demo.stepOf", { n: `0${step + 1}` })}</span>
              <h1 id="connected-step-title" tabIndex={-1}>{steps[step]}</h1>
              <p>{preview ? previewStepHelp[step] : stepHelp[step]}</p>
            </div>
          </div>}
          {client && !showWelcome && <div className="student-progress" aria-label={t("jr.progressLabel", { n: step + 1, name: steps[step] })}><div><span>{preview ? t("jr.tourPosition") : t("jr.currentStep")}</span><strong>{t("jr.stepOf", { n: step + 1, name: steps[step] })}</strong></div><div className="student-progress-track" aria-hidden="true"><span style={{ width: `${(step + 1) * 20}%` }}/></div></div>}
          {preview && !showWelcome && <section className="preview-banner" aria-label={t("jr.tour.label")}><div><strong>{t("jr.tour.title")}</strong><p>{previewScenario === "estimated" ? t("jr.tour.estimated") : t("jr.tour.exploring")} {t("jr.tour.nothingSaved")}</p><p>{t(`jr.tour.connect.${step}` as MessageKey)}</p></div><button className="secondary" onClick={leavePreview}>{t("jr.useMine")}</button></section>}
          {error && (
            <div className="stale-banner" role="alert">
              {error}
              {!!errorDetails && <details><summary>{t("jr.viewBackendResponse")}</summary><pre className="backend-json">{JSON.stringify(errorDetails,null,2)}</pre></details>}
            </div>
          )}
          {unsavedDraft && (
            <div className="stale-banner" role="status">
              {t("jr.unsaved.text")}
              <button
                className="secondary"
                onClick={() => {
                  setDraft(unsavedDraft);
                  setUnsavedDraft(null);
                  setError("");
                  setNotice(t("jr.unsaved.restored"));
                }}
              >
                {t("jr.unsaved.restore")}
              </button>
              <button className="secondary" onClick={() => setUnsavedDraft(null)}>{t("jr.unsaved.keep")}</button>
            </div>
          )}
          {notice && (!preview || notice !== t("jr.notice.previewLoaded")) && (
            <div className="demo" role="status">
              <span aria-hidden="true">✓</span> {notice}
            </div>
          )}
          {client && !preview && !showWelcome && <div className="next-action"><strong>{t("jr.nextStep")}</strong><span>{nextAction}</span></div>}
          {busy && !showWelcome && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true"/> {t("jr.working")}</div>}
          {showWelcome || !client ? (
            <div className="student-start">
              <section className="student-welcome" aria-labelledby="welcome-title">
                <span className="eyebrow">{t("jr.welcome.eyebrow")}</span>
                <h1 id="welcome-title">{t("jr.welcome.title")}</h1>
                <p>{t("jr.welcome.text")}</p>
                <div className="student-welcome-actions"><button className="primary" onClick={() => { setShowWelcome(false); setDashboardPreview(true); }}>{t("jr.welcome.previewDashboard")} <span aria-hidden="true">→</span></button><button className="secondary" onClick={() => void startPreview()}>{t("jr.welcome.explore")}</button></div>
                <small>{t("jr.welcome.sample")}</small>
              </section>
              <section className="student-start-grid" aria-label={t("jr.how.label")}>
                <article><span aria-hidden="true">01</span><h2>{t("jr.how.1.title")}</h2><p>{t("jr.how.1.text")}</p></article>
                <article><span aria-hidden="true">02</span><h2>{t("jr.how.2.title")}</h2><p>{t("jr.how.2.text")}</p></article>
                <article><span aria-hidden="true">03</span><h2>{t("jr.how.3.title")}</h2><p>{t("jr.how.3.text")}</p></article>
              </section>
            </div>
          ) : (
            <>
              {!preview && <div className="backend-toolbar">
                <span>
                  {state
                    ? t("jr.toolbar.saved", { name: String(semester?.draft.profile.semester || state.semester_id) })
                    : t("jr.toolbar.none")}
                </span>
                <button
                  className="secondary"
                  disabled={preview || busy}
                  onClick={() => act(() => refresh())}
                >
                  {t("jr.toolbar.refresh")}
                </button>
              </div>}
              {!state ? (
                <section className="card backend-section">
                  <h2>{t("jr.create.title")}</h2>
                  <p>
                    {t("jr.create.text")}
                  </p>
                  <label>
                    {t("jr.create.template")}
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    >
                      {templates.map((t) => (
                        <option key={templateId(t)} value={templateId(t)}>
                          {t.key} · v{t.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {t("jr.create.opening")}
                    <input
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  <label>
                    {t("jr.create.asOf")}
                    <input
                      type="date"
                      value={asOf}
                      onChange={(e) => setAsOf(e.target.value)}
                    />
                  </label>
                  <label>
                    {t("jr.create.reserve")}
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
                    {t("jr.create.submit")}
                  </button>
                </section>
              ) : (
                <>
                  {step === 0 && (
                    preview && formDraft ? <PreviewConfirmation draft={formDraft} material={material} onContinue={() => setStep(1)} /> : <fieldset className="preview-form-lock">
                      <section className="card backend-section">
                        <h2>{t("jr.profile.title")}</h2>
                        <p>
                          {t("jr.profile.text")}
                        </p>
                        {material?.status === "NEEDS_REVIEW" && <div className="expense-intro"><strong>{t("jr.profile.readyTitle")}</strong><span>{t("jr.profile.readyText")}</span></div>}
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
                              {t(`jr.field.${field}` as MessageKey)}
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
                          {t("jr.profile.save")}
                        </button>
                      </section>
                      <section className="card backend-section">
                        <h2>{t("jr.upload.title")}</h2>
                        <p>
                          {t("jr.upload.text")}
                        </p>
                        <input
                          type="file"
                          aria-label={t("jr.upload.document")}
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
                                {t("jr.upload.ocr", { available: String(
                                  ocrNotice.enabled &&
                                    ocrNotice.configured &&
                                    ocrNotice.policy_configured,
                                ) })}
                              </p>
                              <p>{ocrNotice.text_en}</p>
                              <label>
                                {t("jr.upload.language")}
                                <select
                                  value={ocrLanguage}
                                  onChange={(e) =>
                                    setOcrLanguage(e.target.value)
                                  }
                                >
                                  <option value="zh-en">
                                    {t("jr.upload.zhEn")}
                                  </option>
                                  <option value="en">{t("jr.upload.en")}</option>
                                  <option value="zh">{t("jr.upload.zh")}</option>
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
                                {t("jr.upload.consent")}
                              </label>
                            </div>
                          )}
                        <button
                          className="primary"
                          disabled={preview || busy || !upload}
                          onClick={uploadMaterial}
                        >
                          {t("jr.upload.submit")}
                        </button>
                        {material && (
                          <div className="backend-review">
                            <p>
                              <strong>{t("jr.upload.status", { status: material.status })}</strong> · {t("jr.upload.job")}{" "}
                              {material.job_status ?? t("jr.upload.notStarted")}
                              {material.error_code &&
                                ` · ${material.error_code}`}
                            </p>
                            <button
                              className="secondary"
                              disabled={preview || busy}
                              onClick={refreshImport}
                            >
                              {t("jr.upload.refresh")}
                            </button>
                            {material.result.issues?.map((i, n) => (
                              <p key={`${i.code}-${n}`}>{explainCode(i.code, lang)}</p>
                            ))}
                            {!!material.result.issues?.length && <details><summary>{t("jr.upload.codes")}</summary>{material.result.issues.map((i, n) => <p key={`${i.code}-${n}`}>{i.code}</p>)}</details>}
                            {material.status === "NEEDS_MANUAL_INPUT" && (
                              <label>
                                {t("jr.upload.manual")}
                                <textarea
                                  value={transcription}
                                  onChange={(e) =>
                                    setTranscription(e.target.value)
                                  }
                                  placeholder={t("jr.upload.manualHint")}
                                />
                                <button
                                  className="secondary"
                                  disabled={preview || busy || !transcription.trim()}
                                  onClick={transcribeMaterial}
                                >
                                  {t("jr.upload.manualSubmit")}
                                </button>
                              </label>
                            )}
                          </div>
                        )}
                      </section>
                      {material?.status === "NEEDS_REVIEW" && (
                        <section className="card backend-section">
                        <h2>{t("jr.review.title")}</h2>
                          <p>
                            {t("jr.review.text")}
                          </p>
                          <details className="source-evidence">
                            <summary>{t("jr.review.original")}</summary>
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
                                {c.due_date ?? t("jr.dateMissing")}
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
                              {t("jr.review.disagree", { field: field.replace(/^profile\./, "").replaceAll("_", " ") })}
                              <small>{t("jr.review.values", { values: Array.isArray(value) ? value.join(" · ") : JSON.stringify(value) })}</small>
                              <input
                                aria-label={`Resolve conflict: ${field}`} value={resolutions[field] ?? ""}
                                onChange={(e) =>
                                  setResolutions({
                                    ...resolutions,
                                    [field]: e.target.value,
                                  })
                                }
                                placeholder={t("jr.review.explain")}
                              />
                            </label>
                          ))}
                          <h3>{t("jr.review.suggested")}</h3>
                          <p>
                            {t("jr.review.suggestedText")}
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
                                    {t("jr.review.proposedAmount")}
                                    <input
                                      aria-label={`${c.cost_id} proposed amount`}
                                      value={c.amount ?? ""}
                                      onChange={(e) =>
                                        editCost(c.cost_id, {
                                          amount: e.target.value || null,
                                        })
                                      }
                                      placeholder={t("jr.missing")}
                                    />
                                  </label>
                                  <label>
                                    {t("jr.currency")}
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
                                    {t("jr.paymentStatus")}
                                    <select disabled={preview} aria-label={`${c.cost_id} proposed payment status`} value={c.paid == null ? "" : String(c.paid)} onChange={(e) => editCost(c.cost_id, {paid: e.target.value === "" ? null : e.target.value === "true"})}>
                                      <option value="">{t("jr.paid.unknown")}</option><option value="false">{t("jr.paid.false")}</option><option value="true">{t("jr.paid.true")}</option>
                                    </select>
                                  </label>
                                  <label>
                                    {t("jr.dueDate")}
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
                          <h3>{t("jr.review.choose")}</h3>
                          <p>
                            {t("jr.review.chooseText")}
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
                                {t("jr.review.why", { name: String(c.component ?? c.category) })}
                                <input
                                  aria-label={c.conflict ? `Resolve conflict: ${c.cost_id}` : `review reason for ${c.cost_id}`} value={resolutions[c.cost_id] ?? ""}
                                  onChange={(e) =>
                                    setResolutions({
                                      ...resolutions,
                                      [c.cost_id]: e.target.value,
                                    })
                                  }
                                  placeholder={t("jr.review.whyHint")}
                                />
                              </label>
                            ))}
                          <label>
                            {t("jr.review.issuer")}
                            <input
                              aria-label={t("jr.review.issuerAria")} value={issuer}
                              onChange={(e) => setIssuer(e.target.value)}
                            />
                          </label>
                          <button
                            className="primary"
                            disabled={preview || busy}
                            onClick={confirmImport}
                          >
                            {t("jr.review.confirm")}
                          </button>
                        </section>
                      )}
                    </fieldset>
                  )}
                  {step === 1 && formDraft && (
                    <section className="card backend-section">
                      <h2>{t("jr.exp.title")}</h2>
                      <p>
                        {t("jr.exp.text")}
                      </p>
                      <label>{t("jr.exp.reserve")}<input disabled={preview} aria-label={t("jr.exp.reserveAria")} inputMode="decimal" value={formDraft.reserve ?? ""} onChange={(e) => setDraft({...formDraft, reserve: e.target.value || null})}/></label>
                      <div className="expense-intro"><strong>{t(missingCostCount === 1 ? "jr.exp.missingOne" : "jr.exp.missingMany", { n: missingCostCount })}</strong><span>{t("jr.exp.required", { list: formDraft.required_categories?.map((x) => categories.includes(x) ? t(`jr.category.${x}` as MessageKey) : x).join(lang === "zh" ? "、" : ", ") || t("jr.notSupplied") })}</span></div>
                      <h3>{t("jr.exp.review")}</h3>
                      <p>{preview ? t("jr.exp.reviewPreview") : t("jr.exp.reviewLive")}</p>
                      {[...formDraft.costs].sort((a, b) => Number(!!b.conflict || b.amount == null && b.applicability !== "NOT_APPLICABLE") - Number(!!a.conflict || a.amount == null && a.applicability !== "NOT_APPLICABLE")).map((c) => (
                        <article className="backend-cost expense-review-card" key={c.cost_id} id={`cost-${c.cost_id}`} tabIndex={-1}>
                          <div className="backend-row"><div><strong>{c.component ?? c.category}</strong><small>{c.source_refs?.length ? t("jr.cost.fromDocument") : c.synthetic && c.amount == null ? t("jr.cost.sampleUnknown") : c.synthetic ? t("jr.cost.sampleStart") : t("jr.cost.addedByYou")}</small></div><span className={`status ${c.amount == null && c.applicability !== "NOT_APPLICABLE" ? "missing" : (c.locked || c.confidence_type === "VERIFIED") ? "known" : "estimated"}`}>{c.conflict ? t("jr.cost.conflicting") : c.applicability === "NOT_APPLICABLE" ? t("jr.cost.notApplicable") : c.amount == null ? t("jr.cost.amountUnknown") : (c.locked || c.confidence_type === "VERIFIED") ? t("jr.cost.verified") : c.synthetic ? t("jr.cost.sampleAmount") : c.source_refs?.length ? t("jr.cost.documentValue") : t("jr.cost.addedByYou")}</span></div>
                          {preview ? <div className="preview-cost-summary">{c.cost_id === "preview-food" && <div className="preview-cost-context"><span>{t("jr.cost.previewContext")}</span><button className="secondary" onClick={() => setStep(2)}>{t("jr.cost.backToBudget")}</button></div>}<strong>{c.amount == null ? t("jr.cost.amountUnknown") : `${money(c.amount, c.currency ?? "THB")} · ${c.period ? t(`jr.period.${c.period}` as MessageKey) : t("jr.cost.periodUnknown")}`}</strong>{c.cost_id === "preview-food" && <button className="primary" disabled={busy} onClick={() => void showPreviewScenario(previewScenario === "missing" ? "estimated" : "missing")}>{previewScenario === "missing" ? t("jr.cost.tryFood") : t("jr.cost.resetFood")}</button>}<small>{c.cost_id === "preview-food" ? t("jr.cost.foodNote") : c.source_refs?.length ? t("jr.cost.sampleDocument") : t("jr.cost.fixedSample")}</small></div> : <details className="cost-details" open={expandedCosts[c.cost_id] ?? (!!c.conflict || c.amount == null && c.applicability !== "NOT_APPLICABLE")} onToggle={(event) => { const open = event.currentTarget.open; setExpandedCosts((previous) => previous[c.cost_id] === open ? previous : { ...previous, [c.cost_id]: open }); }}>
                            <summary>{c.amount == null ? t("jr.cost.reviewMissing") : t("jr.cost.viewDetails", { amount: money(c.amount, c.currency ?? "THB") })}</summary>
                          <div className="backend-fields">
                            <label>
                              {t("jr.cost.category")}
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
                                  <option key={x} value={x}>{t(`jr.category.${x}` as MessageKey)}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              {t("jr.cost.amount")}
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
                                placeholder={t("jr.missing")}
                              />
                            </label>
                            <label>
                              {t("jr.currency")}
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
                            <label>{t("jr.paymentStatus")}<select aria-label={`${c.cost_id} payment status`} disabled={!!c.locked || c.confidence_type==="VERIFIED"} value={c.paid==null?"":String(c.paid)} onChange={e=>editCost(c.cost_id,{paid:e.target.value===""?null:e.target.value==="true"})}><option value="">{t("jr.paid.unknown")}</option><option value="false">{t("jr.paid.false")}</option><option value="true">{t("jr.paid.true")}</option></select></label>
                            <label>
                              {t("jr.cost.period")}
                              <select
                                value={c.period ?? ""}
                                disabled={(c.locked || c.confidence_type === "VERIFIED")}
                                onChange={(e) =>
                                  editCost(c.cost_id, {
                                    period: (e.target.value || null) as Cost["period"],
                                  })
                                }
                              >
                                <option value="">{t("jr.paid.unknown")}</option>
                                {["once", "monthly", "semester", "yearly"].map(
                                  (x) => (
                                    <option key={x} value={x}>{t(`jr.period.${x}` as MessageKey)}</option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label>
                              {t("jr.dueDate")}
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
                              {t("jr.cost.applicability")}
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
                                <option value="APPLICABLE">{t("jr.cost.applicable")}</option>
                                <option value="NOT_APPLICABLE">{t("jr.cost.notApplicableOption")}</option>
                              </select>
                            </label>
                          </div>
                          {c.applicability === "NOT_APPLICABLE" && (
                            <label>
                              {t("jr.cost.notApplicableWhy")}
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
                              {t("jr.cost.conflictError")}
                            </p>
                          )}
                          {c.amount == null &&
                            c.applicability !== "NOT_APPLICABLE" && (
                              <p className="error">
                                {t("jr.cost.unknownError")}
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
                        {t("jr.exp.add")}
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={saveDraft}
                      >
                        {t("jr.exp.save")}
                      </button></>}
                    </section>
                  )}
                  {step === 2 && (
                    <>
                      <section className="card backend-section result-overview" aria-labelledby="budget-overview-title">
                        <span className="eyebrow">{t("jr.budget.eyebrow")}</span>
                        {dirty && !preview && <div className="stale-banner" role="status"><h2>{t("jr.budget.updateNeeded")}</h2><p>{t("jr.budget.saveFirst")}</p></div>}
                        <h2 id="budget-overview-title">{budgetData ? budget && !resultFresh(budget, state) ? t("jr.budget.titleUpdate") : budgetData.complete ? preview ? t("jr.budget.titlePreviewComplete") : t("jr.budget.titleReady") : t("jr.budget.titleIncomplete") : t("jr.budget.titleFirst")}</h2>
                        <p>{preview ? t("jr.budget.textPreview") : budgetData ? budgetData.complete ? t("jr.budget.textComplete") : t("jr.budget.textIncomplete") : t("jr.budget.textFirst")}</p>
                        {preview && budgetData?.complete && Object.keys(material?.result.merge_conflicts ?? {}).length > 0 && <div className="result-attention" role="note"><strong>{t("jr.budget.admissionTitle")}</strong><p>{t("jr.budget.admissionText")}</p></div>}
                        {budget && !resultFresh(budget, state) && <div className="stale-banner" role="status">{t("jr.budget.changed")}</div>}
                        {budgetData && <>
                          <div className="result-highlights"><div><span>{t("jr.budget.gap")}</span><strong>{formatMoney(budgetData.gap, budgetData.currency, lang)}</strong><small>{preview ? budgetData.complete ? t("jr.budget.gapPreviewComplete") : t("jr.budget.gapPreviewIncomplete") : budgetData.complete ? t("jr.budget.gapComplete") : t("jr.budget.gapIncomplete")}</small></div><div><span>{t("jr.budget.nextCost")}</span><strong>{nextScheduledCost ? nextScheduledCost.label : t("jr.budget.checkCalendar")}</strong><small>{nextScheduledCost ? `${formatDate(nextScheduledCost.date, lang)} · ${formatMoney(nextScheduledCost.amount, forecast!.result.currency, lang)}` : t("jr.budget.calendarHint")}</small></div></div>
                          <details className="result-details student-explainer"><summary>{t("jr.budget.gapQuestion")}</summary><p>{t("jr.budget.gapAnswer")}</p></details>
                          {budgetData.issues.length > 0 && <div className="result-attention"><strong>{t("jr.budget.beforeRelying")}</strong><ul>{budgetData.issues.map((issue, n) => <li key={`${issue}-${n}`}>{explainCode(issue, lang)}</li>)}</ul></div>}
                          <details className="result-details"><summary>{t("jr.budget.compare")}</summary><div className="backend-scenarios">{(["low", "base", "high"] as const).map((name) => <div key={name}><span>{t(`jr.scenario.${name}` as MessageKey)}</span><strong>{formatMoney(budgetData[name], budgetData.currency, lang)}</strong></div>)}</div><p>{t("jr.budget.remainingBase", { amount: formatMoney(budgetData.remaining_base, budgetData.currency, lang) })}</p></details>
                          <details className="result-details"><summary>{t("jr.budget.assumptions")}</summary>{budgetData.assumptions.length ? <ul>{budgetData.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{t("jr.budget.noAssumptions")}</p>}<p>{t("jr.budget.information", { state: budgetData.complete ? t("jr.budget.complete") : t("jr.budget.incomplete"), gap: budgetData.sufficient ? t("jr.budget.noGap") : t("jr.budget.gapToReview") })}</p>{budgetData.issues.length > 0 && <details><summary>{t("jr.budget.issueCodes")}</summary><ul>{budgetData.issues.map((item) => <li key={item}>{item}</li>)}</ul></details>}</details>
                        </>}
                        {!preview && <button className="primary" disabled={busy || dirty} onClick={calculateBudget}>{t("jr.budget.update")}</button>}
                      </section>
                      {preview && <PreviewWalkthrough scenario={previewScenario} onOpenExpenses={() => { focusCostRef.current = "preview-food"; setStep(1); setShowSteps(false); }} />}
                      {preview ? <details className="preview-calendar-details"><summary>{t("jr.budget.exploreCalendar")}</summary>{paymentCalendar}</details> : paymentCalendar}
                    </>
                  )}
                  {step === 3 && (
                    <>
                      <FundingComparison
                        preview={preview}
                        recommendation={funding}
                        homeCurrency={state?.assets.currency ?? budgetData?.currency}
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
                        <h2>{t("jr.fund.title")}</h2>
                        <p>
                          {t("jr.fund.text")}
                        </p>
                        <details className="funding-add-source">
                          <summary>{t("jr.fund.add")}</summary>
                        <div className="backend-fields">
                          <label>
                            {t("jr.fund.kind")}
                            <select
                              value={sourceKind}
                              onChange={(e) => setSourceKind(e.target.value)}
                            >
                              <option value="family">{t("jr.fund.kind.family")}</option>
                              <option value="scholarship">{t("jr.fund.kind.scholarship")}</option>
                              <option value="external_savings">{t("jr.fund.kind.external_savings")}</option>
                            </select>
                          </label>
                          <label>
                            {t("jr.fund.amount")}
                            <input
                              value={sourceAmount}
                              onChange={(e) => setSourceAmount(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            {t("jr.fund.availableOn")}
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
                          {t("jr.fund.save")}
                        </button>
                        </details>
                        <button
                          className="primary"
                          disabled={preview || busy}
                          onClick={recommend}
                        >
                          {t("jr.fund.recommend")}
                        </button>
                      </section>}
                    </>
                  )}
                  {step === 4 && (
                    preview ? <PreviewApplication application={application} quotes={quotes} selectedQuoteId={quoteId} onBack={() => setStep(3)} /> : <fieldset className="preview-form-lock">
                      <section className="card backend-section">
                        <h2>{application ? t("jr.app.titleExisting") : t("jr.app.titleNew")}</h2>
                        {application && <div className="application-status application-live-status" role="status" tabIndex={-1}><strong>{explainCode(application.status, lang)}</strong><span>{t("jr.app.idLine", { id: application.id, version: application.version })}</span><span>{t("jr.app.assessment", { status: application.assessment?.status ? explainCode(application.assessment.status, lang) : t("jr.app.notAssessed") })}</span></div>}
                        <p>
                          {t("jr.app.text")}
                        </p>
                        <details className="application-group">
                        <summary>{t("jr.app.profile")}</summary>
                        <p>
                          {t("jr.app.profileText")}
                        </p>
                        {profileMonths.map((row, index) => (
                          <div className="backend-fields" key={row.rowKey}>
                            <label>
                              {t("jr.app.month")}
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
                                {t(`jr.app.field.${field}` as MessageKey)}
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
                              {t("jr.app.removeMonth")}
                            </button>
                          </div>
                        ))}
                        <button
                          className="secondary"
                          onClick={() =>
                            setProfileMonths([
                              ...profileMonths,
                              {
                                rowKey: crypto.randomUUID(),
                                month: "",
                                income: null,
                                living_expenses: null,
                                existing_repayments: null,
                              },
                            ])
                          }
                        >
                          {t("jr.app.addMonth")}
                        </button>
                        <button
                          className="secondary"
                          disabled={preview || busy || profileMonths.some((x) => !x.month)}
                          onClick={saveProfile}
                        >
                          {t("jr.app.saveProfile")}
                        </button>
                        </details>
                        <details className="application-group" open={!quotes.length}>
                        <summary>{t("jr.app.quote")}</summary>
                        <div className="backend-fields">
                          <label>
                            {t("jr.app.principal")}
                            <input
                              value={principal}
                              onChange={(e) => setPrincipal(e.target.value)}
                              inputMode="decimal"
                            />
                          </label>
                          <label>
                            {t("jr.app.rate")}
                            <input
                              value={rate}
                              onChange={(e) => setRate(e.target.value)}
                              placeholder="0.12"
                            />
                          </label>
                          <label>
                            {t("jr.app.fees")}
                            <input
                              value={fees}
                              onChange={(e) => setFees(e.target.value)}
                            />
                          </label>
                          <label>
                            {t("jr.app.months")}
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={months}
                              onChange={(e) => setMonths(e.target.value)}
                            />
                          </label>
                          <label>
                            {t("jr.app.firstDue")}
                            <input
                              type="date"
                              value={firstDue}
                              onChange={(e) => setFirstDue(e.target.value)}
                            />
                          </label>
                        </div>
                        <button
                          className="secondary"
                          disabled={preview || busy || !principal || !rate || !firstDue || !/^[1-9]\d*$/.test(months)}
                          onClick={addQuote}
                        >
                          {t("jr.app.createQuote")}
                        </button>
                        </details>
                        <h3>{t("jr.app.review")}</h3>
                        <label>
                          {t("jr.app.selectQuote")}
                          <select
                            value={quoteId}
                            onChange={(e) => setQuoteId(e.target.value)}
                          >
                            <option value="">{t("jr.app.select")}</option>
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
                              <strong>{t("jr.app.selected")}</strong>
                              <p>
                                {t("jr.app.terms", { principal: money(quote.inputs?.principal), rate: String(quote.inputs?.annual_rate ?? t("jr.unknown")), fees: money(quote.inputs?.fees), months: String(quote.inputs?.months ?? t("jr.unknown")) })}
                              </p>
                              <p>
                                {t("jr.app.proceeds", { net: formatMoney(quote.result?.net_proceeds, undefined, lang), total: formatMoney(quote.result?.total_repayment, undefined, lang) })}
                              </p>
                              {Array.isArray(quote.result?.repayments) && (
                                <details>
                                  <summary>{t("jr.app.schedule")}</summary>
                                  <ul>
                                    {(
                                      quote.result.repayments as Array<
                                        Record<string, unknown>
                                      >
                                    ).map((payment, index) => (
                                      <li key={index}>
                                        {String(payment.due_date ?? "")}:{" "}
                                        {formatMoney(payment.amount ?? payment.payment, undefined, lang)}
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
                          {t("jr.app.createDraft")}
                        </button>
                        {application && (
                          <>
                            {application.assessment && (
                              <details>
                                <summary>{t("jr.app.viewAssessment")}</summary>
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
                              {t("jr.app.submit")}
                            </button>
                            <button
                              className="secondary"
                              disabled={preview || busy}
                              onClick={reloadApplication}
                            >
                              {t("jr.app.reload")}
                            </button>
                          </>
                        )}
                      </section>
                    </fieldset>
                  )}
                  {preview && step >= 1 && step < 4 && <div className="preview-next-step"><span>{t("jr.tour.noSave")}</span><button className="primary" onClick={() => { setStep(step + 1); setShowSteps(false); }}>{t("jr.tour.continue", { name: steps[step + 1] })} <span aria-hidden="true">→</span></button></div>}
                </>
              )}
            </>
          )}
        </>}
        </main>
        <footer>
          {t("jr.footer")}
          <span>{t("jr.footerNote")}</span>
        </footer>
      </div>
    </div>
  );
}
