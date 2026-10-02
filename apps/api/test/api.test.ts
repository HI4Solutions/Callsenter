import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { createHandler } from "../src/api.ts";

function request(method: string, rawPath: string) {
  return { rawPath, requestContext: { http: { method } } } as unknown as APIGatewayProxyEventV2;
}

describe("api handler", () => {
  it("reports healthy when the database answers as app_user", async () => {
    const res = await createHandler(async () => true)(request("GET", "/health"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ status: "ok" });
    expect(res.headers).toMatchObject({ "cache-control": "no-store" });
  });

  it("reports unavailable without leaking the error", async () => {
    const res = await createHandler(async () => {
      throw new Error("password authentication failed for user veriqall_api at 10.40.4.12");
    })(request("GET", "/health"));
    expect(res.statusCode).toBe(503);
    expect(res.body).toBe(JSON.stringify({ status: "unavailable" }));
  });

  it("reports unavailable when the login is not under RLS", async () => {
    const res = await createHandler(async () => false)(request("GET", "/health"));
    expect(res.statusCode).toBe(503);
  });

  it("answers 404 for anything else", async () => {
    const res = await createHandler(async () => true)(request("POST", "/health"));
    expect(res.statusCode).toBe(404);
  });
});
