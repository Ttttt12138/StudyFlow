import { describe, expect, it } from "vitest";
import { journeyPhase, needsJourneyIntro, rememberJourney, readJourney } from "./journeyPhase";

describe("journey introduction", () => {
  it("follows confirmed server state, including an empty plan", () => {
    expect(journeyPhase(null)).toBe(0);
    expect(journeyPhase("DRAFT")).toBe(0);
    expect(journeyPhase("CONFIRMED")).toBe(1);
    expect(journeyPhase("ENROLLED")).toBe(2);
  });
  it("only introduces unseen forward stages for an authenticated account", () => {
    expect(needsJourneyIntro("student", 0, -1)).toBe(true);
    expect(needsJourneyIntro("student", 1, 0)).toBe(true);
    expect(needsJourneyIntro("student", 1, 1)).toBe(false);
    expect(needsJourneyIntro("student", 0, 2)).toBe(false);
    expect(needsJourneyIntro("", 0, -1)).toBe(false);
    expect(needsJourneyIntro("student", undefined, -1)).toBe(false);
  });
  it("keeps accounts separate and never lowers a completed acknowledgement", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readJourney("a", storage)).toBe(-1);
    rememberJourney("a", 2, storage); rememberJourney("a", 0, storage);
    expect(readJourney("a", storage)).toBe(2);
    expect(readJourney("b", storage)).toBe(-1);
    values.set("studyflow.journey.v1:b", "broken");
    expect(readJourney("b", storage)).toBe(-1);
  });
  it("tolerates unavailable browser storage", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readJourney("a", storage)).toBe(-1);
    expect(() => rememberJourney("a", 1, storage)).not.toThrow();
  });
});
