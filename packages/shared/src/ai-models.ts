// The Claude models a superadmin can choose for AI control and reports (System). All run on
// Amazon Bedrock through EU cross-region inference profiles (eu.*), so requests are processed in
// EU regions only. The database stores the key; the Bedrock id is looked up here.

export const AI_MODELS = {
  "sonnet-4-6": { name: "Claude Sonnet 4.6", bedrockId: "eu.anthropic.claude-sonnet-4-6", description: "God balanse mellom kvalitet, fart og pris." },
  "sonnet-4-5": { name: "Claude Sonnet 4.5", bedrockId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0", description: "Forrige Sonnet." },
  "opus-4-5": { name: "Claude Opus 4.5", bedrockId: "eu.anthropic.claude-opus-4-5-20251101-v1:0", description: "Grundigst, dyrest og tregest." },
  "haiku-4-5": { name: "Claude Haiku 4.5", bedrockId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0", description: "Raskest og rimeligst." },
} as const satisfies Record<string, { name: string; bedrockId: string; description: string }>;

export type AiModelKey = keyof typeof AI_MODELS;

export const AI_MODEL_KEYS = Object.keys(AI_MODELS) as AiModelKey[];

export const DEFAULT_AI_MODEL: AiModelKey = "sonnet-4-6";

export function isAiModelKey(value: unknown): value is AiModelKey {
  return typeof value === "string" && Object.hasOwn(AI_MODELS, value);
}
