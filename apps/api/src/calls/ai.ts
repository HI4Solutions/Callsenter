// Claude through Amazon Bedrock (docs/plan.md: AI). Structured output for the AI control, plain
// text for reports.
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";

export interface AiResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Ai {
  structured<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<AiResult<T>>;
  text(system: string, prompt: string): Promise<AiResult<string>>;
}

export class AiRefusal extends Error {}

export function bedrockAi(region: string, model: string): Ai {
  const client = new AnthropicBedrockMantle({ awsRegion: region, maxRetries: 3, timeout: 5 * 60_000 });
  async function create(system: string, prompt: string, schema?: Record<string, unknown>) {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium", ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    });
    if (response.stop_reason === "refusal") throw new AiRefusal("the model declined");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
  return {
    async structured<T>(system: string, prompt: string, schema: Record<string, unknown>) {
      const r = await create(system, prompt, schema);
      return { data: JSON.parse(r.text) as T, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
    async text(system, prompt) {
      const r = await create(system, prompt);
      return { data: r.text, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens };
    },
  };
}
