import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

const origin = "https://studyflow.test";

describe("safeNext", () => {
  it("keeps same-origin destinations as a path", () => {
    expect(safeNext(`${origin}/?trust=1#top`, origin)).toBe("/?trust=1#top");
    expect(safeNext("/?plan=1", origin)).toBe("/?plan=1");
  });

  it("refuses other origins and protocol-relative paths", () => {
    for (const raw of ["https://evil.test/", "//evil.test", `${origin}//evil.test`, `${origin}/\\evil.test`, "javascript:alert(1)"]) {
      expect(safeNext(raw, origin)).toBe("/");
    }
  });

  it("falls back to the start page without a destination", () => {
    expect(safeNext(null, origin)).toBe("/");
    expect(safeNext("", origin)).toBe("/");
  });
});
