// The audio bucket (S3, SSE-KMS, TLS only). Browsers upload and play through short-lived
// presigned URLs; nothing is public.
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface AudioStore {
  presignPut(key: string, contentType: string): Promise<string>;
  presignGet(key: string, filename: string, contentType: string): Promise<string>;
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

// Uploads must be done within five minutes; playback links last ten.
const PUT_SECONDS = 300;
const GET_SECONDS = 600;

export function s3Store(bucket: string, client = new S3Client({})): AudioStore {
  return {
    presignPut: (key, contentType) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: PUT_SECONDS }),
    presignGet: (key, filename, contentType) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
          ResponseCacheControl: "no-store",
        }),
        { expiresIn: GET_SECONDS },
      ),
    async list(prefix) {
      const out: { key: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of page.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return res.Body!.transformToByteArray();
    },
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async delete(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        if (batch.length) {
          await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        }
      }
    },
  };
}

// Where a call's audio lives: chunks while recording, then one joined object.
export const callPrefix = (orgId: string, callId: string) => `${orgId}/${callId}/`;
export const chunkKey = (orgId: string, callId: string, seq: number) => `${callPrefix(orgId, callId)}chunks/${String(seq).padStart(5, "0")}`;
export const audioKey = (orgId: string, callId: string) => `${callPrefix(orgId, callId)}audio`;
// A piece for transcription while recording: a complete audio file of about 15 seconds.
export const pieceKey = (orgId: string, callId: string, seq: number) => `${callPrefix(orgId, callId)}pieces/${String(seq).padStart(5, "0")}`;
