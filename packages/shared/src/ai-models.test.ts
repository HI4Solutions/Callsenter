import { describe, expect, it } from "vitest";
import { AI_MODEL_KEYS, AI_MODELS, DEFAULT_AI_MODEL, isAiModelKey } from "./ai-models.ts";

describe("AI models", () => {
  it("uses EU inference profiles only, and the default is in the list", () => {
    for (const key of AI_MODEL_KEYS) expect(AI_MODELS[key].bedrockId).toMatch(/^eu\.anthropic\.claude-/);
    expect(isAiModelKey(DEFAULT_AI_MODEL)).toBe(true);
    expect(isAiModelKey("toString")).toBe(false);
  });
});
