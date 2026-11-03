import { describe, expect, it } from "vitest";
import { EVAL_VERSION, evaluationFromFit, federalGradeGuard, fromAiEval, overallScore, ruleEvaluation, type JobEval } from "./evaluation";

const strong: JobEval = {
  id: "j1",
  roleFit: "on_target",
  seniorityFit: "fits",
  skillsCoverage: "strong",
  locationFit: "ok",
  matchedSkills: ["SQL", "Power BI"],
  missingSkills: [],
  blockers: [],
  verdict: "apply",
  score: 92,
  reason: "SQL and Power BI reporting match the posting's core duties",
};

describe("overallScore", () => {
  it("puts a strong on-target fit in the top band", () => {
    expect(overallScore(strong)).toBeGreaterThanOrEqual(90);
  });

  it("keeps the number in the verdict's band", () => {
    expect(overallScore({ ...strong, verdict: "skip" })).toBeLessThanOrEqual(30);
    const maybe = overallScore({ ...strong, verdict: "maybe" });
    expect(maybe).toBeGreaterThanOrEqual(35);
    expect(maybe).toBeLessThanOrEqual(74);
    expect(overallScore({ ...strong, skillsCoverage: "weak", seniorityFit: "stretch", score: 20 })).toBeGreaterThanOrEqual(55);
  });

  it("caps off-target roles and hard stops, whatever the model's own number", () => {
    expect(overallScore({ ...strong, roleFit: "off_target", score: 95 })).toBeLessThanOrEqual(20);
    expect(overallScore({ ...strong, blockers: ["Needs an active clearance"], verdict: "maybe" })).toBeLessThanOrEqual(35);
  });

  it("orders adjacent and stretch roles below on-target ones", () => {
    const adjacent = overallScore({ ...strong, roleFit: "adjacent", verdict: "maybe" });
    const stretch = overallScore({ ...strong, seniorityFit: "stretch", skillsCoverage: "partial" });
    expect(adjacent).toBeLessThan(overallScore(strong));
    expect(stretch).toBeLessThan(overallScore(strong));
  });
});

describe("fromAiEval", () => {
  it("never leaves an off-target role or a blocked one at 'apply'", () => {
    expect(fromAiEval({ ...strong, roleFit: "off_target" }).verdict).toBe("skip");
    expect(fromAiEval({ ...strong, blockers: ["Requires a CPA license"] }).verdict).toBe("maybe");
  });

  it("turns a skip the rubric doesn't allow (e.g. location alone) into maybe", () => {
    expect(fromAiEval({ ...strong, verdict: "skip", locationFit: "mismatch" }).verdict).toBe("maybe");
    expect(fromAiEval({ ...strong, verdict: "skip", seniorityFit: "too_senior" }).verdict).toBe("skip");
    expect(fromAiEval({ ...strong, verdict: "skip", blockers: ["Requires an active TS/SCI"] }).verdict).toBe("skip");
  });

  it("trims and de-duplicates the lists and stores the model's number for comparison", () => {
    const out = fromAiEval({ ...strong, matchedSkills: ["SQL", "SQL ", "", "Excel", "Python", "R", "Tableau", "Looker", "dbt"], score: 104 });
    expect(out.evaluation.matchedSkills).toEqual(["SQL", "Excel", "Python", "R", "Tableau", "Looker"]);
    expect(out.evaluation).toMatchObject({ version: EVAL_VERSION, source: "ai", holistic: 100 });
  });
});

describe("federalGradeGuard", () => {
  const graded: JobEval = {
    ...strong,
    seniorityFit: "too_senior",
    verdict: "skip",
    blockers: ["1 year specialized experience at GS-14 level"],
  };
  const federal = { source: "usajobs", title: "IT Specialist", minYears: null };

  it("turns a federal role hidden only for its pay grade into a visible maybe", () => {
    const out = fromAiEval(federalGradeGuard(graded, federal, false));
    expect(out.verdict).toBe("maybe");
    expect(out.evaluation).toMatchObject({ seniorityFit: "stretch", blockers: [] });
  });

  it("keeps the skip when the title or stated years say too senior, and leaves other sources alone", () => {
    expect(fromAiEval(federalGradeGuard(graded, { ...federal, title: "Supervisory IT Specialist" }, true)).verdict).toBe("skip");
    expect(fromAiEval(federalGradeGuard(graded, { ...federal, minYears: 6 }, false)).verdict).toBe("skip");
    expect(fromAiEval(federalGradeGuard(graded, { ...federal, source: "greenhouse" }, false)).verdict).toBe("skip");
    // Non-grade blockers stay.
    const cleared = { ...graded, blockers: ["Requires an active TS/SCI"] };
    expect(fromAiEval(federalGradeGuard(cleared, federal, false)).verdict).toBe("skip");
  });
});

describe("evaluationFromFit", () => {
  const fit = {
    fitScore: 68,
    verdict: "good" as const,
    summary: "",
    strengths: [],
    gaps: [],
    missingKeywords: [],
    resumeTips: [],
    requirements: [
      { requirement: "SQL", importance: "critical" as const, match: "strong" as const, evidence: "" },
      { requirement: "Tableau", importance: "high" as const, match: "missing" as const, evidence: "" },
    ],
  };

  it("takes the fit check's verdict and score, and drops batch ratings that could contradict it", () => {
    const batch = fromAiEval({ ...strong, roleFit: "off_target", blockers: ["Requires RN licence"] }).evaluation;
    const out = evaluationFromFit(fit, batch, []);
    expect(out).toMatchObject({ verdict: "apply", score: 68 });
    expect(out.evaluation.blockers).toEqual([]);
    expect(out.evaluation.roleFit).toBeUndefined();
    expect(out.evaluation.matchedSkills).toEqual(batch.matchedSkills);
  });

  it("fills matched and missing from the requirements table when there's no batch evaluation", () => {
    expect(evaluationFromFit(fit, null, []).evaluation).toMatchObject({ matchedSkills: ["SQL"], missingSkills: ["Tableau"] });
  });

  it("keeps a job the user's fixed rules rule out at skip", () => {
    const out = evaluationFromFit({ ...fit, fitScore: 88, verdict: "strong" }, ruleEvaluation(["Military branch"]), ["Military branch"]);
    expect(out).toMatchObject({ verdict: "skip", score: 30, evaluation: { source: "rule", blockers: ["Military branch"] } });
  });
});

describe("ruleEvaluation", () => {
  it("records only the blockers", () => {
    expect(ruleEvaluation(["Internship"])).toEqual({ version: EVAL_VERSION, source: "rule", matchedSkills: [], missingSkills: [], blockers: ["Internship"] });
  });
});
