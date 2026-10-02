// A fake OpenID Connect provider for tests. It signs real id tokens and checks what a real
// provider checks: the code, the PKCE verifier, the redirect URI and the client credentials.
import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

export interface FakeUser {
  sub: string;
  name?: string;
  phone?: string;
}

export interface FakeIdpOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  // Vipps: profile from userinfo. BankID: from the id token.
  userinfo: boolean;
}

export async function createFakeIdp(options: FakeIdpOptions) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  const codes = new Map<string, { user: FakeUser; nonce: string; challenge: string; redirectUri: string }>();
  const accessTokens = new Map<string, FakeUser>();
  const tamper = { nonce: undefined as string | undefined, omitIdToken: false };

  const discovery = {
    issuer: options.issuer,
    authorization_endpoint: `${options.issuer}/authorize`,
    token_endpoint: `${options.issuer}/token`,
    userinfo_endpoint: `${options.issuer}/userinfo`,
    jwks_uri: `${options.issuer}/jwks`,
  };

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/.well-known/openid-configuration")) return reply(200, discovery);
    if (url.href === discovery.jwks_uri) return reply(200, { keys: [jwk] });

    if (url.href === discovery.token_endpoint) {
      const expected = `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`;
      const headers = new Headers(init?.headers);
      if (headers.get("authorization") !== expected) return reply(401, { error: "invalid_client" });
      const form = new URLSearchParams(String(init?.body));
      const grant = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!grant || grant.challenge !== challenge || grant.redirectUri !== form.get("redirect_uri")) {
        return reply(400, { error: "invalid_grant" });
      }
      const accessToken = randomUUID();
      accessTokens.set(accessToken, grant.user);
      const claims: Record<string, unknown> = { sub: grant.user.sub, nonce: tamper.nonce ?? grant.nonce };
      if (!options.userinfo) Object.assign(claims, { name: grant.user.name, acr: "urn:grn:authn:no:bankid" });
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(options.issuer)
        .setAudience(options.clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return reply(200, { access_token: accessToken, token_type: "Bearer", ...(tamper.omitIdToken ? {} : { id_token: idToken }) });
    }

    if (url.href === discovery.userinfo_endpoint) {
      const token = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
      const user = accessTokens.get(token);
      if (!user) return reply(401, { error: "invalid_token" });
      return reply(200, { sub: user.sub, name: user.name, phone_number: user.phone });
    }
    return reply(404, { error: "not found" });
  };

  return {
    fetch,
    tamper,
    // The user approves in the provider's app: returns the callback query for the redirect.
    approve(authorizationUrl: string, user: FakeUser): { code: string; state: string } {
      const url = new URL(authorizationUrl);
      const code = randomUUID();
      codes.set(code, {
        user,
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        redirectUri: url.searchParams.get("redirect_uri")!,
      });
      return { code, state: url.searchParams.get("state")! };
    },
  };
}
