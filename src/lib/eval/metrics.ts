/**
 * Ranking-quality metrics for the matching eval (scripts/eval-matching.ts). Pure, so the
 * numbers that decide whether a matching change helped are themselves unit-tested.
 */

export type Label = "good" | "maybe" | "bad";

export const LABELS: Record<string, Label> = { g: "good", m: "maybe", b: "bad" };

export type RankingMetrics = {
  /** Labeled postings in the ranking. */
  labeled: number;
  good: number;
  maybe: number;
  bad: number;
  /** Share of the top k that are good (strict) or good + half of maybe (lenient). */
  p10: number;
  p10Lenient: number;
  p20: number;
  p20Lenient: number;
  badInTop10: number;
  badInTop20: number;
  /** Normalized discounted cumulative gain over the top 20 (good 2, maybe 1, bad 0). */
  ndcg20: number;
};

const GAIN: Record<Label, number> = { good: 2, maybe: 1, bad: 0 };
const CREDIT: Record<Label, number> = { good: 1, maybe: 0.5, bad: 0 };

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}

function precision(top: Label[], k: number, credit: (l: Label) => number) {
  if (top.length === 0) return 0;
  return round(top.slice(0, k).reduce((n, l) => n + credit(l), 0) / Math.min(k, top.length));
}

function dcg(labels: Label[]) {
  return labels.reduce((sum, l, i) => sum + GAIN[l] / Math.log2(i + 2), 0);
}

/**
 * Scores a ranking (best first) against the user's labels. Unlabeled keys are skipped, so a
 * ranking over a larger pool still measures only what was labeled. Precision divides by
 * min(k, labeled), so a short fixture isn't penalized for having fewer than k postings.
 */
export function rankingMetrics(ranked: string[], labels: Record<string, Label>): RankingMetrics {
  const seq = ranked.flatMap((key) => (labels[key] ? [labels[key]] : []));
  const ideal = [...seq].sort((a, b) => GAIN[b] - GAIN[a]);
  const idealDcg = dcg(ideal.slice(0, 20));
  return {
    labeled: seq.length,
    good: seq.filter((l) => l === "good").length,
    maybe: seq.filter((l) => l === "maybe").length,
    bad: seq.filter((l) => l === "bad").length,
    p10: precision(seq, 10, (l) => (l === "good" ? 1 : 0)),
    p10Lenient: precision(seq, 10, (l) => CREDIT[l]),
    p20: precision(seq, 20, (l) => (l === "good" ? 1 : 0)),
    p20Lenient: precision(seq, 20, (l) => CREDIT[l]),
    badInTop10: seq.slice(0, 10).filter((l) => l === "bad").length,
    badInTop20: seq.slice(0, 20).filter((l) => l === "bad").length,
    ndcg20: idealDcg === 0 ? 0 : round(dcg(seq.slice(0, 20)) / idealDcg),
  };
}

/** Share of good postings that made it into `selected` (e.g. the set the AI scores). */
export function recall(selected: Set<string>, labels: Record<string, Label>, want: Label = "good"): number {
  const wanted = Object.entries(labels).filter(([, l]) => l === want);
  if (wanted.length === 0) return 0;
  return round(wanted.filter(([key]) => selected.has(key)).length / wanted.length);
}

/**
 * Parses chat-style labels: "1g 2b 3m", "1.b 2. g" or "1-3 g, 4 b". Numbers refer to the order the
 * postings were shown in. Returns number → label; throws on anything it can't read.
 */
export function parseLabelInput(input: string): Map<number, Label> {
  const out = new Map<number, Label>();
  const re = /(\d+)(?:\s*-\s*(\d+))?\s*[.:)]?\s*([gmb])\b/gi;
  for (const m of input.matchAll(re)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from) throw new Error(`Bad range "${m[0]}"`);
    for (let n = from; n <= to; n++) out.set(n, LABELS[m[3].toLowerCase()]);
  }
  const leftover = input.replace(re, "").replace(/[\s,;]+/g, "");
  if (leftover) throw new Error(`Couldn't read "${leftover}" (use e.g. "1g 2b 3m" or "4-6 g")`);
  return out;
}
