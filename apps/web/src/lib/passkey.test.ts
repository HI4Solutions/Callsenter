import { describe, expect, it } from "vitest";
import { passkeyError, PasskeyNetworkError, suggestedPasskeyName } from "./passkey";

describe("passkey helpers", () => {
  it("turns browser errors into text keys, and keeps the API's own messages", () => {
    expect(passkeyError({ name: "NotAllowedError" })).toEqual({ key: "cancelled" });
    expect(passkeyError(new PasskeyNetworkError())).toEqual({ key: "noServer" });
    expect(passkeyError(new Error("Forespørselen er utløpt. Prøv igjen."))).toEqual({ message: "Forespørselen er utløpt. Prøv igjen." });
    expect(passkeyError(new Error(""))).toEqual({ key: "failed" });
  });

  it("suggests a device name", () => {
    expect(suggestedPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(suggestedPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("Mac");
    expect(suggestedPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
  });
});
