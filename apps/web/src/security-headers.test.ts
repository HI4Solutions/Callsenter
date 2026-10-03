import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("security headers", () => {
  it("keep the app out of other sites' frames, the acceptance link out of referrers, and the browser to what the recorder needs", async () => {
    const rules = await config.headers!();
    // Every rule applies to the pages behind login (the landing page, once published, is the
    // only exception, and only for X-Robots-Tag).
    const header = (key: string) => rules.flatMap((r) => r.headers).find((h) => h.key === key)?.value;
    expect(header("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Referrer-Policy")).toBe("no-referrer");
    expect(header("Strict-Transport-Security")).toMatch(/^max-age=\d{8}/);
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Permissions-Policy")).toContain("microphone=(self)");
    expect(header("Permissions-Policy")).toContain("display-capture=(self)");
    expect(header("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
