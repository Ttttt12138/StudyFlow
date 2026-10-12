import { CardSummary } from "./CardSummary";
import { JourneyGuide } from "./JourneyGuide";
import { JourneyIntro } from "./JourneyIntro";
import { journeyPhase } from "./journeyPhase";
import { MonthlySpending } from "./MonthlySpending";
import { asksForMonthlySpending } from "./monthly";
import { ToolSlot, useWorkspace, useToolRefresh, useClearWhenHidden, useToolActive } from "../workspace/context";
import { FocusDialog } from "../workspace/FocusDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { ServiceShell } from "../services/ServiceShell";
import { useModuleLink } from "../services/ModuleNav";
import { SessionWalletClient, WalletApiError, type WalletClient } from "../wallet/client";
import { Bills, CardView, LoanFacts, PlanFacts, SpendingFacts, type CardActions } from "./cards";
import { money, pick } from "./format";
import { createPlanPreview, type PreviewStage } from "./preview";
import type { Bill, Conversation, ConversationSummary, FamilyLink, InSchool, Role, Turn } from "./types";
import "./plan.css";

const CATEGORIES = ["food", "transport", "housing", "study", "shopping", "fun", "health", "other"] as const;
const SUGGESTIONS: Record<"en" | "zh", Record<Role | "none" | "preparing" | "enrolled", string[]>> = {
  zh: {
    none: ["我是家长", "我是学生"],
    parent: ["有哪些学校？", "朱拉隆功读4年全部费用多少？", "比较曼彻斯特和墨尔本", "我们有存款30万人民币，就选朱拉隆功", "帮我试算贷款，分48个月"],
    student: ["有哪些学校？", "早稻田周边有什么好吃好玩的？", "新国立的校内设施怎么样？", "比较朱拉隆功和玛希隆"],
    preparing: ["学校宿舍和周边环境怎么样？", "出发准备", "首月预算"],
    enrolled: ["学校周边有什么好吃好玩的？", "这个月花了多少？", "接下来有哪些账单？", "今天午饭花了120泰铢"],
  },
  en: {
    none: ["I'm a parent", "I'm a student"],
    parent: ["Which schools are there?", "What does 4 years at Chulalongkorn cost in total?", "Compare Manchester and Melbourne",
      "We have savings of 300000 CNY, choose Chulalongkorn", "Simulate a loan over 48 months"],
    student: ["Which schools are there?", "What food and fun is near Waseda?", "What are NUS campus facilities like?",
      "Compare Chulalongkorn and Mahidol"],
    preparing: ["What are the school's dorms and surroundings like?", "Departure preparation", "First-month budget"],
    enrolled: ["What food and fun is near my school?", "How much have I spent this month?", "Which bills are due?", "I spent 120 THB on lunch today"],
  },
};

function describe(error: unknown, t: (key: MessageKey) => string) {
  if (error instanceof WalletApiError) {
    if (error.status === 429) return t("plan.err.throttled");
    return error.message;
  }
  return error instanceof Error ? error.message : t("plan.err.generic");
}

