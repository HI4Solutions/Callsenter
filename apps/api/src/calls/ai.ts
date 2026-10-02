// Claude on Amazon Bedrock (docs/plan.md, section 13) through the Converse API and EU
// cross-region inference profiles, so prompts and transcripts are processed in the EU only.
// Superadmins choose the model under System (AI_MODELS in packages/shared).
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

export interface AiResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Ai {
  structured<T>(model: string, system: string, prompt: string, schema: Record<string, unknown>): Promise<AiResult<T>>;
  text(model: string, system: string, prompt: string): Promise<AiResult<string>>;
}

export class AiError extends Error {}

const TOOL = "record_result";

export function bedrockAi(region: string, client = new BedrockRuntimeClient({ region, maxAttempts: 4 })): Ai {
  function usage(model: string, out: ConverseCommandOutput) {
    return { model, inputTokens: out.usage?.inputTokens ?? 0, outputTokens: out.usage?.outputTokens ?? 0 };
  }
  return {
    // Structured output through a forced tool call: the model must answer with input that
    // matches the schema.
    async structured<T>(model: string, system: string, prompt: string, schema: Record<string, unknown>) {
      const out = await client.send(
        new ConverseCommand({
          modelId: model,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 8000, temperature: 0 },
          toolConfig: {
            tools: [{ toolSpec: { name: TOOL, description: "Record the result of the check.", inputSchema: { json: schema as never } } }],
            toolChoice: { tool: { name: TOOL } },
          },
        }),
      );
      const call = out.output?.message?.content?.find((c) => c.toolUse?.name === TOOL)?.toolUse;
      if (!call?.input) throw new AiError(`no structured result (stop reason ${out.stopReason})`);
      return { data: call.input as T, ...usage(model, out) };
    },
    async text(model: string, system: string, prompt: string) {
      const out = await client.send(
        new ConverseCommand({
          modelId: model,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: { maxTokens: 4000, temperature: 0.2 },
        }),
      );
      const text = (out.output?.message?.content ?? []).map((c) => c.text ?? "").join("");
      if (!text.trim()) throw new AiError(`empty report (stop reason ${out.stopReason})`);
      return { data: text, ...usage(model, out) };
    },
  };
}
