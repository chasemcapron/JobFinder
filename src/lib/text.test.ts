import { describe, expect, it } from "vitest";
import { containsTerm, decodeHtmlEntities, htmlToText, normalizeForKey, truncate } from "./text";

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("&lt;p&gt;R&amp;D &#39;x&#39; &#x2014;")).toBe("<p>R&D 'x' —");
  });
  it("leaves unknown entities alone", () => expect(decodeHtmlEntities("&bogus;")).toBe("&bogus;"));
});

describe("htmlToText", () => {
  it("turns block elements into line breaks and strips tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p><ul><li>One</li><li>Two</li></ul>")).toBe("Hello world\n\n• One\n• Two");
  });
  it("handles entity-escaped HTML after decoding", () => {
    expect(htmlToText(decodeHtmlEntities("&lt;p&gt;Hi&lt;/p&gt;"))).toBe("Hi");
  });
});

describe("containsTerm", () => {
  it("matches whole words case-insensitively", () => {
    expect(containsTerm("We use React and TypeScript", "react")).toBe(true);
    expect(containsTerm("Reactive systems", "react")).toBe(false);
  });
  it("handles symbols", () => {
    expect(containsTerm("Experience with C++ and C#", "C++")).toBe(true);
    expect(containsTerm("Experience with C++ and C#", "C#")).toBe(true);
    expect(containsTerm("Experience with C and Go", "C++")).toBe(false);
    expect(containsTerm("Built on .NET Core", ".NET")).toBe(true);
    expect(containsTerm("Node.js services", "node.js")).toBe(true);
  });
  it("treats spaces and hyphens as equivalent", () => {
    expect(containsTerm("machine-learning pipelines", "machine learning")).toBe(true);
  });
  it("ignores empty terms", () => expect(containsTerm("anything", " ")).toBe(false));
});

describe("normalizeForKey", () => {
  it("normalizes case, accents and punctuation", () => {
    expect(normalizeForKey("  Senior Engineer — Café, Inc. ")).toBe("senior engineer cafe inc");
  });
});

describe("truncate", () => {
  it("adds an ellipsis only when needed", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("a long sentence here", 8)).toBe("a long…");
  });
});
