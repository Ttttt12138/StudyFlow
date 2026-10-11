import { WalletApiError, type WalletClient } from "../wallet/client";
import type { Lang } from "../i18n";
import type { AgentSession, AgentStep } from "./types";

// Fixed synthetic conversation for the signed-out preview. It never calls Django and every
// command is refused, so the preview cannot be mistaken for a saved session.
const SESSION_ID = "00000000-0000-4000-8000-0000000a6e01";
const ORDER_ID = "00000000-0000-4000-8000-0000000a6e02";
const QUOTE_A = "00000000-0000-4000-8000-0000000a6e03";
const QUOTE_B = "00000000-0000-4000-8000-0000000a6e04";

function step(number: number, tool: string, tier: string, status: AgentStep["status"], rationale: string,
  args: Record<string, unknown>, result: Record<string, unknown>): AgentStep {
  return { id: `00000000-0000-4000-8000-00000000s${String(number).padStart(3, "0")}`, number, tool, tier, status,
    rationale, arguments: args, result, created_at: "2026-10-11T03:00:00Z" };
}

export function previewSession(lang: Lang): AgentSession {
  const zh = lang === "zh";
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const proposal = { pending_action_id: "00000000-0000-4000-8000-0000000a6e05", action: "remittance.submit",
    target_id: ORDER_ID, currency: "CNY", amount: "5000.00", expires_at: expires, executed: false,
    requires: ["student_confirmation", "step_up"],
    details: { order_id: ORDER_ID, recipient: "SELF", receive_currency: "THB", receive_amount: "23810.50" } };
  const answer = zh
    ? "我比较了两条渠道，推荐到账金额更高且按时到账的渠道，并准备好了汇款订单。资金尚未移动：请在下方确认并输入密码后才会提交。所有资金均为模拟。"
    : "I compared two routes and prepared an order on the one that delivers more on time. No money has moved: it is submitted only after you confirm below with your password. All funds are simulated.";
  return {
    id: SESSION_ID, locale: lang, mode: "mock", status: "COMPLETED", error_code: "", write_count: 3,
    goal: zh ? "帮我把5000元人民币汇到泰铢，比较一下渠道" : "Send 5000 CNY to my THB wallet and compare the routes",
    final_answer: answer,
    created_at: "2026-10-11T03:00:00Z", updated_at: "2026-10-11T03:00:05Z", is_simulated: true,
    steps: [
      step(1, "get_balances", "T0", "OK", zh ? "先确认人民币余额是否足够" : "Check the CNY balance first", {},
        { home_currency: "THB", balances: [{ currency: "CNY", balance: "40000.00" }] }),
      step(2, "list_corridors", "T0", "OK", zh ? "查找人民币到泰铢的渠道" : "Find CNY to THB corridors",
        { source_currency: "CNY", target_currency: "THB" }, { corridors: [{ code: "CNY-THB-BANK" }, { code: "CNY-THB-FAST" }] }),
      step(3, "create_live_quote", "T1", "OK", zh ? "为第一条渠道报价" : "Price the first corridor",
        { send_amount: "5000.00" }, { id: QUOTE_A, net_received: "23810.50" }),
      step(4, "create_live_quote", "T1", "OK", zh ? "为第二条渠道报价" : "Price the second corridor",
        { send_amount: "5000.00" }, { id: QUOTE_B, net_received: "23655.10" }),
      step(5, "rank_quotes", "T0", "OK", zh ? "按按时到账和到账金额排序" : "Rank by on-time arrival and amount received",
        { quote_ids: [QUOTE_A, QUOTE_B] }, { recommended_quote_id: QUOTE_A }),
      step(6, "create_remittance_order", "T1", "OK", zh ? "用推荐报价创建订单（未提交）" : "Create an order on the best quote (not submitted)",
        { quote_id: QUOTE_A, recipient: "SELF", purpose: "living" }, { id: ORDER_ID, status: "CREATED" }),
      step(7, "submit_remittance_order", "T2", "PROPOSED", zh ? "提交会让资金离开钱包，只能提议" : "Submitting moves money, so it can only be proposed",
        { order_id: ORDER_ID }, proposal),
      step(8, "", "", "FINAL", "", {}, { answer }),
    ],
    pending_actions: [{
      id: proposal.pending_action_id, session: SESSION_ID, step: "00000000-0000-4000-8000-00000000s007",
      action: "remittance.submit", tool: "submit_remittance_order", arguments: proposal.details, target_id: ORDER_ID,
      amount: "5000.00", currency: "CNY", status: "PENDING", expires_at: expires, decided_at: null, result: {},
      version: 1, created_at: "2026-10-11T03:00:04Z",
    }],
  };
}

export function createAgentPreview(lang: Lang): WalletClient {
  const session = previewSession(lang);
  return {
    async get<T>(path: string): Promise<T> {
      if (path.startsWith("agent/sessions/" + session.id)) return session as T;
      if (path.startsWith("agent/sessions/")) return { count: 1, next: null, previous: null, results: [session] } as T;
      if (path.startsWith("approvals/")) return { count: 0, next: null, previous: null, results: [] } as T;
      throw new WalletApiError(404, { detail: "Not available in the preview." });
    },
    async post<T>(): Promise<T> {
      throw new WalletApiError(0, { detail: "The preview is read-only." });
    },
  };
}
