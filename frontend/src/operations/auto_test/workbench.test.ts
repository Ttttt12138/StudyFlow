import { describe, expect, it } from "vitest";
import { createOperationsPreview } from "../previewAdapter";
import { workbenchPath, navigationFromHash } from "../workbench";
import type { OpsWorkbench } from "../types";

describe("workbench navigation and preview", () => {
  it("preserves legacy section links and defaults to overview", () => {
    expect(navigationFromHash("#ops-adapter")).toEqual({ view: "tasks", kind: "transactions", attention: "all" });
    expect(navigationFromHash("#ops-decisions").view).toBe("history");
    expect(navigationFromHash("#unknown").view).toBe("overview");
  });
  it("encodes student input as a parameter", () => {
    const url = new URL(workbenchPath({ student: "a&b", kind: "all", attention: "unknown", page: 2 }), "https://test/");
    expect(url.searchParams.get("student")).toBe("a&b");
    expect(url.searchParams.get("page")).toBe("2");
  });
  it("filters sample data before paging and retains student-wide metrics", async () => {
    const client = createOperationsPreview();
    const all = await client.get<OpsWorkbench>("operations/workbench/?student=uat");
    const unknown = await client.get<OpsWorkbench>("operations/workbench/?student=uat&attention=unknown&page_size=1");
    expect(all.items.every(row => row.record.owner_username === "uat-student")).toBe(true);
    expect(unknown.summary).toEqual(all.summary);
    expect(unknown.items).toHaveLength(1);
    expect(unknown.items[0].attention).toBe("unknown");
    expect(unknown.pagination.total).toBe(1);
  });
  it("returns zeroes for an empty filter and refuses preview writes", async () => {
    const client = createOperationsPreview();
    const data = await client.get<OpsWorkbench>("operations/workbench/?student=nobody");
    expect(data.summary.total).toBe(0);
    expect(data.items).toEqual([]);
    expect(data.pagination.pages).toBe(1);
    await expect(client.post("anything", {})).rejects.toThrow("read-only");
  });
});
