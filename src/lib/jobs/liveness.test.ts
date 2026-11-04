import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLiveness, checkWorkdayLiveness, workdayPostingApi } from "./liveness";

afterEach(() => vi.unstubAllGlobals());

const URL = "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin-TX/Data-Analyst_R123";
const answer = (status: number, body: unknown = {}) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));

describe("workdayPostingApi", () => {
  it("turns a posting's page URL into its JSON endpoint, with or without a locale", () => {
    expect(workdayPostingApi(URL)).toBe("https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/Austin-TX/Data-Analyst_R123");
    expect(workdayPostingApi("https://acme.wd5.myworkdayjobs.com/Careers/job/X/Y_R1?source=LinkedIn")).toBe(
      "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/Careers/job/X/Y_R1",
    );
    expect(workdayPostingApi("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
  });
});

describe("checkWorkdayLiveness", () => {
  it("is live only when the posting answers with its details", async () => {
    answer(200, { jobPostingInfo: { id: "1" } });
    expect(await checkWorkdayLiveness(URL)).toBe("live");
    answer(200, { somethingElse: true });
    expect(await checkWorkdayLiveness(URL)).toBe("uncertain");
  });

  it("is closed on 404, 410, or a 403 with Workday's withdrawn code", async () => {
    for (const status of [404, 410]) {
      answer(status);
      expect(await checkWorkdayLiveness(URL)).toBe("closed");
    }
    answer(403, { errorCode: "S22", httpStatus: 403 });
    expect(await checkWorkdayLiveness(URL)).toBe("closed");
  });

  it("is uncertain on anything ambiguous: another 403, 429, 5xx, a network error, an unknown URL", async () => {
    answer(403, "<html>Just a moment...</html>");
    expect(await checkWorkdayLiveness(URL)).toBe("uncertain");
    for (const status of [429, 503]) {
      answer(status);
      expect(await checkWorkdayLiveness(URL)).toBe("uncertain");
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("socket hang up"))));
    expect(await checkWorkdayLiveness(URL)).toBe("uncertain");
    expect(await checkWorkdayLiveness("https://example.com/job")).toBe("uncertain");
  });
});

describe("checkLiveness", () => {
  it("checks only Workday postings", async () => {
    answer(404);
    const out = await checkLiveness([
      { id: "w", source: "workday", applyUrl: URL },
      { id: "g", source: "greenhouse", applyUrl: "https://boards.greenhouse.io/acme/jobs/1" },
    ]);
    expect([...out]).toEqual([["w", "closed"]]);
  });
});