export function PlanApp({ account = "", preview, initialStage = "plan", onExit }: { account?: string; preview: boolean; initialStage?: PreviewStage; onExit: () => void }) {
  const { lang, t } = useI18n();
  const openModule = useModuleLink();
  const workspace = useWorkspace();
  const signInUrl = `/api/auth/login/?next=${encodeURIComponent(window.location.href)}`;
  const [stage, setStage] = useState<PreviewStage>(initialStage);
  const client = useMemo<WalletClient>(() => preview ? createPlanPreview(lang, stage) : new SessionWalletClient(), [preview, lang, stage]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [inSchool, setInSchool] = useState<InSchool | null>(null);
  const [family, setFamily] = useState<FamilyLink[]>([]);
  const [view, setView] = useState<Role | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);

  const fail = useCallback((err: unknown) => {
    // No session (401), or Django's CSRF/authentication 403 that carries no error code.
    if (err instanceof WalletApiError && (err.status === 401 || (err.status === 403 && !err.details?.code))) setSignedOut(true);
    else setError(describe(err, t));
  }, [t]);

  const loadSide = useCallback(async () => {
    const [school, links] = await Promise.allSettled([client.get<InSchool>("planning/in-school/"), client.get<FamilyLink[]>("planning/family-links/")]);
    if (school.status === "fulfilled") setInSchool(school.value);
    if (links.status === "fulfilled") setFamily(links.value);
    if (school.status === "rejected" || links.status === "rejected") throw new Error(t("ws.stale"));
  }, [client, t]);

  const load = useCallback(async (fresh = false) => {
    setError(""); setSignedOut(false);
    try {
      const rows = fresh ? [] : await client.get<ConversationSummary[]>("agent/conversations/");
      if (!Array.isArray(rows)) throw new Error(t("plan.err.generic"));
      const opened = rows[0]
        ? await client.post<Conversation>(`agent/conversations/${rows[0].id}/open/`, {}, `open:${rows[0].id}:${Date.now()}`)
        : await client.post<Conversation>("agent/conversations/", { locale: lang }, `start:${Date.now()}`);
      if (!opened?.profile || !Array.isArray(opened.turns)) throw new Error(t("plan.err.generic"));
      setConversation(opened);
      setView((current) => current ?? opened.profile.role);
      await loadSide();
    } catch (err) { fail(err); }
  }, [client, lang, loadSide, fail]);

  useEffect(() => { setConversation(null); void load(); }, [load]);
  // The message list scrolls on its own; keep the newest message in view.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [conversation?.turns.length, sending]);

  async function refresh() {
    if (!conversation) return;
    const fresh = await client.get<Conversation>(`agent/conversations/${conversation.id}/`);
    setConversation(fresh);
    setView((current) => current ?? fresh.profile.role);
    await loadSide();
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
      await refresh().catch(() => setError(t("ws.stale")));
      if (completed.status === "COMPLETED" && asksForMonthlySpending(trimmed)) workspace?.open({ kind: "spending" });
    } catch (err) {
      setConversation(conversation);
      setDraft(trimmed);
      fail(err);
    } finally { setSending(false); }
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
    ask: (text) => void ask(text), confirm: (id) => setConfirmId(id), reject: (id) => void decide(id, "reject"),
    openAgent: (id) => {
      const turn = conversation?.turns.find(row => row.pending_actions.some(action => action.id === id));
      const pending = turn?.pending_actions.find(action => action.id === id);
      if (pending) workspace?.open({ kind: "agent", sessionId: pending.session || turn?.id, pendingId: id });
    }, busy: busy || sending, readOnly: preview, pendingStatus,
  };

  const plan = conversation?.plan ?? null;
  const enrolled = plan?.status === "ENROLLED";
  const suggestions = SUGGESTIONS[lang][enrolled ? "enrolled" : plan?.status === "CONFIRMED" ? "preparing" : view ?? conversation?.profile.role ?? "none"];
  const enrollment = conversation?.turns.flatMap(turn => turn.pending_actions).find(action =>
    action.action === "plan.enroll" && action.status === "PENDING" && new Date(action.expires_at).getTime() > Date.now());
  const stale = useToolRefresh(refresh);
  const selectedCard = conversation?.turns.flatMap(turn => turn.cards.map((card, index) => ({ card, id: `${turn.id}:${index}` })))
    .find(item => item.id === workspace?.target?.cardId)?.card;
  const confirming = conversation?.turns.flatMap(turn => turn.cards).find(card => card.type === "confirmation" && card.pending_action_id === confirmId);
  const pendingCount = conversation?.turns.flatMap(turn => turn.pending_actions).filter(action => action.status === "PENDING" && new Date(action.expires_at).getTime() > Date.now()).length ?? 0;
  return <div className="plan-app">
    <div className="workspace-plan-status">
      <strong>{plan ? pick(plan.school?.name, lang) || plan.school_key : t("ws.noSchool")}</strong>
      <JourneyIntro account={account} phase={conversation && !signedOut ? journeyPhase(plan?.status ?? null) : undefined}
        blocked={busy || sending || !!confirmId || !!draft || signedOut} preview={preview} />
      <span>{t("ws.pending", { n: pendingCount })}</span>
      <button className="chip" onClick={() => workspace?.open({ kind: "plan" })}>{t("ws.plan")}</button>
      <button className="chip" onClick={() => workspace?.open({ kind: "bills" })}>{t("ws.bills")}</button>
      <button className="chip" onClick={() => workspace?.open({ kind: "bills", section: "expense" })}>{t("ws.record")}</button>
    </div>
    {stale}
    {preview && <div className="plan-stage-switch" role="group" aria-label={t("plan.preview.stage")}>
      {(["plan", "school"] as const).map((item) => <button key={item} type="button" aria-pressed={stage === item}
        onClick={() => { setStage(item); workspace?.setStage(item); }}>{t(item === "plan" ? "plan.preview.stage1" : "plan.preview.stage2")}</button>)}
    </div>}
    {error && <p className="error service-alert" role="alert">{error} <button className="chip" onClick={() => void (conversation ? refresh() : load()).catch(fail)}>{t("common.refresh")}</button></p>}
    {notice && <p className="service-notice" role="status">{notice}</p>}
    {signedOut && !preview && <section className="card service-card plan-welcome" aria-labelledby="plan-welcome-title">
      <div className="service-card-body">
        <h2 id="plan-welcome-title">{t("plan.welcome.title")}</h2>
        <p>{t("plan.welcome.text")}</p>
        <div className="service-actions">
          <a className="primary" href={signInUrl}>{t("common.signIn")}</a>
          <a className="secondary" href="/?plan=preview">{t("plan.welcome.preview")}</a>
          <a className="secondary" href="/?tour=1">{t("jr.welcome.tour")}</a>
        </div>
      </div>
    </section>}
    {!signedOut && <div className="plan-layout">
      <section className="card service-card plan-chat" id="plan-chat" aria-labelledby="plan-chat-title">
        <div className="service-card-body">
          <div className="plan-chat-head">
            <h2 id="plan-chat-title">{t("plan.side.chat")}</h2>
            <div className="plan-view" role="group" aria-label={t("plan.view.label")} title={t("plan.view.hint")}>
              {(["parent", "student"] as const).map((role) => <button key={role} type="button" aria-pressed={view === role}
                onClick={() => setView(role)}>{t(`plan.view.${role}`)}</button>)}
            </div>
          </div>
          {!conversation ? <p className="service-muted" role="status">{t("plan.loading")}</p> : <ol className="plan-messages" aria-live="polite" ref={listRef}>
            {conversation.turns.map((turn) => <li key={turn.id} className="plan-turn">
              {turn.goal && <div className="plan-bubble plan-bubble-user"><span className="plan-who">{t("plan.you")}</span><p>{turn.goal}</p></div>}
              {(turn.final_answer || turn.cards.length > 0) && <div className="plan-bubble plan-bubble-agent">
                <span className="plan-who">{t("plan.assistant")}</span>
                {turn.final_answer && <p>{turn.final_answer}</p>}
                {turn.cards.map((card, index) => <CardSummary key={index} id={`${turn.id}:${index}`} card={card} actions={actions} />)}
              </div>}
              {turn.status === "RUNNING" && <div className="plan-bubble plan-bubble-agent plan-thinking" role="status">{t("plan.composer.sending")}</div>}
            </li>)}
            {plan && <JourneyGuide plan={plan} pending={enrollment} ask={text => void ask(text)}
              confirm={setConfirmId} disabled={preview || busy || sending} />}
          </ol>}
          <form className="plan-composer" onSubmit={(event) => { event.preventDefault(); void ask(draft); }}>
            <div className="agent-suggestions" aria-label={t("plan.composer.suggestions")}>
              {suggestions.map((text) => <button type="button" key={text} className="chip" disabled={sending || !conversation}
                onClick={() => void ask(text)}>{text}</button>)}
            </div>
            <label className="service-field"><span className="sr-only">{t("plan.composer.label")}</span>
              <textarea value={draft} rows={2} maxLength={2000} placeholder={t(plan?.status === "CONFIRMED" ? "plan.journey.preparingPlaceholder" : plan?.status === "ENROLLED" ? "plan.journey.dailyPlaceholder" : "plan.composer.placeholder")} disabled={sending || preview}
                aria-label={t("plan.composer.label")} onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(draft); } }} />
            </label>
            <div className="service-actions">
              <button type="submit" className="primary" disabled={sending || preview || !draft.trim()}>{sending ? t("plan.composer.sending") : t("plan.composer.send")}</button>
              <button type="button" className="secondary" disabled={sending || preview} onClick={() => void load(true)}>{t("plan.new")}</button>
            </div>
          </form>
        </div>
      </section>
    </div>}
    <ToolSlot kind="plan"><PlanSummary plan={plan} onRefresh={refresh} /></ToolSlot>
    <ToolSlot kind="bills"><InSchoolPanel data={inSchool} client={client} preview={preview} onChange={loadSide} onError={fail} /></ToolSlot>
    <ToolSlot kind="spending"><MonthlySpending client={client} preview={preview} /></ToolSlot>
    <ToolSlot kind="family-links"><FamilyPanel links={family} role={conversation?.profile.role ?? null} client={client} preview={preview}
      onRefresh={loadSide}
      onLinked={async () => { setNotice(t("plan.family.linked")); await loadSide(); }} onError={fail} /></ToolSlot>
    <ToolSlot kind="card"><p className="service-muted">{t("ws.snapshot")}</p>
      {selectedCard ? <CardView card={selectedCard} actions={actions} /> : <p>{t("ws.missingCard")}</p>}
    </ToolSlot>
    {confirmId && confirming && <FocusDialog title={t("ws.confirm")} onClose={() => setConfirmId(null)} busy={busy}>
      <CardView card={confirming} actions={{ ...actions, confirm: id => void decide(id, "confirm") }} />
      <button className="secondary" disabled={busy} onClick={() => setConfirmId(null)}>{t("common.cancel")}</button>
    </FocusDialog>}
  </div>;

}

