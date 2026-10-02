import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { derived, palette } from "./tokens";

const css = readFileSync(path.join(import.meta.dirname, "../app/globals.css"), "utf8");

// Returns the body of the first rule whose selector line starts with `selector`.
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = source.indexOf("{", start);
  return source.slice(open + 1, source.indexOf("}", open));
}

function variables(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) {
    result[name as string] = (value as string).toLowerCase();
  }
  return result;
}

const lower = (hex: string) => hex.toLowerCase();

const light = variables(ruleBody(css, ":root"));
const dark = variables(ruleBody(css, ':root[data-theme="dark"]'));
const darkFallback = variables(ruleBody(css, ":root:not([data-theme])"));
const flags = variables(css.slice(css.indexOf("AI flags are"), css.indexOf("@theme")));

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

describe("CSS variables match the palette", () => {
  it("light mode", () => {
    expect(light).toMatchObject({
      bg: lower(palette.paper),
      fg: lower(palette.ink),
      brand: lower(palette.stamp),
      surface: lower(derived.light.surface),
      border: lower(derived.light.border),
      muted: lower(derived.light.muted),
    });
  });

  it("dark mode", () => {
    expect(dark).toMatchObject({
      bg: lower(palette.night),
      fg: lower(palette.mist),
      brand: lower(palette.stampLight),
      surface: lower(derived.dark.surface),
      border: lower(derived.dark.border),
      muted: lower(derived.dark.muted),
    });
  });

  it("no-JavaScript dark fallback is identical to dark mode", () => {
    expect(darkFallback).toEqual(dark);
  });

  it("AI flags", () => {
    expect(flags).toEqual({
      "flag-approved": lower(palette.approved),
      "flag-deviation": lower(palette.deviation),
      "flag-violation": lower(palette.violation),
    });
  });

  it("keeps flag colors out of the Tailwind theme", () => {
    const theme = css.match(/@theme[^{]*\{[^}]*\}/)?.[0];
    expect(theme).toContain("--color-brand");
    expect(theme).not.toMatch(/approved|deviation|violation|godkjent|avvik|brudd/i);
  });
});

describe("text contrast is at least 4.5:1", () => {
  const modes = {
    light: { bg: light["bg"]!, surface: light["surface"]!, fg: light["fg"]!, muted: light["muted"]!, brand: light["brand"]!, onBrand: light["on-brand"]! },
    dark: { bg: dark["bg"]!, surface: dark["surface"]!, fg: dark["fg"]!, muted: dark["muted"]!, brand: dark["brand"]!, onBrand: dark["on-brand"]! },
  };

  for (const [mode, c] of Object.entries(modes)) {
    it(`${mode} mode`, () => {
      expect(contrast(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.fg, c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.brand, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.onBrand, c.brand)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
