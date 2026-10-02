import { describe, expect, it } from "vitest";
import { passkeyErrorMessage, suggestedPasskeyName } from "./passkey";

describe("passkey helpers", () => {
  it("explains browser errors in Norwegian", () => {
    expect(passkeyErrorMessage({ name: "NotAllowedError" })).toBe("Innloggingen med passkey ble avbrutt.");
    expect(passkeyErrorMessage(new Error("Forespørselen er utløpt. Prøv igjen."))).toBe("Forespørselen er utløpt. Prøv igjen.");
  });

  it("suggests a device name", () => {
    expect(suggestedPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(suggestedPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)")).toBe("Mac");
    expect(suggestedPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
  });
});
