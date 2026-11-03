import type { ResumeStructure, TailoredResume } from "@/db/schema";
import { containsTerm } from "@/lib/text";

/** One word-level edit: kept, added or removed. */
export type WordOp = { op: "same" | "add" | "del"; text: string };

/** Word diff by longest common subsequence: resume bullets are short, so O(n·m) is fine. */
export function wordDiff(before: string, after: string): WordOp[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: WordOp[] = [];
  const push = (op: WordOp["op"], text: string) => {
    const last = ops[ops.length - 1];
    if (last?.op === op) last.text += ` ${text}`;
    else ops.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push("del", a[i++]);
    else push("add", b[j++]);
  }
  while (i < a.length) push("del", a[i++]);
  while (j < b.length) push("add", b[j++]);
  return ops;
}

export type BulletChange =
  | { status: "kept" | "moved"; text: string }
  | { status: "rephrased"; text: string; ops: WordOp[] }
  | { status: "dropped"; text: string };

export type EntryChanges = { id: string; label: string; bullets: BulletChange[] };
export type SectionChanges = {
  id: string;
  heading: string;
  /** Position in the tailored resume, then in the base. */
  moved: boolean;
  entries: EntryChanges[];
  items: { kept: string[]; dropped: string[]; reordered: boolean };
};
export type ResumeChanges = {
  summary: { status: "kept" | "rewritten" | "added" | "removed"; before: string | null; after: string | null; ops: WordOp[] };
  sections: SectionChanges[];
  counts: { kept: number; moved: number; rephrased: number; dropped: number };
};

/** What tailoring changed, against the base resume: every bullet kept, moved, rephrased or dropped. */
export function diffTailored(base: ResumeStructure, doc: TailoredResume): ResumeChanges {
  const counts = { kept: 0, moved: 0, rephrased: 0, dropped: 0 };
  const before = base.summary?.trim() || null;
  const after = doc.summary?.trim() || null;
  const summary: ResumeChanges["summary"] = {
    status: before === after ? "kept" : !before ? "added" : !after ? "removed" : "rewritten",
    before,
    after,
    ops: before && after && before !== after ? wordDiff(before, after) : [],
  };

  const sections: SectionChanges[] = doc.sections.flatMap((s, si) => {
    const bs = base.sections.find((x) => x.id === s.id);
    if (!bs) return [];
    const entries: EntryChanges[] = bs.entries.map((be) => {
      const te = s.entries.find((x) => x.id === be.id);
      const used = te?.bullets ?? [];
      const bullets: BulletChange[] = used.map((b, i) => {
        const bb = be.bullets.find((x) => x.id === b.sourceId);
        if (!bb) return { status: "kept", text: b.text };
        // Moved up: it now comes before a bullet it used to follow (leaving one out moves nothing).
        const at = (id: string) => be.bullets.findIndex((x) => x.id === id);
        const movedUp = used.slice(i + 1).some((later) => at(later.sourceId) >= 0 && at(later.sourceId) < at(bb.id));
        const status = bb.text === b.text ? (movedUp ? "moved" : "kept") : "rephrased";
        counts[status]++;
        return status === "rephrased" ? { status, text: b.text, ops: wordDiff(bb.text, b.text) } : { status, text: b.text };
      });
      for (const bb of be.bullets) {
        if (!used.some((b) => b.sourceId === bb.id)) {
          counts.dropped++;
          bullets.push({ status: "dropped", text: bb.text });
        }
      }
      return { id: be.id, label: [be.title, be.org].filter(Boolean).join(", ") || bs.heading, bullets };
    });
    const kept = s.items;
    return [
      {
        id: s.id,
        heading: bs.heading,
        moved: base.sections.indexOf(bs) !== si,
        entries,
        items: {
          kept,
          // A base item counts as kept when it, or a skill taken from it, is ("SQL" from "Proficient with SQL and AWS").
          dropped: bs.items.filter((i) => !kept.some((k) => k === i || containsTerm(i, k))),
          reordered: kept.join("\n") !== bs.items.filter((i) => kept.includes(i)).join("\n"),
        },
      },
    ];
  });
  return { summary, sections, counts };
}
