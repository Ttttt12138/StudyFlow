import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blocks, Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("agent answer markdown", () => {
  it("renders bold instead of showing asterisks", () => {
    expect(html("请告诉我**每月收入**的金额")).toBe("<div><p>请告诉我<strong>每月收入</strong>的金额</p></div>");
  });

  it("groups bullet and numbered lines into lists", () => {
    expect(blocks("要点：\n- 学费\n- 住宿\n\n1. 先比价\n2. 再贷款")).toEqual([
      { kind: "p", lines: ["要点："] }, { kind: "ul", items: ["学费", "住宿"] }, { kind: "ol", items: ["先比价", "再贷款"] }]);
  });

  it("keeps raw HTML inert and only links http(s) urls", () => {
    expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(html("[来源](https://example.com) [坏](javascript:alert(1))")).toBe(
      '<div><p><a href="https://example.com" target="_blank" rel="noopener noreferrer">来源</a> [坏](javascript:alert(1))</p></div>');
  });

  it("leaves plain prices and single asterisks alone", () => {
    expect(html("总价 THB 1,200 * 2 年")).toBe("<div><p>总价 THB 1,200 * 2 年</p></div>");
  });
});
