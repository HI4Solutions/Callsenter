import { describe, expect, it } from "vitest";
import { isThemePreference, resolveTheme, THEME_STORAGE_KEY, themeInitScript } from "./theme";

describe("resolveTheme", () => {
  it("følger systemet ved «system»", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lar eksplisitt valg slå systemet", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("isThemePreference", () => {
  it("godtar bare kjente verdier", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("blue")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

// Init-skriptet kjører uten React, så vi kjører det mot falske nettleserobjekter
// og passer på at det gir samme svar som resolveTheme.
function runInitScript(stored: string | null, systemDark: boolean, storageThrows = false) {
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem(key: string) {
      if (storageThrows) throw new Error("blokkert");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const window = { matchMedia: () => ({ matches: systemDark }) };
  new Function("localStorage", "window", "document", themeInitScript)(localStorage, window, { documentElement });
  return documentElement.dataset.theme;
}

describe("themeInitScript", () => {
  it("bruker systemet når ingenting er lagret", () => {
    expect(runInitScript(null, true)).toBe("dark");
    expect(runInitScript(null, false)).toBe("light");
  });

  it("bruker lagret valg foran systemet", () => {
    expect(runInitScript("light", true)).toBe("light");
    expect(runInitScript("dark", false)).toBe("dark");
  });

  it("behandler ugyldig lagret verdi som «system»", () => {
    expect(runInitScript("blue", true)).toBe("dark");
  });

  it("feiler ikke når lagring er blokkert", () => {
    expect(() => runInitScript(null, true, true)).not.toThrow();
  });
});
