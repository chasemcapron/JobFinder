import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AiRequestError,
  AiUnavailableError,
  GEMINI_BACKUP_MODEL,
  GEMINI_LITE_MODEL,
  geminiJson,
  geminiModels,
  toGeminiSchema,
} from "./gemini";

const Schema = z.object({ score: z.number(), reason: z.string() });

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const ok = (data: unknown) => reply({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }] });
const busy = () => reply({ error: { code: 503, message: "This model is currently experiencing high demand." } }, 503);
const limited = () => reply({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota)." } }, 429);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_MODEL", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const call = (over: Omit<Partial<Parameters<typeof geminiJson>[0]>, "schema"> = {}) =>
  geminiJson({ schema: Schema, system: "sys", prompt: "hi", ...over });
const modelOf = (i: number) => String(fetchMock.mock.calls[i][0]).match(/models\/([^:]+):/)?.[1];
const bodyOf = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

describe("geminiJson", () => {
  it("sends the key in a header and a schema Gemini accepts, and returns validated data", async () => {
    fetchMock.mockResolvedValueOnce(ok({ score: 82, reason: "SOC work" }));
    const { data, model } = await call();
    expect(data).toEqual({ score: 82, reason: "SOC work" });
    expect(model).toBe("gemini-3.8-flash");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("test-key");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = bodyOf(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.$schema).toBeUndefined();
    expect(body.generationConfig.responseJsonSchema.properties.score.type).toBe("number");
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
  });

  it("starts bulk work on Flash-Lite and doesn't send a thinking level to it", async () => {
    fetchMock.mockResolvedValueOnce(ok({ score: 1, reason: "x" }));
    await call({ tier: "fast" });
    expect(modelOf(0)).toBe(GEMINI_LITE_MODEL);
    expect(bodyOf(0).generationConfig.thinkingConfig).toBeUndefined();
    expect(geminiModels("fast")).toEqual([GEMINI_LITE_MODEL, GEMINI_BACKUP_MODEL, "gemini-3.8-flash"]);
    expect(geminiModels("quality")).toEqual(["gemini-3.8-flash", GEMINI_LITE_MODEL, GEMINI_BACKUP_MODEL]);
  });

  it("falls back to the next model when one is busy", async () => {
    fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(ok({ score: 40, reason: "ok" }));
    const { model } = await call();
    expect(model).toBe(GEMINI_LITE_MODEL);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back when a model returns output that doesn't match the schema", async () => {
    fetchMock.mockResolvedValueOnce(ok({ wrong: true })).mockResolvedValueOnce(ok({ score: 5, reason: "fine" }));
    expect((await call()).data.score).toBe(5);
  });

  it("reports rate limits so callers can stop early", async () => {
    fetchMock.mockResolvedValue(limited());
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.rateLimited).toBe(true);
    expect(err.message).toMatch(/free-tier limit/);
  });

  it("calls a busy free tier 'busy' rather than failing with an HTTP dump", async () => {
    fetchMock.mockResolvedValue(busy());
    await expect(call()).rejects.toThrow("Gemini is busy right now");
  });

  it("stops immediately on a rejected key instead of trying other models", async () => {
    fetchMock.mockResolvedValue(reply({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } }, 400));
    await expect(call()).rejects.toBeInstanceOf(AiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a cut-off answer as a failed attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ candidates: [{ content: { parts: [{ text: '{"score": 4' }] }, finishReason: "MAX_TOKENS" }] }))
      .mockResolvedValueOnce(ok({ score: 4, reason: "done" }));
    expect((await call()).data.reason).toBe("done");
  });

  it("ignores thought parts when reading the answer", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: '{"score":9,"reason":"r"}' }] }, finishReason: "STOP" }] }),
    );
    expect((await call()).data.score).toBe(9);
  });

  it("doesn't start an attempt past the deadline", async () => {
    await expect(call({ deadline: Date.now() + 500 })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("slow models", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** A reply that arrives after `ms`, or rejects like fetch when the request is aborted first. */
    const after = (ms: number, response: () => Response) => (_url: unknown, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(response()), ms);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });

    it("asks the next model once one is slow, and takes the first answer", async () => {
      fetchMock
        .mockImplementationOnce(after(60_000, () => ok({ score: 1, reason: "slow" })))
        .mockImplementationOnce(after(1_000, () => ok({ score: 2, reason: "quick" })));
      const pending = call({ hedgeAfterMs: 10_000, deadline: Date.now() + 45_000 });
      await vi.advanceTimersByTimeAsync(11_000);
      const { data, model } = await pending;
      expect(data.reason).toBe("quick");
      expect(model).toBe(GEMINI_LITE_MODEL);
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); // the slow request is dropped
    });

    it("keeps waiting for a slow model after the others fail", async () => {
      // The 2026-10-20 failure: 3.8 Flash busy, Flash-Lite answering only after ~21 s.
      fetchMock
        .mockImplementationOnce(after(100, busy))
        .mockImplementationOnce(after(21_000, () => ok({ score: 3, reason: "late" })))
        .mockImplementationOnce(after(500, busy));
      const pending = call({ hedgeAfterMs: 12_000, deadline: Date.now() + 45_000 });
      await vi.advanceTimersByTimeAsync(22_000);
      const { data, model } = await pending;
      expect(data.reason).toBe("late");
      expect(model).toBe(GEMINI_LITE_MODEL);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("gives up at the deadline and calls that busy", async () => {
      fetchMock.mockImplementation(after(120_000, () => ok({ score: 1, reason: "never" })));
      const pending = call({ hedgeAfterMs: 5_000, deadline: Date.now() + 20_000 }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      const err = await pending;
      expect(err).toBeInstanceOf(AiUnavailableError);
      expect(err.message).toMatch(/busy/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(err.attempts.every((a: { status: number | null }) => a.status === null)).toBe(true);
    });
  });

  it("refuses to run without a key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(call()).rejects.toBeInstanceOf(AiRequestError);
  });
});

describe("toGeminiSchema", () => {
  it("keeps descriptions and enums, drops $schema", () => {
    const s = toGeminiSchema(z.object({ level: z.enum(["entry", "mid"]).describe("next level") }));
    expect(s.$schema).toBeUndefined();
    expect(s).toMatchObject({ type: "object", properties: { level: { enum: ["entry", "mid"], description: "next level" } } });
  });
});
