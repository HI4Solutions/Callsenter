// Passkeys (WebAuthn) against the API. The ceremony runs here, on the app's origin; the API
// checks the response and sets the session cookie.
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { API_URL } from "./auth";

export interface MyPasskey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Får ikke kontakt med serveren. Prøv igjen.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Noe gikk galt.");
  return data as T;
}

// The browser's own errors (cancelled, timed out, no passkey) in Norwegian.
export function passkeyErrorMessage(error: unknown): string {
  const name = (error as { name?: string }).name;
  if (name === "NotAllowedError" || name === "AbortError") return "Innloggingen med passkey ble avbrutt.";
  if (name === "InvalidStateError") return "Denne enheten har allerede en passkey for kontoen din.";
  if (name === "SecurityError") return "Passkey virker ikke på denne adressen.";
  return (error as Error).message || "Noe gikk galt med passkeyen.";
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

export async function loginWithPasskey(next?: string): Promise<string> {
  const { challengeId, options } = await post<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
    "/auth/passkey/login/options",
  );
  const response = await startAuthentication({ optionsJSON: options });
  const result = await post<{ location: string }>("/auth/passkey/login/verify", { challengeId, response, next });
  return result.location;
}

export async function addPasskey(name: string): Promise<void> {
  const { challengeId, options } = await post<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
    "/auth/passkey/register/options",
  );
  const response = await startRegistration({ optionsJSON: options });
  await post("/auth/passkey/register/verify", { challengeId, response, name });
}

export async function listPasskeys(): Promise<MyPasskey[]> {
  const res = await fetch(`${API_URL}/me/passkeys`, { credentials: "include" });
  if (!res.ok) throw new Error(res.status === 401 ? "Du må logge inn." : "Kunne ikke hente passkeys.");
  return (await res.json()) as MyPasskey[];
}

export async function removePasskey(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/me/passkeys/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("Kunne ikke fjerne passkeyen.");
}

// A suggested name from the browser, for example "Mac" or "iPhone".
export function suggestedPasskeyName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  return "Passkey";
}
