// API Lambda behind API Gateway (HTTP API). For now only GET /health, which proves the whole
// chain: Lambda in the VPC, IAM sign-in to RDS over TLS as veriqall_api, under RLS.
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type pg from "pg";
import { iamPool } from "./db.ts";

type Result = APIGatewayProxyStructuredResultV2;

function json(statusCode: number, body: unknown): Result {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

// True when the database answers as a member of app_user (the role under RLS).
export type DatabaseCheck = () => Promise<boolean>;

export function poolCheck(pool: () => pg.Pool): DatabaseCheck {
  return async () => {
    const { rows } = await pool().query<{ ok: boolean }>(
      "select pg_has_role(current_user, 'app_user', 'member') as ok",
    );
    return rows[0]?.ok === true;
  };
}

export function createHandler(checkDatabase: DatabaseCheck) {
  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    if (event.requestContext.http.method === "GET" && event.rawPath === "/health") {
      try {
        if (await checkDatabase()) return json(200, { status: "ok" });
        console.error("health: database login is not a member of app_user");
      } catch (error) {
        // Details go to the log only, never to the caller.
        console.error("health: database check failed", error);
      }
      return json(503, { status: "unavailable" });
    }
    return json(404, { error: "Fant ikke ressursen" });
  };
}

let pool: pg.Pool | undefined;
export const handler = createHandler(poolCheck(() => (pool ??= iamPool("veriqall_api"))));
