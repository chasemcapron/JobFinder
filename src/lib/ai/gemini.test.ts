import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, GEMINI_LITE_MODEL, geminiJson, geminiModels, toGeminiSchema } from "./gemini";

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
    expect(geminiModels("fast")).toEqual([GEMINI_LITE_MODEL, "gemini-3.8-flash"]);
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