function PlanSummary({ plan, onRefresh }: { plan: Conversation["plan"]; onRefresh: () => Promise<void> }) {
  const { t } = useI18n();
  const stale = useToolRefresh(onRefresh);
  return <section className="card service-card" id="plan-summary" aria-labelledby="plan-summary-title">
    <div className="service-card-body">
      <div className="plan-card-head"><h2 id="plan-summary-title">{t("plan.side.plan")}</h2>
        {plan && <span className={`status-chip status-${plan.status.toLowerCase()}`}>{t(`plan.plan.status.${plan.status}`)}</span>}</div>
      {stale}
      {plan ? <>
        <PlanFacts plan={plan} />
        {plan.loan && <><h3>{t("plan.loan.title")}</h3><LoanFacts plan={plan} /></>}
      </> : <p className="service-muted">{t("plan.plan.none")}</p>}
    </div>
  </section>;
}

function InSchoolPanel({ data, client, preview, onChange, onError }: { data: InSchool | null; client: WalletClient; preview: boolean;
  onChange: () => Promise<void>; onError: (err: unknown) => void }) {
  const { t } = useI18n();
  const openModule = useModuleLink();
  const workspace = useWorkspace();
  const active = useToolActive();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (active && workspace?.target?.section === "expense") formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [active, workspace?.target?.section, data?.enrolled]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState("");
  const [panelNotice, setPanelNotice] = useState("");
  const stale = useToolRefresh(onChange);

  async function record(event: React.FormEvent) {
    event.preventDefault();
    if (preview || !data?.enrolled || !Number(amount)) return;
    setBusy(true); setPanelError(""); setPanelNotice("");
    try {
      await client.post("planning/expenses/record/", { amount: Number(amount).toFixed(2), note, currency: currency || data.spending.currency,
        ...(category ? { category } : {}) }, `expense:${amount}:${note}:${Date.now()}`);
      setAmount(""); setNote(""); setCategory("");
      setPanelNotice(t("ws.updated"));
      await onChange();
    } catch (err) { setPanelError(describe(err, t)); onError(err); } finally { setBusy(false); }
  }

  async function pay(bill: Bill) {
    if (preview) return;
    setBusy(true); setPanelError(""); setPanelNotice("");
    try { await client.post(`planning/bills/${bill.id}/pay/`, {}, `bill-pay:${bill.id}`); setPanelNotice(t("ws.updated")); await onChange(); }
    catch (err) { setPanelError(describe(err, t)); onError(err); } finally { setBusy(false); }
  }

  return <section className="card service-card" id="plan-school" aria-labelledby="plan-school-title">
    <div className="service-card-body">
      <h2 id="plan-school-title">{t("plan.school.title")}</h2>
      {stale}{panelError && <p role="alert" className="error">{panelError}</p>}
      {panelNotice && <p role="status" className="service-notice">{panelNotice}</p>}
      {!data?.enrolled ? <p className="service-muted">{t("plan.school.notYet")}</p> : <>
        <h3>{t("plan.spending.title", { month: data.spending.month })}</h3>
        <SpendingFacts spending={data.spending} />
        <form ref={formRef} className="plan-expense" onSubmit={record}>
          <h3>{t("plan.expense.title")}</h3>
          <div className="plan-expense-row">
            <label className="service-field">{t("plan.expense.amount")}<input inputMode="decimal" value={amount} disabled={preview || busy}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label>
            <label className="service-field">{t("plan.expense.currency")}<input value={currency || data.spending.currency} maxLength={3}
              disabled={preview || busy} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
            <label className="service-field">{t("plan.expense.category")}<select value={category} disabled={preview || busy}
              onChange={(event) => setCategory(event.target.value)}>
              <option value="">—</option>
              {CATEGORIES.map((item) => <option key={item} value={item}>{t(`plan.cat.${item}`)}</option>)}
            </select></label>
          </div>
          <label className="service-field">{t("plan.expense.note")}<input value={note} maxLength={200} disabled={preview || busy}
            onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" className="primary" disabled={preview || busy || !Number(amount)}>{t("plan.expense.save")}</button>
        </form>
        {data.spending.recent && data.spending.recent.length > 0 && <><h3>{t("plan.spending.recent")}</h3>
          <ul className="plan-categories">{data.spending.recent.map((item) => <li key={item.id}>
            <span>{item.spent_on} · {item.note || t(`plan.cat.${item.category}` as MessageKey)}{item.via_agent && <small> · {t("plan.expense.viaAgent")}</small>}</span>
            <span>{money(item.amount, item.currency)}</span>
          </li>)}</ul></>}
        <h3>{t("plan.bills.title")}</h3>
        <Bills bills={data.upcoming_bills} today={data.today} busy={busy || preview} onPay={preview ? undefined : (bill) => void pay(bill)} />
        <p className="service-muted">{t("plan.bills.payHint")}</p>
        <h3>{t("plan.school.tools")}</h3>
        <div className="plan-card-actions">
          <button type="button" className="chip" onClick={() => openModule("wallet")}>{t("plan.school.wallet")}</button>
          <button type="button" className="chip" onClick={() => openModule("payments")}>{t("plan.school.payments")}</button>
          <button type="button" className="chip" onClick={() => openModule("loans")}>{t("plan.school.loans")}</button>
        </div>
      </>}
    </div>
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

  return <section className="card service-card" id="plan-family" aria-labelledby="plan-family-title">
    <div className="service-card-body">
      <h2 id="plan-family-title">{t("plan.family.title")}</h2>
      {stale}{panelError && <p role="alert" className="error">{panelError}</p>}
      {links.length === 0 ? <p className="service-muted">{t("plan.family.none")}</p> : <ul className="plan-family">
        {links.map((item) => <li key={item.id}>
          <strong>{t(item.relation === "child" ? "plan.family.child" : "plan.family.parent", { account: item.account })}</strong>
          {item.plan && <span>{t("plan.family.childPlan", { school: pick(item.plan.school?.name, lang) || item.plan.school_key,
            status: t(`plan.plan.status.${item.plan.status}`) })}</span>}
          {item.in_school?.enrolled && <>
            <span>{t("plan.family.childSpending", { month: item.in_school.spending.month,
              spent: money(item.in_school.spending.spent, item.in_school.spending.currency, lang),
              budget: money(item.in_school.spending.budget, item.in_school.spending.currency, lang) })}</span>
            {item.in_school.upcoming_bills[0] && <span>{t("plan.family.childBills", { label: pick(item.in_school.upcoming_bills[0].label, lang),
              amount: money(item.in_school.upcoming_bills[0].amount, item.in_school.upcoming_bills[0].currency, lang),
              date: item.in_school.upcoming_bills[0].due_date })}</span>}
            <span className="service-muted">{t("plan.family.private")}</span>
          </>}
        </li>)}
      </ul>}
      {role !== "student" && <form onSubmit={link}>
        <h3>{t("plan.family.linkTitle")}</h3>
        <p className="service-muted">{t("plan.family.linkText")}</p>
        <label className="service-field">{t("plan.family.token")}<input data-sensitive="true" value={token} maxLength={64} disabled={preview || busy}
          autoComplete="off" onChange={(event) => setToken(event.target.value.trim())} /></label>
        <button type="submit" className="secondary" disabled={preview || busy || token.length !== 64}>{t("plan.family.link")}</button>
      </form>}
    </div>
  </section>;
}
