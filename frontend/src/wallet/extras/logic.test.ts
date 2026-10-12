import { describe, expect, it } from "vitest";
import { amountProblem, amountRange, countdown, directions, ledgerOrigin, nextPagePath, quoteExpired, quoteSecondsLeft, signedParts, sourceCurrencies, targetCurrencies, tiersFor, type FxCorridor, type LedgerEntry } from "./logic";

function corridor(source: string, target: string, tier: string, min = "10.00", max = "5000.00", extra: Partial<FxCorridor> = {}): FxCorridor {
  return { id: `${source}-${target}-${tier}`, code: "", provider: "Mock", tier, source_currency: source, target_currency: target,
    min_amount: min, max_amount: max, settlement_min_days: 0, settlement_days: 1, is_simulated: true, enabled: true, ...extra };
}
const seeded = ["CNY", "USD", "EUR"].flatMap((source) => ["economy", "express", "standard"].map((tier) => corridor(source, "THB", tier)))
  .concat(["standard", "express", "economy"].map((tier) => corridor("THB", "CNY", tier, tier === "express" ? "100.00" : "500.00", tier === "economy" ? "90000.00" : "50000.00")));
const entry = (extra: Partial<LedgerEntry>): LedgerEntry => ({ id: "e", created_at: "", installment: null, sequence: 1, funding_source: null, disbursement: null,
  payment: null, conversion: null, remittance_order: null, remittance_leg: null, currency: "THB", amount: "1.00", effective_on: "2026-10-01", ...extra });

describe("corridor directions", () => {
  it("lists each seeded direction once and drops disabled or same-currency rows", () => {
    expect(directions([...seeded, corridor("JPY", "THB", "standard", "1", "2", { enabled: false }), corridor("THB", "THB", "standard")]))
      .toEqual([{ source: "CNY", target: "THB" }, { source: "USD", target: "THB" }, { source: "EUR", target: "THB" }, { source: "THB", target: "CNY" }]);
  });
  it("limits sources to held balances and targets to the seeded direction", () => {
    const list = directions(seeded);
    expect(sourceCurrencies(list, ["THB", "USD", "GBP"])).toEqual(["USD", "THB"]);
    expect(sourceCurrencies(list, null)).toEqual(["CNY", "USD", "EUR", "THB"]);
    expect(targetCurrencies(list, "THB")).toEqual(["CNY"]);
    expect(targetCurrencies(list, "USD")).toEqual(["THB"]);
    expect(targetCurrencies(list, "GBP")).toEqual([]);
  });
  it("returns every tier of a direction, express first, with the widest range", () => {
    const tiers = tiersFor(seeded, "THB", "CNY");
    expect(tiers.map((row) => row.tier)).toEqual(["express", "standard", "economy"]);
    expect(amountRange(tiers)).toEqual({ min: "100.00", max: "90000.00" });
    expect(amountRange([])).toBeNull();
  });
});

describe("amountProblem", () => {
  const range = { min: "10.00", max: "5000.00" };
  it("accepts a positive amount within the corridor range", () => {
    expect(amountProblem("10", range)).toBe("");
    expect(amountProblem(" 5000.00 ", range)).toBe("");
  });
  it("rejects malformed, zero, over-precise and out-of-range amounts", () => {
    expect(amountProblem("", range)).toBe("format");
    expect(amountProblem("0.00", range)).toBe("format");
    expect(amountProblem("-5", range)).toBe("format");
    expect(amountProblem("1e3", range)).toBe("format");
    expect(amountProblem("12.345", range)).toBe("precision");
    expect(amountProblem("9.99", range)).toBe("below");
    expect(amountProblem("5000.01", range)).toBe("above");
    expect(amountProblem("5000.01", null)).toBe("");
  });
});

describe("ledgerOrigin", () => {
  it("labels the entry by whichever origin is set", () => {
    expect(ledgerOrigin(entry({ funding_source: "f" }))).toBe("funding");
    expect(ledgerOrigin(entry({ disbursement: "d" }))).toBe("disbursement");
    expect(ledgerOrigin(entry({ payment: "p" }))).toBe("payment");
    expect(ledgerOrigin(entry({ conversion: "c" }))).toBe("conversion");
    expect(ledgerOrigin(entry({ installment: "i" }))).toBe("installment");
    expect(ledgerOrigin(entry({ remittance_order: "r", remittance_leg: "debit" }))).toBe("transfer_debit");
    expect(ledgerOrigin(entry({ remittance_order: "r", remittance_leg: "refund" }))).toBe("transfer_refund");
    expect(ledgerOrigin(entry({ remittance_order: "r", remittance_leg: "credit" }))).toBe("transfer_credit");
    expect(ledgerOrigin(entry({ remittance_order: "r" }))).toBe("unknown");
    expect(ledgerOrigin(entry({}))).toBe("unknown");
  });
  it("splits signed amounts", () => {
    expect(signedParts("-120.50")).toEqual({ sign: "−", abs: "120.50" });
    expect(signedParts("300.00")).toEqual({ sign: "+", abs: "300.00" });
  });
});

describe("quote expiry", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  it("counts down to the expiry and treats the deadline itself as expired", () => {
    expect(quoteSecondsLeft({ expires_at: "2026-10-12T10:09:59Z" }, now)).toBe(599);
    expect(countdown(599)).toBe("9:59");
    expect(quoteExpired({ expires_at: "2026-10-12T10:00:01Z" }, now)).toBe(false);
    expect(quoteExpired({ expires_at: "2026-10-12T10:00:00Z" }, now)).toBe(true);
    expect(quoteExpired({ expires_at: "2026-10-12T09:00:00Z" }, now)).toBe(true);
    expect(quoteExpired({ expires_at: "" }, now)).toBe(true);
  });
});

describe("nextPagePath", () => {
  it("follows only same-origin API pages", () => {
    expect(nextPagePath("http://127.0.0.1:5180/api/v2/ledger/?page=2", "http://127.0.0.1:5180")).toBe("ledger/?page=2");
    expect(nextPagePath("/api/v2/ledger/?page=3", "http://127.0.0.1:5180")).toBe("ledger/?page=3");
    expect(nextPagePath("https://evil.example/api/v2/ledger/?page=2", "http://127.0.0.1:5180")).toBeNull();
    expect(nextPagePath("http://127.0.0.1:5180/admin/?page=2", "http://127.0.0.1:5180")).toBeNull();
    expect(nextPagePath(null, "http://127.0.0.1:5180")).toBeNull();
  });
});
