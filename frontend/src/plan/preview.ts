import type { Lang } from "../i18n";
import { translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { Conversation } from "./types";

/** "plan": choosing a school and the loan; "prepare": the loan application is submitted and the plan tools are open. */
export type PreviewStage = "plan" | "prepare";
export const previewStages: readonly PreviewStage[] = ["plan", "prepare"];
type Recording = { conversation: Conversation; assessment: unknown };

// Recorded from the real API with the rule planner (backend/auto_test/fixture_plan_preview.py).
// Loaded on demand so signed-in visitors never download them.
const RECORDINGS: Record<PreviewStage, Record<Lang, () => Promise<{ default: unknown }>>> = {
  plan: { en: () => import("./preview-data/plan.en.json"), zh: () => import("./preview-data/plan.zh.json") },
  prepare: { en: () => import("./preview-data/prepare.en.json"), zh: () => import("./preview-data/prepare.zh.json") },
};

const LIFE: Record<PreviewStage, Record<Lang, () => Promise<{ default: unknown }>>> = {
  plan: { en: () => import("./preview-data/life.plan.en.json"), zh: () => import("./preview-data/life.plan.zh.json") },
  prepare: { en: () => import("./preview-data/life.prepare.en.json"), zh: () => import("./preview-data/life.prepare.zh.json") },
};

/** Read-only client over a recorded conversation; every write is refused. */
export function createPlanPreview(lang: Lang, stage: PreviewStage): WalletClient {
  let loaded: Promise<Recording> | null = null;
  const data = () => (loaded ??= RECORDINGS[stage][lang]().then((module) => module.default as Recording));
  return {
    async get<T>(path: string): Promise<T> {
      if (path === "planning/history/") return { prices: [], drafts: [], draft_limit: 3 } as T;
      if (path === "planning/life/") return (await LIFE[stage][lang]()).default as T;
      if (path === "planning/assessment/") return (await data()).assessment as T;
      const { conversation } = await data();
      if (path === "agent/conversations/") return [{ id: conversation.id, updated_at: "", turn_count: conversation.turns.length }] as T;
      if (path.startsWith("agent/conversations/")) return conversation as T;
      throw new WalletApiError(404, { detail: path });
    },
    async post<T>(path: string): Promise<T> {
      if (path.endsWith("/open/")) return (await data()).conversation as T;
      throw new WalletApiError(403, { code: "PREVIEW_READ_ONLY", detail: translate(lang, "plan.preview.readOnly") });
    },
  };
}
