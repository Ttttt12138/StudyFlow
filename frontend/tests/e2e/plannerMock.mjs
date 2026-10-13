// The workspace only offers money tools once the plan is ENROLLED (src/workspace/navigation.ts).
// Specs that open a money tool against mocked Django register this after their own catch-all route,
// so the planner behind the tool reads an enrolled plan instead of a 404.
const PLAN = {
  id: "00000000-0000-4000-8000-00000000e001", status: "ENROLLED", school_key: "chulalongkorn", years: 4, start_date: "2026-08-02", version: 3,
  available_funds: "1500000.00", funds_currency: "THB", school: { name: { en: "Chulalongkorn University", zh: "朱拉隆功大学" }, currency: "THB" },
  total: "2351350.00", currency: "THB", gap: "851350.00",
};
const RATES = { thb_per_unit: { THB: "1", CNY: "4.60", USD: "33.00", GBP: "42.00", AUD: "21.50" }, rate_date: "2026-10-13", source: "fixture", currencies: ["THB", "CNY", "USD"] };

export async function enrolledPlanner(page, { status = "ENROLLED", homeCurrency = "THB" } = {}) {
  const conversation = { id: "00000000-0000-4000-8000-00000000c0a1", locale: "en", profile: { role: null, home_currency: homeCurrency },
    plan: { ...PLAN, status }, turns: [] };
  const json = (route, data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data }) });
  await page.route("**/api/v2/agent/conversations/**", route => {
    const path = new URL(route.request().url()).pathname;
    return path.endsWith("/agent/conversations/") && route.request().method() === "GET"
      ? json(route, [{ id: conversation.id, updated_at: "2026-10-13T00:00:00Z", turn_count: 0 }]) : json(route, conversation);
  });
  await page.route("**/api/v2/planning/**", route => {
    const path = new URL(route.request().url()).pathname.replace(/.*\/api\/v2\//, "");
    if (path === "planning/in-school/") return json(route, { enrolled: false });
    if (path === "planning/family-links/") return json(route, []);
    if (path === "planning/rates/") return json(route, RATES);
    if (path === "planning/schools/") return json(route, { schools: [], sample: true });
    return route.fallback();
  });
  return conversation;
}
