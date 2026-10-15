import { describe, expect, it } from "vitest";
import { previewQuotes } from "./wallet/mockAdapter";

describe("wallet preview quotes", () => {
  it("are still valid whatever today's date is", () => {
    for (const quote of previewQuotes()) expect(Date.parse(quote.expires_at)).toBeGreaterThan(Date.now());
  });
});
