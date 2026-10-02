import { describe, expect, it } from "vitest";
import { safeAppPath } from "./paths.ts";

describe("safe return paths", () => {
  it("keeps paths inside the app, with query and hash", () => {
    expect(safeAppPath("/")).toBe("/");
    expect(safeAppPath("/admin/brukere?q=kari#top")).toBe("/admin/brukere?q=kari#top");
    expect(safeAppPath("/administrasjon/team")).toBe("/administrasjon/team");
    // Dot segments are resolved, but only while the result stays a normal path.
    expect(safeAppPath("/admin/../konto")).toBe("/konto");
    expect(safeAppPath("/admin/brukere?q=%C3%A6%C3%B8%C3%A5")).toBe("/admin/brukere?q=%C3%A6%C3%B8%C3%A5");
  });

  it("refuses anything a browser could resolve to another site", () => {
    for (const bad of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\t\\evil.example",
      "/\n/evil.example",
      "/%09/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "/.//evil.example",
      "/%2e//evil.example",
      "/%2E//evil.example",
      "/a/..//evil.example",
      "/..//evil.example",
      "/a/%2e%2e//evil.example",
      "/.%2e//evil.example",
      "/./\\evil.example",
      "/a\u0000b",
      "/a\u007fb",
      "",
      `/${"a".repeat(600)}`,
    ]) {
      const result = safeAppPath(bad);
      if (result !== undefined) {
        // Whatever is kept must stay on our own origin when a browser resolves it.
        expect(new URL(result, "https://staging.veriqall.no").origin).toBe("https://staging.veriqall.no");
      }
    }
    expect(safeAppPath("/\t/evil.example")).toBeUndefined();
    expect(safeAppPath("//evil.example")).toBeUndefined();
    for (const dots of ["/.//evil.example", "/%2e//evil.example", "/a/..//evil.example", "/..//evil.example"]) {
      expect(safeAppPath(dots), dots).toBeUndefined();
    }
    expect(safeAppPath(undefined)).toBeUndefined();
  });
});
