import { afterEach, describe, expect, it, vi } from "vitest";

function storage(saved: Record<string, string>) {
  return { getItem: (key: string) => saved[key] ?? null, setItem: () => undefined };
}

async function startWith(language: string, saved: Record<string, string>) {
  vi.resetModules();
  vi.stubGlobal("navigator", { language });
  vi.stubGlobal("localStorage", storage(saved));
  return (await import("./index")).getLang();
}

describe("initial interface language", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is English even in a Chinese browser", async () => {
    expect(await startWith("zh-CN", {})).toBe("en");
  });

  it("keeps a language the viewer chose", async () => {
    expect(await startWith("en-US", { "studyflow.lang": "zh" })).toBe("zh");
  });
});
