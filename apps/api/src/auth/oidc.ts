// A small OpenID Connect client for the authorization code flow with PKCE, shared by Vipps
// and Idura (BankID). Everything happens on the server; the browser never sees codes or tokens.
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { AuthFailure, type Identity, type Provider, type ProviderSettings } from "./types.ts";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri: string;
}

// Cached per Lambda container.
const discoveryCache = new Map<string, Promise<Discovery>>();
const jwksCache = new Map<string, ReturnType<typeof createLocalJWKSet>>();

async function getJson<T>(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(url, init);
  if (!res.ok) {
    // Status and body only; never tokens or codes (docs/auth.md, Logging).
    const body = (await res.text()).slice(0, 500);
    throw new AuthFailure("feil", "error", `${init?.method ?? "GET"} ${new URL(url).pathname} -> ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export function discover(fetcher: typeof fetch, settings: ProviderSettings): Promise<Discovery> {
  let cached = discoveryCache.get(settings.discoveryUrl);
  if (!cached) {
    cached = getJson<Discovery>(fetcher, settings.discoveryUrl);
    cached.catch(() => discoveryCache.delete(settings.discoveryUrl));
    discoveryCache.set(settings.discoveryUrl, cached);
  }
  return cached;
}

export function clearOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

export async function authorizationUrl(
  fetcher: typeof fetch,
  settings: ProviderSettings,
  params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
): Promise<string> {
  const discovery = await discover(fetcher, settings);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", settings.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", settings.scope);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (settings.acrValues) url.searchParams.set("acr_values", settings.acrValues);
  return url.toString();
}

async function verifyIdToken(
  fetcher: typeof fetch,
  settings: ProviderSettings,
  discovery: Discovery,
  idToken: string,
  nonce: string,
): Promise<JWTPayload> {
  let keys = jwksCache.get(discovery.jwks_uri);
  if (!keys) {
    keys = createLocalJWKSet(await getJson<JSONWebKeySet>(fetcher, discovery.jwks_uri));
    jwksCache.set(discovery.jwks_uri, keys);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: discovery.issuer,
      audience: settings.clientId,
    }));
  } catch (error) {
    // A rotated signing key: refresh once.
    if ((error as { code?: string }).code === "ERR_JWKS_NO_MATCHING_KEY") {
      jwksCache.delete(discovery.jwks_uri);
      return verifyIdToken(fetcher, settings, discovery, idToken, nonce);
    }
    throw new AuthFailure("feil", "invalid", `id token rejected: ${(error as Error).message}`);
  }
  if (!payload.nonce || payload.nonce !== nonce) {
    throw new AuthFailure("feil", "invalid", "id token nonce missing or wrong");
  }
  return payload;
}

function stringClaim(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

// Exchanges the code and returns the identity. Raw claims are not kept: only sub, name,
// phone and acr leave this function.
export async function completeLogin(
  fetcher: typeof fetch,
  provider: Provider,
  settings: ProviderSettings,
  params: { code: string; redirectUri: string; codeVerifier: string; nonce: string },
): Promise<Identity> {
  const discovery = await discover(fetcher, settings);
  const basic = Buffer.from(
    `${encodeURIComponent(settings.clientId)}:${encodeURIComponent(settings.clientSecret)}`,
  ).toString("base64");
  const tokens = await getJson<{ id_token?: string; access_token?: string }>(fetcher, discovery.token_endpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      ...settings.tokenHeaders,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }).toString(),
  });

  const claims = tokens.id_token
    ? await verifyIdToken(fetcher, settings, discovery, tokens.id_token, params.nonce)
    : undefined;
  if (!claims && !settings.useUserinfo) {
    throw new AuthFailure("feil", "invalid", "no id token");
  }

  let profile: Record<string, unknown> = claims ?? {};
  if (settings.useUserinfo) {
    if (!tokens.access_token || !discovery.userinfo_endpoint) {
      throw new AuthFailure("feil", "invalid", "no access token or userinfo endpoint");
    }
    // The access token lasts ten minutes; fetch right away and never keep it.
    const userinfo = await getJson<Record<string, unknown>>(fetcher, discovery.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (claims?.sub && userinfo.sub !== claims.sub) {
      throw new AuthFailure("feil", "invalid", "userinfo sub differs from id token");
    }
    profile = userinfo;
  }

  const subject = stringClaim(profile, "sub");
  if (!subject) {
    console.error(`[${provider}] identity without sub; keys: ${Object.keys(profile).join(",")}`);
    throw new AuthFailure("feil", "invalid", "identity without sub");
  }
  // BankID: the level comes from the signed id token. What we asked for in acr_values passed
  // through the browser, so it proves nothing; another e-ID method would give another acr.
  const acr = stringClaim((claims ?? {}) as Record<string, unknown>, "acr");
  if (settings.acrValues && acr !== settings.acrValues) {
    throw new AuthFailure("feil", "invalid", `unexpected acr: ${acr ?? "none"}`);
  }
  return {
    provider,
    subject,
    name: stringClaim(profile, "name"),
    phone: stringClaim(profile, "phone_number", "phoneNumber"),
    acr,
  };
}
