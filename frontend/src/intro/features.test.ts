import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";
import { featureKey, features } from "./features";

// featureKey casts to MessageKey, so tsc cannot see a feature whose copy is missing.
describe("intro feature copy", () => {
  it.each(["en", "zh"] as const)("has a title, tags and body for every feature in %s", (lang) => {
    const missing = features.flatMap(({ id }) =>
      (["title", "tags", "body"] as const).map((field) => featureKey(id, field)).filter((key) => !messages[lang][key]?.trim()));
    expect(missing).toEqual([]);
  });
});
