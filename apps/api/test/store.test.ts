import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { s3Store } from "../src/calls/store.ts";

describe("upload URLs", () => {
  it("sign the size, so S3 refuses a body of any other length", async () => {
    const client = new S3Client({ region: "eu-north-1", credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "test" } });
    const url = new URL(await s3Store("bucket", client).presignPut("org/call/chunks/00000", "audio/webm", 1234));
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toContain("content-length");
  });
});
