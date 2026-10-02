import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export type Result = APIGatewayProxyStructuredResultV2;

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): Result {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

export function redirect(location: string, cookies: string[] = []): Result {
  return { statusCode: 302, headers: { location, "cache-control": "no-store" }, cookies };
}

export function readCookie(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const all = event.cookies ?? event.headers?.cookie?.split(";") ?? [];
  for (const cookie of all) {
    const index = cookie.indexOf("=");
    if (index > 0 && cookie.slice(0, index).trim() === name) return cookie.slice(index + 1).trim();
  }
  return undefined;
}

// Host-only, HttpOnly, Secure, SameSite=Lax cookie on the API domain (docs/auth.md, Økt).
export function sessionCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

// CORS for the app's own origin only, with credentials.
export function corsHeaders(event: APIGatewayProxyEventV2, appOrigin: string): Record<string, string> {
  if (!appOrigin || event.headers?.origin !== appOrigin) return {};
  return {
    "access-control-allow-origin": appOrigin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

export function requestMeta(event: APIGatewayProxyEventV2) {
  return {
    ip: event.requestContext?.http?.sourceIp,
    userAgent: event.requestContext?.http?.userAgent ?? event.headers?.["user-agent"],
  };
}
