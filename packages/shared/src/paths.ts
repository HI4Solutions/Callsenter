// A path inside the app to return to after login, or undefined. Used by the web app (?neste=)
// and by the API (the OIDC return path and the passkey login), so both apply the same rule.
//
// Browsers strip tabs and newlines from URLs and read a backslash as a slash, so "/\t/evil.example"
// or "/\evil.example" would leave the site. Anything with control characters or backslashes,
// also percent-encoded, is refused, and what is kept must resolve to our own origin.
const MAX_LENGTH = 512;
const BASE = "https://app.invalid";

export function safeAppPath(next: string | undefined | null): string | undefined {
  if (!next || next.length > MAX_LENGTH) return undefined;
  if (/[\u0000-\u001f\u007f\\]/.test(next) || /%(?:[01][0-9a-f]|7f|5c)/i.test(next)) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== BASE) return undefined;
  return url.pathname + url.search + url.hash;
}
