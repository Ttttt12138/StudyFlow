import type { Lang } from "../i18n";
import { translate } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import type { Conversation, FamilyLink, InSchool } from "./types";

export type PreviewStage = "plan" | "school";
type Recording = { conversation: Conversation; in_school: InSchool; family: FamilyLink[] };

// Recorded from the real API with the rule planner (backend/auto_test/fixture_plan_preview.py).
// Loaded on demand so signed-in visitors never download them.
const RECORDINGS: Record<PreviewStage, Record<Lang, () => Promise<{ default: unknown }>>> = {
  plan: { en: () => import("./preview-data/plan.en.json"), zh: () => import("./preview-data/plan.zh.json") },
  school: { en: () => import("./preview-data/school.en.json"), zh: () => import("./preview-data/school.zh.json") },
};

/** Read-only client over a recorded conversation; every write is refused. */
export function createPlanPreview(lang: Lang, stage: PreviewStage): WalletClient {
  let loaded: Promise<Recording> | null = null;
  const data = () => (loaded ??= RECORDINGS[stage][lang]().then((module) => module.default as Recording));
  return {
    async get<T>(path: string): Promise<T> {
      const { conversation, in_school, family } = await data();
      if (path === "agent/conversations/") return [{ id: conversation.id, updated_at: "", turn_count: conversation.turns.length }] as T;
      if (path.startsWith("agent/conversations/")) return conversation as T;
      if (path === "planning/in-school/") return in_school as T;
      if (path.startsWith("planning/expenses/") && in_school.enrolled) {
        const query = new URL(path, "http://preview").searchParams;
        const month = query.get("month") ?? in_school.spending.month;
        const spending = month === in_school.spending.month ? in_school.spending :
          { ...in_school.spending, month, spent: "0", remaining: in_school.spending.budget, over_budget: false, by_category: {}, recent: [], unconverted: [] };
        const entries = spending.recent ?? [];
        return { ...spending, entries, count: entries.length, next_offset: null } as T;
      }
      if (path === "planning/family-links/") return family as T;
      throw new WalletApiError(404, { detail: path });
    },
    async post<T>(path: string): Promise<T> {
      if (path.endsWith("/open/")) return (await data()).conversation as T;
      throw new WalletApiError(403, { code: "PREVIEW_READ_ONLY", detail: translate(lang, "plan.preview.readOnly") });
    },
  };
}
