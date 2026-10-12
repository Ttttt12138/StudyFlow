import { describe, expect, it } from "vitest";
import { asksForMonthlySpending, spendingSlices } from "./monthly";

describe("monthly spending intent", () => {
  it("opens for explicit monthly bills and spending requests in both languages", () => {
    for (const text of ["我这月账单", "这个月花了多少？", "查看本月消费明细", "Show my bills for this month", "How much have I spent this month?"])
      expect(asksForMonthlySpending(text)).toBe(true);
  });
  it("does not open for expense writes, payments, other months or general replies", () => {
    for (const text of ["今天午饭花了120泰铢", "帮我记录本月消费200元", "支付这个月账单", "上个月账单", "学校周边", "Pay this month's bills", "Don't show this month's bills"])
      expect(asksForMonthlySpending(text)).toBe(false);
  });
});

describe("spending shares", () => {
  it("uses category totals, orders largest first and covers the full circle", () => {
    const slices = spendingSlices({ food: "30", transport: "10" });
    expect(slices.map(s => [s.category, s.share, s.start, s.end])).toEqual([["food", 75, 0, 75], ["transport", 25, 75, 100]]);
  });
  it("handles empty, zero and invalid values without a fake chart", () => {
    expect(spendingSlices({ food: "0", other: "NaN", study: "-1" })).toEqual([]);
    expect(spendingSlices({ food: "12.50" })[0].share).toBe(100);
  });
});
