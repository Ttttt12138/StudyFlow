import { CardSummary } from "./CardSummary";
import { useStudyLife } from "./useStudyLife";
import { UpcomingReminders, StudyLifePanel } from "./StudyLife";
import { CardDetail } from "./CardDetail";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { JourneyGuide } from "./JourneyGuide";
import { journeyPhase } from "./journeyPhase";
import { asksForMonthlySpending } from "./monthly";
import { ToolSlot, useWorkspace, useToolRefresh, useClearWhenHidden, useToolActive } from "../workspace/context";
import { FocusDialog } from "../workspace/FocusDialog";
import { PanelAlert, PanelEmpty, PanelFacts, PanelHero, PanelInfo, PanelPager, ToolPanel } from "../workspace/ToolPanel";
import { LevelBar, StackBar } from "../workspace/PanelCharts";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useModuleLink } from "../services/ModuleNav";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { CardView, type CardActions } from "./cards";
import { DISPLAY_CURRENCIES, DisplayContext, PREVIEW_RATES, cash, displayCurrency, useShow, type DisplayCurrency, type DisplayRates } from "./currency";
import { day, money, pick } from "./format";
import { CompareHistory } from "./PricePanels";
import { AssessmentPanel } from "./AssessmentPanel";
import { MoneyConfirm } from "./MoneyConfirm";
import { createPlanPreview, type PreviewStage } from "./preview";
import type { Conversation, ConversationSummary, FamilyLink, InSchool, PlanHistory, Role, SchoolBrief, Turn } from "./types";
import { Markdown } from "./Markdown";
import "./plan.css";
import "./price.css";

const CATEGORIES = ["food", "transport", "housing", "study", "shopping", "fun", "health", "other"] as const;

// Price questions first; the later stages keep their own short lists.
const SUGGESTIONS: Record<"en" | "zh", Record<"consult" | "preparing" | "enrolled", string[]>> = {
  zh: {
    consult: ["朱拉隆功读4年一共多少钱？", "比较曼彻斯特和墨尔本", "哪所学校总价最低？", "有哪些学校？"],
    preparing: ["学校宿舍和周边环境怎么样？", "出发准备", "首月预算"],
    enrolled: ["学校周边有什么好吃好玩的？", "这个月花了多少？", "接下来有哪些账单？", "今天午饭花了120泰铢"],
  },
  en: {
    consult: ["What does 4 years at Chulalongkorn cost in total?", "Compare Manchester and Melbourne", "Which school has the lowest total?", "Which schools are there?"],
    preparing: ["What are the school's dorms and surroundings like?", "Departure preparation", "First-month budget"],
    enrolled: ["What food and fun is near my school?", "How much have I spent this month?", "Which bills are due?", "I spent 120 THB on lunch today"],
  },
};

/** Local day and time labels for the conversation timeline; missing or invalid timestamps show nothing. */
function turnStamp(value: string | undefined, lang: string) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return { day: date.toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" }),
    time: date.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: false }) };
}

function describe(error: unknown, t: (key: MessageKey) => string) {
  if (error instanceof WalletApiError) {
    if (error.status === 429) return t("plan.err.throttled");
    return error.message;
  }
  return error instanceof Error ? error.message : t("plan.err.generic");
}

/** THB / CNY / USD: every price in the conversation and the panels follows this choice. */
function CurrencySwitch({ value, onChange, disabled }: { value: DisplayCurrency; onChange: (value: DisplayCurrency) => void; disabled: boolean }) {
  const { t } = useI18n();
  return <div className="currency-switch" role="group" aria-label={t("price.currency")}>
    {DISPLAY_CURRENCIES.map(code => <button key={code} type="button" aria-pressed={value === code} disabled={disabled}
      onClick={() => onChange(code)}>{t(`price.cur.${code}` as MessageKey)}</button>)}
  </div>;
}

/** Catalog schools priced over the whole course, cheapest first, as the first screen's starting points. */
function SampleTotals({ schools, ask }: { schools: SchoolBrief[]; ask: (text: string) => void }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const rates = useMemo(() => schools.filter(s => s.total), [schools]);
  if (rates.length < 2) return null;
  return <section className="plan-samples" aria-labelledby="plan-samples-title">
    <h2 id="plan-samples-title">{t("price.samples")}</h2>
    <ul>{rates.slice(0, 3).map((school, index) => {
      const name = pick(school.name, lang);
      const years = school.years ?? school.duration_years;
      return <li key={school.key}><button type="button" onClick={() => ask(t("price.askTotal", { name, years }))}>
        <span>{name} · {t("price.years", { n: years })}</span>
        <strong>{show(school.total, school.currency, lang).main}</strong>
        {index === 0 ? <em className="price-tag">{t("price.cheapestOf", { n: rates.length })}</em> : <small>{cash(school.total, school.currency, lang)}</small>}
      </button></li>;
    })}</ul>
  </section>;
}

