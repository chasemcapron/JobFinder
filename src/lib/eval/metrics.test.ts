import { describe, expect, it } from "vitest";
import { parseLabelInput, rankingMetrics, recall, type Label } from "./metrics";

const labels: Record<string, Label> = { a: "good", b: "bad", c: "maybe", d: "good", e: "bad" };

describe("rankingMetrics", () => {
  it("counts precision, lenient precision and bad postings near the top", () => {
    const m = rankingMetrics(["a", "b", "c", "d", "e"], labels);
    expect(m).toMatchObject({ labeled: 5, good: 2, maybe: 1, bad: 2, badInTop10: 2, badInTop20: 2 });
    // Fewer than 10 labeled: precision is over what exists.
    expect(m.p10).toBe(0.4);
    expect(m.p10Lenient).toBe(0.5);
  });

  it("skips unlabeled keys, so a ranking over a bigger pool measures only the labeled ones", () => {
    expect(rankingMetrics(["x", "a", "y", "d"], labels)).toMatchObject({ labeled: 2, p10: 1 });
  });

  it("gives nDCG 1 for the ideal order and less for a worse one", () => {
    expect(rankingMetrics(["a", "d", "c", "b", "e"], labels).ndcg20).toBe(1);
    expect(rankingMetrics(["b", "e", "c", "a", "d"], labels).ndcg20).toBeLessThan(0.7);
  });

  it("handles an empty ranking", () => {
    expect(rankingMetrics([], labels)).toMatchObject({ labeled: 0, p10: 0, ndcg20: 0 });
  });
});

describe("recall", () => {
  it("is the share of good postings inside the selected set", () => {
    expect(recall(new Set(["a", "b"]), labels)).toBe(0.5);
    expect(recall(new Set(), {})).toBe(0);
  });
});

describe("parseLabelInput", () => {
  it("reads single labels and ranges", () => {
    const m = parseLabelInput("1g 2B, 3m; 4-6 b");
    expect([...m]).toEqual([
      [1, "good"],
      [2, "bad"],
      [3, "maybe"],
      [4, "bad"],
      [5, "bad"],
      [6, "bad"],
    ]);
  });

  it("accepts a dot or colon between number and label", () => {
    expect([...parseLabelInput("1.b 22. g 3:m")]).toEqual([
      [1, "bad"],
      [22, "good"],
      [3, "maybe"],
    ]);
  });

  it("rejects anything it can't read", () => {
    expect(() => parseLabelInput("1g 2x")).toThrow(/2x/);
    expect(() => parseLabelInput("5-3 g")).toThrow(/range/);
  });
});
