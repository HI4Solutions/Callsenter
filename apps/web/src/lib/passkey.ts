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
    throw new PasskeyNetworkError();
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "");
  return data as T;
}

export class PasskeyNetworkError extends Error {
  override name = "PasskeyNetworkError";
}

// What went wrong, as a text key (login.passkeyErrors.<key>, or common.noServer), or the API's
// own message, which is already in the user's language.
export function passkeyError(error: unknown): { key: "cancelled" | "exists" | "insecure" | "failed" | "noServer" } | { message: string } {
  const name = (error as { name?: string }).name;
  if (name === "NotAllowedError" || name === "AbortError") return { key: "cancelled" };
  if (name === "InvalidStateError") return { key: "exists" };
  if (name === "SecurityError") return { key: "insecure" };
  if (name === "PasskeyNetworkError") return { key: "noServer" };
  const message = (error as Error).message;
  return message ? { message } : { key: "failed" };
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
  if (!res.ok) throw new Error(res.status === 401 ? "mustLogIn" : "listFailed");
  return (await res.json()) as MyPasskey[];
}

export async function removePasskey(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/me/passkeys/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) throw new Error("removeFailed");
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
