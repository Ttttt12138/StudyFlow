import { describe, expect, it } from "vitest";
import { minutesLeft, orderOutcomes, paymentOutcomes } from "./logic";

describe("adapter outcomes", () => {
  it("offers only the payment transitions Django accepts", () => {
    expect(paymentOutcomes({ status: "pending" })).toEqual(["settled", "failed", "unknown"]);
    expect(paymentOutcomes({ status: "unknown" })).toEqual(["settled", "failed"]);
    expect(paymentOutcomes({ status: "settled" })).toEqual([]);
  });
  it("offers only the remittance transitions Django accepts", () => {
    expect(orderOutcomes({ status: "SUBMITTED" })).toEqual(["dispatched", "delivered", "failed", "unknown"]);
    expect(orderOutcomes({ status: "IN_TRANSIT" })).toEqual(["delivered", "failed", "unknown"]);
    expect(orderOutcomes({ status: "UNKNOWN" })).toEqual(["delivered", "failed"]);
    expect(orderOutcomes({ status: "DELIVERED" })).toEqual([]);
  });
});

describe("minutesLeft", () => {
  it("counts whole minutes to expiry", () => {
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(minutesLeft("2026-10-11T01:30:30Z", now)).toBe(90);
    expect(minutesLeft("2026-10-10T23:59:00Z", now)).toBe(-1);
  });
});
