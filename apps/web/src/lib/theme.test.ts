import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, THEME_COLORS, THEME_STORAGE_KEY, themeInitScript } from "./theme";

describe("resolveTheme", () => {
  it("follows the system for 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit choice win over the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("accepts only known values", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("blue")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

// The init script runs without React, so we run it against fake browser objects
// and check it agrees with resolveTheme.
function runInitScript(opts: { stored: string | null; systemDark: boolean; storageThrows?: boolean; withMeta?: boolean }) {
  const dataset: Record<string, string> = {};
  const meta = { content: "unset", setAttribute(_name: string, value: string) { this.content = value; } };
  const localStorage = {
    getItem(key: string) {
      if (opts.storageThrows) throw new Error("blocked");
      return key === THEME_STORAGE_KEY ? opts.stored : null;
    },
  };
  const window = { matchMedia: () => ({ matches: opts.systemDark }) };
  const document = {
    documentElement: { dataset },
    querySelector: () => (opts.withMeta === false ? null : meta),
  };
  new Function("localStorage", "window", "document", themeInitScript)(localStorage, window, document);
  return { theme: dataset["theme"], themeColor: meta.content };
}

describe("themeInitScript", () => {
  it("uses the system when nothing is stored", () => {
    expect(runInitScript({ stored: null, systemDark: true }).theme).toBe("dark");
    expect(runInitScript({ stored: null, systemDark: false }).theme).toBe("light");
  });

  it("prefers the stored choice over the system", () => {
    expect(runInitScript({ stored: "light", systemDark: true }).theme).toBe("light");
    expect(runInitScript({ stored: "dark", systemDark: false }).theme).toBe("dark");
  });

  it("treats an invalid stored value as 'system'", () => {
    expect(runInitScript({ stored: "blue", systemDark: true }).theme).toBe("dark");
  });

  it("still follows the system when storage is blocked", () => {
    expect(runInitScript({ stored: null, systemDark: true, storageThrows: true }).theme).toBe("dark");
    expect(runInitScript({ stored: null, systemDark: false, storageThrows: true }).theme).toBe("light");
  });

  it("sets the browser chrome color to match the theme", () => {
    expect(runInitScript({ stored: "dark", systemDark: false }).themeColor).toBe(THEME_COLORS.dark);
    expect(runInitScript({ stored: "light", systemDark: true }).themeColor).toBe(THEME_COLORS.light);
  });

  it("does not fail when the theme-color meta tag is missing", () => {
    expect(runInitScript({ stored: "dark", systemDark: false, withMeta: false }).theme).toBe("dark");
  });
});