export function PlanApp({ preview, initialStage = "plan" }: { account?: string; preview: boolean; initialStage?: PreviewStage; onExit: () => void }) {
  const { lang, t } = useI18n();
  const workspace = useWorkspace();
  const signInUrl = `/auth?next=${encodeURIComponent(window.location.href)}`;
  const [stage] = useState<PreviewStage>(initialStage);
  const client = useMemo<WalletClient>(() => preview ? createPlanPreview(lang, stage) : new SessionWalletClient(), [preview, lang, stage]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [inSchool, setInSchool] = useState<InSchool | null>(null);
  const [family, setFamily] = useState<FamilyLink[]>([]);
  const [rates, setRates] = useState<DisplayRates | null>(preview ? PREVIEW_RATES : null);
  const [currency, setCurrency] = useState<DisplayCurrency>("THB");
  const [schools, setSchools] = useState<SchoolBrief[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [history, setHistory] = useState<PlanHistory | null>(null);
  const [replacing, setReplacing] = useState<{ key: string; name: string; years?: number } | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);

  const fail = useCallback((err: unknown) => {
    // No session (401), or Django's CSRF/authentication 403 that carries no error code.
    if (err instanceof WalletApiError && (err.status === 401 || (err.status === 403 && !err.details?.code))) setSignedOut(true);
    else setError(describe(err, t));
  }, [t]);

  const loadSide = useCallback(async () => {
    const [school, links, past] = await Promise.allSettled([client.get<InSchool>("planning/in-school/"), client.get<FamilyLink[]>("planning/family-links/"),
      client.get<PlanHistory>("planning/history/")]);
    if (school.status === "fulfilled") setInSchool(school.value);
    if (links.status === "fulfilled") setFamily(links.value);
    if (past.status === "fulfilled") setHistory(past.value);
    if (school.status === "rejected" || links.status === "rejected") throw new Error(t("ws.stale"));
  }, [client, t]);

  const load = useCallback(async (fresh = false) => {
    setError(""); setSignedOut(false); setFailed(false);
    try {
      const rows = fresh ? [] : await client.get<ConversationSummary[]>("agent/conversations/");
      if (!Array.isArray(rows)) throw new Error(t("plan.err.generic"));
      const opened = rows[0]
        ? await client.post<Conversation>(`agent/conversations/${rows[0].id}/open/`, {}, `open:${rows[0].id}:${Date.now()}`)
        : await client.post<Conversation>("agent/conversations/", { locale: lang }, `start:${Date.now()}`);
      if (!opened?.profile || !Array.isArray(opened.turns)) throw new Error(t("plan.err.generic"));
      setConversation(opened);
      setCurrency(displayCurrency(opened.profile.home_currency));
      await loadSide();
    } catch (err) { setFailed(true); fail(err); }
  }, [client, lang, loadSide, fail]);

  useEffect(() => { setConversation(null); void load(); }, [load]);
  useEffect(() => {
    const fresh = () => { if (!preview) void load(true); };
    window.addEventListener("studyflow:new-conversation", fresh);
    return () => window.removeEventListener("studyflow:new-conversation", fresh);
  }, [load, preview]);
  // Reference rates and the catalog's course totals; prices still show in the school's currency without them.
  useEffect(() => {
    if (preview) return;
    let alive = true;
    client.get<DisplayRates>("planning/rates/").then(value => { if (alive && value?.thb_per_unit) setRates(value); }).catch(() => undefined);
    client.get<{ schools: SchoolBrief[] }>("planning/schools/").then(value => {
      if (!alive || !Array.isArray(value?.schools)) return;
      const base = (s: SchoolBrief) => Number(s.total_converted?.currency === "THB" ? s.total_converted.amount : NaN);
      setSchools([...value.schools].filter(s => s.total).sort((a, b) => (base(a) || Number(a.total)) - (base(b) || Number(b.total))));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [client, preview]);
  // The message list scrolls on its own; keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [conversation?.turns.length, sending]);

  async function refresh() {
    if (!conversation) return;
    const fresh = await client.get<Conversation>(`agent/conversations/${conversation.id}/`);
    setConversation(fresh);
    await loadSide();
  }

  async function chooseCurrency(next: DisplayCurrency) {
    const previous = currency;
    setCurrency(next);
    if (preview) return;
    try { await client.post("planning/profile/", { home_currency: next }, `currency:${next}:${Date.now()}`); }
    catch (err) { setCurrency(previous); fail(err); }
  }

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !conversation || sending) return;
    if (preview) { setNotice(t("plan.preview.readOnly")); return; }
    setSending(true); setError(""); setNotice("");
    const pending: Turn = { id: `local-${Date.now()}`, kind: "user", goal: trimmed, final_answer: "", status: "RUNNING",
      error_code: "", created_at: new Date().toISOString(), cards: [], pending_actions: [] };
    setConversation({ ...conversation, turns: [...conversation.turns, pending] });
    setDraft("");
    try {
      const completed = await client.post<Turn>(`agent/conversations/${conversation.id}/messages/`, { text: trimmed }, `message:${conversation.id}:${pending.id}`);
      setConversation(current => current && ({ ...current, turns: current.turns.map(turn => turn.id === pending.id ? completed : turn) }));
      if (completed.cards.some(card => card.type === "plan" || card.type === "loan")) workspace?.open({ kind: "funding" });
      await refresh().catch(() => setError(t("ws.stale")));
      if (completed.status === "COMPLETED" && asksForMonthlySpending(trimmed) && conversation.plan?.status === "ENROLLED") workspace?.open({ kind: "life" });
      if (completed.status === "COMPLETED" && /提醒我|待办|我的提醒|有哪些提醒|remind me|my tasks|my reminders|add (a )?task/i.test(trimmed)) workspace?.open({ kind: "life" });
    } catch (err) {
      setConversation(conversation);
      setDraft(trimmed);
      fail(err);
    } finally { setSending(false); }
  }

  function choose(key: string, name: string, years?: number) {
    const current = conversation?.plan;
    // Choosing another school reopens a confirmed plan, so that one asks first.
    if (current?.status === "CONFIRMED" && current.school_key !== key) { setReplacing({ key, name, years }); return; }
    void commitChoice(key, name, years);
  }

  async function commitChoice(key: string, name: string, years?: number) {
    setReplacing(null);
    if (!conversation || sending) return;
    if (preview) { setNotice(t("plan.preview.readOnly")); return; }
    setSending(true); setError(""); setNotice("");
    const pending: Turn = { id: `local-${Date.now()}`, kind: "user", goal: `${t("plan.card.choose")}：${name}`, final_answer: "",
      status: "RUNNING", error_code: "", created_at: new Date().toISOString(), cards: [], pending_actions: [] };
    setConversation({ ...conversation, turns: [...conversation.turns, pending] });
    try {
      const chosen = await client.post<Turn>(`agent/conversations/${conversation.id}/choose/`,
        { school_key: key, ...(years ? { years } : {}) }, `choose:${conversation.id}:${pending.id}`);
      setConversation(current => current && ({ ...current, turns: current.turns.map(turn => turn.id === pending.id ? chosen : turn) }));
      workspace?.open({ kind: "funding" });
      await refresh().catch(() => setError(t("ws.stale")));
    } catch (err) {
      setConversation(conversation);
      fail(err);
    } finally { setSending(false); }
  }

  async function openDraft(id: string) {
    if (preview || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await client.post(`planning/drafts/${id}/open/`, {}, `draft-open:${id}:${Date.now()}`);
      await refresh();
      workspace?.open({ kind: "funding" });
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  async function decide(pendingId: string, verb: "confirm" | "reject") {
    if (preview) { setNotice(t("plan.preview.readOnly")); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await client.post(`agent/pending-actions/${pendingId}/${verb}/`, {}, `plan-${verb}:${pendingId}`);
      if (verb === "confirm") setNotice(t("plan.confirm.done"));
      setConfirmId(null);
      await refresh().catch(() => setError(t("ws.stale")));
    } catch (err) { fail(err); } finally { setBusy(false); }
  }

  const pendingStatus = useCallback((id: string) => {
    for (const turn of conversation?.turns ?? []) {
      const found = turn.pending_actions.find((item) => item.id === id);
      if (found) return found.status;
    }
    return "PENDING";
  }, [conversation]);

  const actions: CardActions = {
    ask: (text) => void ask(text), choose, confirm: (id) => setConfirmId(id), reject: (id) => void decide(id, "reject"),
    busy: busy || sending, readOnly: preview, pendingStatus,
  };

  const plan = conversation?.plan ?? null;
  const life = useStudyLife(client, conversation ? `${conversation.id}:${plan?.status}:${conversation.turns.length}` : "", preview);
  const phase = journeyPhase(plan?.status ?? null);
  const gap = !!plan && plan.status === "DRAFT" && Number(plan.gap) > 0;
  const report = workspace?.reportPlan;
  useEffect(() => {
    if (!report) return;
    // No plan to read (signed out, or the planner could not load): only the price tools are offered.
    if (signedOut || failed && !conversation) report({ status: null, gap: false });
    else if (conversation) report({ status: plan?.status ?? null, gap, history: preview ? null : history, openDraft: id => void openDraft(id) });
  }, [report, signedOut, failed, conversation, plan?.status, gap, history]);
  const suggestions = SUGGESTIONS[lang][phase === 2 ? "enrolled" : phase === 1 ? "preparing" : "consult"];
  const enrollment = conversation?.turns.flatMap(turn => turn.pending_actions).find(action =>
    action.action === "plan.enroll" && action.status === "PENDING" && new Date(action.expires_at).getTime() > Date.now());
  const stale = useToolRefresh(refresh);
  const cardRows = conversation?.turns.flatMap(turn => turn.cards.map((card, index) => ({ card, id: `${turn.id}:${index}` }))) ?? [];
  // A card opened from the sidebar history may come from another conversation of this account.
  const selectedCard = [...cardRows, ...(history?.prices ?? [])].find(item => item.id === workspace?.target?.cardId)?.card;
  const confirming = conversation?.turns.flatMap(turn => turn.cards).find(card => card.type === "confirmation" && card.pending_action_id === confirmId);
  // Transfers and currency exchange proposed in this conversation are confirmed here with the password, not in a separate assistant.
  const moneyAction = confirming && confirming.type === "confirmation" && !confirming.action.startsWith("plan.")
    ? conversation?.turns.flatMap(turn => turn.pending_actions).find(action => action.id === confirmId) : undefined;
  // First screen: nothing asked yet, so the page leads with the price question instead of an empty chat.
  const fresh = !!conversation && !conversation.turns.some(turn => turn.goal) && phase === 0;
  const placeholder = t(phase === 1 ? "plan.journey.preparingPlaceholder" : phase === 2 ? "plan.journey.dailyPlaceholder" : "plan.composer.placeholder");

  // Suggested questions sit above the input, so they read as the next step before typing.
  const composer = <form className={`plan-composer${fresh ? " is-hero" : ""}`} onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
    <div className="agent-suggestions" aria-label={t("plan.composer.suggestions")}>
      {suggestions.map((text) => <button type="button" key={text} className="chip" disabled={sending || !conversation}
        onClick={() => void ask(text)}>{text}</button>)}
    </div>
    <div className="plan-input-wrap"><label className="service-field"><span className="sr-only">{t("plan.composer.label")}</span>
      <textarea value={draft} rows={fresh ? 2 : 1} maxLength={2000} placeholder={placeholder} disabled={sending || preview}
        aria-label={t("plan.composer.label")} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } }} />
    </label>
      <div className="plan-input-foot">
        <CurrencySwitch value={currency} onChange={value => void chooseCurrency(value)} disabled={sending || !conversation} />
        <button type="submit" className="primary plan-send" aria-label={sending ? t("plan.composer.sending") : t("plan.composer.send")}
          disabled={sending || preview || !draft.trim()}><ArrowUp size={20} aria-hidden="true" /></button>
      </div>
    </div>
  </form>;

  return <DisplayContext.Provider value={{ currency, rates }}><div className={`plan-app${fresh ? " is-fresh" : ""}`}>
    {stale}
    {error && <p className="error service-alert" role="alert">{error} <button className="chip" onClick={() => void (conversation ? refresh() : load()).catch(fail)}>{t("common.refresh")}</button></p>}
    {notice && <p className="service-notice" role="status">{notice}</p>}
    {signedOut && !preview && <section className="plan-welcome" aria-labelledby="plan-welcome-title">
      <h2 id="plan-welcome-title" className="plan-hero-title">{t("price.heroTitle")}</h2>
      <p>{t("plan.welcome.text")}</p>
      <div className="service-actions">
        <a className="primary" href={signInUrl}>{t("common.signIn")}</a>
        <a className="secondary" href="/?plan=preview">{t("plan.welcome.preview")}</a>
        <a className="secondary" href="/?tour=1">{t("jr.welcome.tour")}</a>
      </div>
    </section>}
    {!signedOut && <section className="plan-chat" id="plan-chat" aria-labelledby="plan-chat-title">
      {fresh ? <div className="plan-hero">
        <h2 id="plan-chat-title" className="plan-hero-title">{t("price.heroTitle")}</h2>
        <p>{t("price.heroText")}</p>
        {composer}
        <SampleTotals schools={schools} ask={text => void ask(text)} />
      </div> : <>
        <h2 id="plan-chat-title" className="sr-only">{t(`plan.intro.name.${phase}`)}</h2>
        {plan && <UpcomingReminders control={life} />}
        {!conversation ? <p className="service-muted" role="status">{t("plan.loading")}</p> : <ol className="plan-messages" aria-live="polite" ref={listRef}>
          {conversation.turns.map((turn, index) => { const stamp = turnStamp(turn.created_at, lang);
            const newDay = stamp && stamp.day !== turnStamp(conversation.turns[index - 1]?.created_at, lang)?.day;
            return <li key={turn.id} className="plan-turn">
            {newDay && <p className="plan-date"><time dateTime={turn.created_at}>{stamp.day}</time></p>}
            {turn.goal && <div className="plan-bubble plan-bubble-user"><span className="plan-who sr-only">{t("plan.you")}</span><p>{turn.goal}</p>
              {stamp && <time className="plan-time" dateTime={turn.created_at}>{stamp.time}</time>}</div>}
            {(turn.final_answer || turn.cards.length > 0) && <div className="plan-bubble plan-bubble-agent">
              <span className="plan-who"><span className="plan-avatar" aria-hidden="true"><Sparkle size={16} weight="fill" /></span> StudyFlow
                {stamp && <time className="plan-time" dateTime={turn.created_at}>{stamp.time}</time>}</span>
              {turn.final_answer && <Markdown className="plan-answer" text={turn.final_answer} />}
              {turn.cards.map((card, index) => <CardSummary key={index} id={`${turn.id}:${index}`} card={card} actions={actions} />)}
            </div>}
            {turn.status === "RUNNING" && <div className="plan-bubble plan-bubble-agent plan-thinking" role="status">{t("plan.composer.sending")}</div>}
          </li>; })}
          {plan && <JourneyGuide plan={plan} phase={phase} pending={enrollment} life={life.data} ask={text => void ask(text)}
            confirm={setConfirmId} disabled={preview || busy || sending} />}
        </ol>}
        {composer}
      </>}
    </section>}
    <ToolSlot kind="plan"><PlanSummary plan={plan} onRefresh={refresh} /></ToolSlot>
    <ToolSlot kind="life"><StudyLifePanel control={life} preview={preview} ask={text => void ask(text)} /></ToolSlot>
    <ToolSlot kind="compare"><CompareHistory rows={cardRows} /></ToolSlot>
    <ToolSlot kind="funding"><AssessmentPanel plan={plan} client={client} preview={preview} onConfirmed={() => refresh().catch(() => setError(t("ws.stale")))} /></ToolSlot>
    <ToolSlot kind="family-links"><FamilyPanel links={family} role={conversation?.profile.role || null} client={client} preview={preview}
      onRefresh={loadSide}
      onLinked={async () => { setNotice(t("plan.family.linked")); await loadSide(); }} onError={fail} /></ToolSlot>
    <ToolSlot kind="card"><CardDetail key={workspace?.target?.cardId} card={selectedCard ?? null} actions={actions} /></ToolSlot>
    {confirmId && moneyAction && <MoneyConfirm action={moneyAction} client={client} onClose={() => setConfirmId(null)}
      onDone={async message => { setConfirmId(null); setNotice(message); await refresh().catch(() => setError(t("ws.stale"))); }} />}
    {confirmId && confirming && !moneyAction && <FocusDialog title={t("ws.confirm")} onClose={() => setConfirmId(null)} busy={busy}>
      <CardView card={confirming} actions={{ ...actions, confirm: id => void decide(id, "confirm") }} />
      <button className="secondary" disabled={busy} onClick={() => setConfirmId(null)}>{t("common.cancel")}</button>
    </FocusDialog>}
    {replacing && <FocusDialog title={t("plan.choose.replaceTitle")} onClose={() => setReplacing(null)} busy={sending}>
      <h2>{t("plan.choose.replaceTitle")}</h2>
      <p>{t("plan.choose.replaceBody", { name: replacing.name })}</p>
      <button className="primary" disabled={sending} onClick={() => void commitChoice(replacing.key, replacing.name, replacing.years)}>{t("plan.choose.replace")}</button>
      <button className="secondary" disabled={sending} onClick={() => setReplacing(null)}>{t("common.cancel")}</button>
    </FocusDialog>}
  </div></DisplayContext.Provider>;

}

function PlanSummary({ plan, onRefresh }: { plan: Conversation["plan"]; onRefresh: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const workspace = useWorkspace();
  const stale = useToolRefresh(onRefresh);
  const show = useShow();
  const cur = plan?.currency ?? plan?.school?.currency ?? "";
  const loan = plan?.loan;
  // Shares of the plan's own total and gap (same currency); the loan share is shown only when it is in that currency too.
  const total = Number(plan?.total ?? 0), gap = Math.max(0, Number(plan?.gap ?? 0));
  const coverage = plan && total > 0 && plan.gap != null && gap <= total ? { covered: total - gap, gap,
    loanShare: loan && gap > 0 && loan.currency === cur ? Math.min(100, Math.round(Number(loan.principal) / gap * 100)) : null } : null;
  return <section className="plan-tool" id="plan-summary" aria-labelledby="plan-summary-title">
    <ToolPanel label={t("plan.side.plan")} notices={stale}
      footer={plan && <><span className="panel-footer-note"><PanelInfo>{t("status.estimateNote")}</PanelInfo></span>
        <button type="button" className="secondary" onClick={() => workspace?.open({ kind: plan.status === "ENROLLED" ? "loans" : "funding" })}>{t(plan.status === "ENROLLED" ? "side.loans" : "side.funding")}</button></>}>
      <div className="panel-card-head"><h3 id="plan-summary-title">{plan ? pick(plan.school?.name, lang) || plan.school_key : t("plan.side.plan")}</h3>
        {plan && <span className={`status-chip status-${plan.status.toLowerCase()}`}>{t(`plan.plan.status.${plan.status}`)}</span>}</div>
      {plan ? <>
        <PanelHero label={t("plan.plan.total")} value={show(plan.total, cur, lang).main}>
          <span className="panel-muted">{t("plan.plan.years")} {plan.years} · {t("plan.plan.start")} {day(plan.start_date, lang)}</span></PanelHero>
        {coverage && <div className="fx-figure"><div className="panel-section-title">{t("plan.coverage")}</div>
          <StackBar label={t("plan.coverage")} parts={[
            { key: "covered", value: coverage.covered, tone: "mint", label: t("plan.covered", { amount: money(coverage.covered, cur, lang) }) },
            { key: "gap", value: coverage.gap, tone: "gold", label: t("plan.gapPart", { amount: money(coverage.gap, cur, lang) }) }]} />
          {coverage.loanShare !== null && <small className="panel-muted">{t("plan.loanCovers", { share: coverage.loanShare })}</small>}</div>}
        <div className="panel-grid-2">
          <div className="panel-tile"><span>{t("plan.plan.funds")}</span>
            <strong>{plan.available_funds ? money(plan.available_funds, plan.funds_currency ?? "", lang) : t("plan.plan.noFunds")}</strong></div>
          {plan.gap != null && <div className="panel-tile"><span>{t("plan.plan.gap")}</span>
            <strong className={Number(plan.gap) > 0 ? "plan-gap" : ""}>{show(plan.gap, cur, lang).main}</strong></div>}
        </div>
        {loan && <>
          <h4 className="panel-muted">{t("plan.loan.title")}</h4>
          <PanelFacts items={[[t("plan.loan.principal"), money(loan.principal, loan.currency, lang)], [t("plan.loan.months"), t("plan.loan.monthsValue", { months: loan.months })],
            [t("plan.loan.monthly"), money(loan.monthly_payment, loan.currency, lang)], [t("plan.loan.total"), money(loan.total_repayment, loan.currency, lang)]]} />
        </>}
      </> : <PanelEmpty title={t("plan.plan.none")} />}
    </ToolPanel>
  </section>;
}


function FamilyPanel({ links, role, client, preview, onLinked, onError, onRefresh }: { links: FamilyLink[]; role: Role | null; client: WalletClient;
  preview: boolean; onLinked: () => Promise<void>; onError: (err: unknown) => void; onRefresh: () => Promise<void> }) {
  const { lang, t } = useI18n();
  const [token, setToken] = useState("");
  useClearWhenHidden(() => setToken(""));
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState("");
  const stale = useToolRefresh(onRefresh);

  async function link(event: React.FormEvent) {
    event.preventDefault();
    if (preview || !token.trim()) return;
    setBusy(true); setPanelError("");
    try {
      await client.post("planning/family-links/", {}, `family-link:${token.trim()}`, { "X-Sponsor-Token": token.trim() });
      setToken("");
      await onLinked();
    } catch (err) { setPanelError(describe(err, t)); onError(err); } finally { setBusy(false); }
  }

  const [index, setIndex] = useState(0);
  const item = links[Math.min(index, links.length - 1)];
  const school = item?.in_school?.enrolled ? item.in_school : null;
  const linkForm = role !== "student" && <form id="plan-family-form" className="panel-view" onSubmit={link}>
    <div className="panel-section-title">{t("plan.family.linkTitle")}<PanelInfo>{t("plan.family.linkText")}</PanelInfo></div>
    <label className="panel-form" style={{ gridTemplateColumns: "1fr" }}><span>{t("plan.family.token")}</span><input data-sensitive="true" value={token} maxLength={64} disabled={preview || busy}
      autoComplete="off" onChange={(event) => setToken(event.target.value.trim())} /></label>
  </form>;
  return <section className="plan-tool" id="plan-family" aria-labelledby="plan-family-title">
    <ToolPanel label={t("plan.family.title")} notices={(stale || panelError) && <>{stale}{panelError && <PanelAlert message={panelError} />}</>}
      footer={role !== "student" && <button type="submit" form="plan-family-form" className="primary" disabled={preview || busy || token.length !== 64}>{t("plan.family.link")}</button>}>
      <div className="panel-card-head"><h2 id="plan-family-title">{t("fl.linked")}</h2>
        <PanelPager index={Math.min(index, links.length - 1)} count={links.length} onChange={setIndex} label={t("fl.linked")} /></div>
      {!item ? <PanelEmpty icon={UsersThree} title={t("fl.none")} text={t("plan.family.none")} /> : <article className="panel-view plan-family">
        <div className="panel-row"><strong>{t(item.relation === "child" ? "plan.family.child" : "plan.family.parent", { account: item.account })}</strong>
          {item.plan && <span className={`status-chip status-${item.plan.status.toLowerCase()}`}>{t(`plan.plan.status.${item.plan.status}`)}</span>}</div>
        {item.plan && <p className="panel-muted">{t("plan.family.childPlan", { school: pick(item.plan.school?.name, lang) || item.plan.school_key,
          status: t(`plan.plan.status.${item.plan.status}`) })}</p>}
        {school && <>
          <PanelHero label={t("plan.spending.title", { month: school.spending.month })} value={money(school.spending.spent, school.spending.currency, lang)}>
            <LevelBar value={Number(school.spending.budget)} max={Number(school.spending.budget)} after={Math.min(Number(school.spending.spent), Number(school.spending.budget))}
              tone={school.spending.over_budget ? "warn" : undefined} />
            <span className="panel-muted">{t("plan.family.childSpending", { month: school.spending.month, spent: money(school.spending.spent, school.spending.currency, lang),
              budget: money(school.spending.budget, school.spending.currency, lang) })}</span></PanelHero>
          {school.upcoming_bills[0] && <div className="panel-timeline">
            <time dateTime={school.upcoming_bills[0].due_date}><strong>{Number(school.upcoming_bills[0].due_date.slice(8, 10))}</strong>
              <span>{new Date(`${school.upcoming_bills[0].due_date}T00:00:00`).toLocaleDateString(lang, { month: "short" })}</span></time>
            <div><span className="panel-muted">{pick(school.upcoming_bills[0].label, lang)}</span>
              <strong>{money(school.upcoming_bills[0].amount, school.upcoming_bills[0].currency, lang)}</strong></div></div>}
          <p className="panel-note">{t("plan.family.private")}</p>
        </>}
      </article>}
      {linkForm}
    </ToolPanel>
  </section>;
}
