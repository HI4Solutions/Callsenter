import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { derived, palette } from "./tokens";

const css = readFileSync(path.join(import.meta.dirname, "../app/globals.css"), "utf8");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("palette", () => {
  it("ligger i globals.css med samme verdier", () => {
    for (const hex of Object.values(palette)) {
      expect(css.toLowerCase(), hex).toContain(hex.toLowerCase());
    }
    for (const mode of [derived.light, derived.dark]) {
      for (const hex of Object.values(mode)) {
        expect(css.toLowerCase(), hex).toContain(hex.toLowerCase());
      }
    }
  });

  it("har tekstkontrast på minst 4,5:1 i lys modus", () => {
    expect(contrast(palette.skrift, palette.papir)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.skrift, derived.light.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(derived.light.muted, palette.papir)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(derived.light.muted, derived.light.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.stempel, palette.papir)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", palette.stempel)).toBeGreaterThanOrEqual(4.5);
  });

  it("har tekstkontrast på minst 4,5:1 i mørk modus", () => {
    expect(contrast(palette.take, palette.natt)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.take, derived.dark.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(derived.dark.muted, palette.natt)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(derived.dark.muted, derived.dark.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.stempelLys, palette.natt)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.natt, palette.stempelLys)).toBeGreaterThanOrEqual(4.5);
  });

  it("holder flaggfargene utenfor Tailwind-temaet", () => {
    const theme = css.match(/@theme[^{]*\{[^}]*\}/)?.[0];
    expect(theme).toContain("--color-brand");
    expect(theme).not.toMatch(/godkjent|avvik|brudd/i);
  });
});
