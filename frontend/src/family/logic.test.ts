import { describe, expect, it } from "vitest";
import { amountProblem, canChange, canRevoke, extractToken, isSponsorToken, newEconomicKey, requestStep, statusTone } from "./logic";
import { sponsorLink } from "./link";
import type { SponsorRequest, SponsorStatus } from "./types";

const TOKEN = "a".repeat(32) + "0123456789abcdef0123456789ABCDEF";
const req = (status: SponsorStatus, token_expires_at: string | null = null, received = false) =>
  ({ status, token_expires_at, source: { received } }) as Pick<SponsorRequest, "status" | "token_expires_at" | "source">;

describe("sponsor token", () => {
  it("accepts exactly 64 hex characters", () => {
    expect(isSponsorToken(TOKEN)).toBe(true);
    expect(isSponsorToken(TOKEN.slice(1))).toBe(false);
    expect(isSponsorToken(TOKEN + "a")).toBe(false);
    expect(isSponsorToken("g".repeat(64))).toBe(false);
  });
  it("reads it from a location hash, a pasted link or the raw value", () => {
    const lower = TOKEN.toLowerCase();
    expect(extractToken(`#token=${TOKEN}`)).toBe(lower);
    expect(extractToken(`https://studyflow.example/?sponsor=1#token=${TOKEN}`)).toBe(lower);
    expect(extractToken(`  ${TOKEN}\n`)).toBe(lower);
    expect(extractToken(`#token=${TOKEN}&x=1`)).toBe(lower);
    expect(extractToken(sponsorLink("http://127.0.0.1:5180", lower))).toBe(lower);
  });
  it("rejects anything else", () => {
    expect(extractToken("")).toBeNull();
    expect(extractToken("#token=abc")).toBeNull();
    expect(extractToken(`#notoken=${TOKEN}`)).toBeNull();
    expect(extractToken("https://studyflow.example/?sponsor=1")).toBeNull();
  });
});

describe("sponsorLink", () => {
  it("keeps the token in the fragment", () => {
    expect(sponsorLink("https://a.test", "ff")).toBe("https://a.test/?sponsor=1#token=ff");
  });
});

describe("amountProblem", () => {
  it("accepts Django money values", () => {
    expect(amountProblem("5000", "THB")).toBeNull();
    expect(amountProblem(" 5000.5 ", "CNY")).toBeNull();
    expect(amountProblem("120000", "JPY")).toBeNull();
    expect(amountProblem("120000.00", "JPY")).toBeNull();
  });
  it("rejects bad formats, zero and fractional yen", () => {
    expect(amountProblem("", "THB")).toBe("format");
    expect(amountProblem("1,000", "THB")).toBe("format");
    expect(amountProblem("1.234", "USD")).toBe("format");
    expect(amountProblem("-5", "USD")).toBe("format");
    expect(amountProblem("0.00", "USD")).toBe("positive");
    expect(amountProblem("100.50", "JPY")).toBe("jpy");
  });
});

describe("newEconomicKey", () => {
  it("slugs the purpose and stays within 100 characters", () => {
    expect(newEconomicKey("Rent deposit, Sept!", () => "abc123")).toBe("family-rent-deposit-sept-abc123");
    expect(newEconomicKey("学费", () => "r")).toBe("family-support-r");
    expect(newEconomicKey("x".repeat(300)).length).toBeLessThanOrEqual(100);
    expect(newEconomicKey("a")).not.toBe(newEconomicKey("a"));
  });
});

describe("requestStep", () => {
  it("maps status and link state to the step shown", () => {
    expect(requestStep(req("PENDING"))).toBe("operator");
    expect(requestStep(req("PENDING", "2026-10-14T00:00:00Z"))).toBe("family");
    expect(requestStep(req("EXPIRED", "2026-10-01T00:00:00Z"))).toBe("expired");
    expect(requestStep(req("CONFIRMED", "2026-10-14T00:00:00Z"))).toBe("money");
    expect(requestStep(req("CONFIRMED", null, true))).toBe("received");
    expect(requestStep(req("RECEIVED", null, true))).toBe("received");
    expect(requestStep(req("REJECTED"))).toBe("rejected");
    expect(requestStep(req("REVOKED"))).toBe("revoked");
  });
  it("only lets unreceived requests change", () => {
    expect(canChange(req("CONFIRMED"))).toBe(true);
    expect(canChange(req("RECEIVED", null, true))).toBe(false);
    expect(canRevoke(req("REVOKED"))).toBe(false);
    expect(canRevoke(req("REJECTED"))).toBe(true);
    expect(statusTone("RECEIVED")).toBe("ok");
    expect(statusTone("EXPIRED")).toBe("failed");
  });
});
