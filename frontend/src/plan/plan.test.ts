import { describe, expect, it } from "vitest";
import { WalletApiError } from "../wallet/client";
import { money, pick } from "./format";
import { createPlanPreview } from "./preview";
import type { Conversation, InSchool } from "./types";

describe("planner money format", () => {
  it("drops cents on large amounts and keeps them on small ones", () => {
    expect(money("2351350.00", "THB")).toBe("2,351,350 THB");
    expect(money("85.50", "THB")).toBe("85.50 THB");
    expect(money("120", "")).toBe("120");
    expect(money(null, "THB")).toBe("—");
    expect(money("not a number", "THB")).toBe("not a number");
  });

  it("picks the viewer's language with an English fallback", () => {
    expect(pick({ en: "Food", zh: "美食" }, "zh")).toBe("美食");
    expect(pick({ en: "Food", zh: "" }, "zh")).toBe("Food");
    expect(pick(null, "en")).toBe("");
  });
});

describe("planner preview client", () => {
  it("replays the recorded conversation and refuses every write", async () => {
    const client = createPlanPreview("en", "plan");
    const [summary] = await client.get<{ id: string }[]>("agent/conversations/");
    const conversation = await client.get<Conversation>(`agent/conversations/${summary.id}/`);
    expect(conversation.turns[0].kind).toBe("assistant");
    expect(conversation.turns.some((turn) => turn.cards.some((card) => card.type === "cost"))).toBe(true);
    expect(await client.post<Conversation>(`agent/conversations/${summary.id}/open/`, {})).toBe(conversation);
    await expect(client.post(`agent/conversations/${summary.id}/messages/`, { text: "hi" })).rejects.toBeInstanceOf(WalletApiError);
  });

  it("has a confirmed, not yet enrolled preparing stage in both languages", async () => {
    for (const lang of ["en", "zh"] as const) {
      const client = createPlanPreview(lang, "prepare");
      const [summary] = await client.get<{ id: string }[]>("agent/conversations/");
      const conversation = await client.get<Conversation>(`agent/conversations/${summary.id}/`);
      expect(conversation.plan?.status).toBe("CONFIRMED");
      expect(conversation.turns.some((turn) => turn.pending_actions.some((action) => action.action === "plan.enroll"))).toBe(false);
      expect((await client.get<InSchool>("planning/in-school/")).enrolled).toBe(false);
    }
  });

  it("has an enrolled in-school stage in both languages", async () => {
    for (const lang of ["en", "zh"] as const) {
      const school = await createPlanPreview(lang, "school").get<InSchool>("planning/in-school/");
      expect(school.enrolled).toBe(true);
      if (school.enrolled) expect(school.upcoming_bills.length).toBeGreaterThan(0);
    }
  });
});
