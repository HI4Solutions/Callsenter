import { afterEach, describe, expect, it } from "vitest";
import { kr, percent } from "./billing";
import { setFormatLocale } from "./format";

// Intl puts no-break spaces between the digits and the currency; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, " ");
// kr() and percent() use no common words.
const text: Parameters<typeof setFormatLocale>[1] = (key) => key;

describe("amounts follow the page language", () => {
  afterEach(() => setFormatLocale("nb-NO", text));

  it("shows kroner with two decimals in Norwegian", () => {
    expect(plain(kr(1234.5))).toBe("1 234,50 kr");
    expect(plain(kr("0"))).toBe("0,00 kr");
    expect(kr(null)).toBe("–");
    expect(plain(percent(0.25))).toBe("25 %");
  });

  it("shows NOK in English", () => {
    setFormatLocale("en-GB", text);
    expect(plain(kr(1234.5))).toBe("NOK 1,234.50");
    expect(percent(0.25)).toBe("25%");
  });
});
