import type pg from "pg";
import type { CallServices } from "../calls/services.ts";

export type Provider = "vipps" | "bankid";
export const PROVIDERS: readonly Provider[] = ["vipps", "bankid"];

// How a session was started: an OIDC provider, or a passkey (WebAuthn).
export type LoginMethod = Provider | "passkey";

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export interface ProviderSettings {
  // OpenID Connect discovery document.
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  acrValues?: string;
  // Extra headers on the token request (Vipps wants its subscription key there).
  tokenHeaders?: Record<string, string>;
  // Vipps: profile data comes from userinfo. Idura: from the id token.
  useUserinfo: boolean;
}

export interface AuthConfig {
  appOrigin: string;
  // Public base URL of the API, e.g. https://api.staging.veriqall.no. Callback URIs are built
  // from it and must match what is registered with each provider, character for character.
  callbackBase: string;
  providers: Partial<Record<Provider, ProviderSettings>>;
}

export interface AuthDeps {
  config: AuthConfig;
  // Pool for the login role (app_auth).
  authDb: pg.Pool;
  // Pool for the API role (app_user, under RLS).
  appDb: pg.Pool;
  fetch: typeof fetch;
  now: () => Date;
  // Recordings, transcription and the worker (phase 2). Absent where they are not set up.
  calls?: CallServices;
}

// Codes the web app turns into Norwegian messages on the login page (?feil=...).
export type LoginError =
  | "avbrutt"
  | "utlopt"
  | "ukjent"
  | "invitasjon"
  | "deaktivert"
  | "allerede_koblet"
  | "ikke_satt_opp"
  | "feil";

export class AuthFailure extends Error {
  readonly code: LoginError;
  readonly result: "cancelled" | "unknown_identity" | "invalid" | "error";

  constructor(code: LoginError, result: AuthFailure["result"], message: string) {
    super(message);
    this.code = code;
    this.result = result;
  }
}

export interface Identity {
  provider: Provider;
  subject: string;
  name?: string;
  phone?: string;
  acr?: string;
}

export const SESSION_COOKIE = "vq_session";
