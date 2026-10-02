// Calls to the API with the session cookie. Kept small and free of portal code: the header
// (on every page, also the login page) imports it, and nothing internal should ship with it.
import { API_URL } from "./auth";

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

// Any API call with the session cookie; errors carry the API's Norwegian message.
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AdminError("Får ikke kontakt med serveren. Prøv igjen.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new AdminError(data.error ?? "Noe gikk galt.", res.status, data.code);
  return data as T;
}
