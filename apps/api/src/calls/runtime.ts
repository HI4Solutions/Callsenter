// Builds the call services from the Lambda environment: AUDIO_BUCKET, WORKER_FUNCTION,
// BEDROCK_REGION and BEDROCK_MODEL, and SONIOX_API_KEY from the app secret.
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { loadAppSecret } from "../config.ts";
import { type Ai, bedrockAi } from "./ai.ts";
import type { CallServices } from "./services.ts";
import { Soniox } from "./soniox.ts";
import { s3Store } from "./store.ts";

export async function loadSoniox(): Promise<Soniox | null> {
  const key = (await loadAppSecret()).SONIOX_API_KEY;
  return key ? new Soniox(key, fetch, process.env.SONIOX_API_HOST || undefined) : null;
}

export function loadAi(): Ai | null {
  const region = process.env.BEDROCK_REGION;
  return region ? bedrockAi(region) : null;
}

export async function loadCallServices(): Promise<CallServices | undefined> {
  const bucket = process.env.AUDIO_BUCKET;
  const workerFunction = process.env.WORKER_FUNCTION;
  if (!bucket || !workerFunction) return undefined;
  const lambda = new LambdaClient({});
  return {
    store: s3Store(bucket),
    soniox: await loadSoniox(),
    async startWorker(callId, reportId) {
      await lambda.send(
        new InvokeCommand({
          FunctionName: workerFunction,
          InvocationType: "Event",
          Payload: new TextEncoder().encode(JSON.stringify({ ...(callId && { callId }), ...(reportId && { reportId }) })),
        }),
      );
    },
  };
}
