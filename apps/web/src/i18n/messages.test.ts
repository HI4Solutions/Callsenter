import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { LOCALE_CODES } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { NAMESPACES } from "./messages";

const ROOT = path.join(import.meta.dirname, "../../messages");

function read(locale: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, locale, `${ns}.json`), "utf8"));
}

// Every text as "namespace.key.subkey" → text.
function flatten(value: unknown, prefix: string, out: Map<string, string>) {
  if (typeof value === "string") out.set(prefix, value);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, `${prefix}.${k}`, out);
  else throw new Error(`${prefix} is not text`);
}

function texts(locale: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const ns of NAMESPACES) flatten(read(locale, ns), ns, out);
  return out;
}

// The {placeholders} a text uses, and the kinds of its plurals and selects.
function argumentsOf(elements: MessageFormatElement[], out = new Set<string>()): Set<string> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.number || el.type === TYPE.date || el.type === TYPE.time) out.add(el.value);
    if (el.type === TYPE.plural || el.type === TYPE.select) {
      out.add(`${el.value}:${el.type === TYPE.plural ? "plural" : "select"}`);
      for (const option of Object.values(el.options)) argumentsOf(option.value, out);
    }
    if (el.type === TYPE.tag) {
      out.add(`<${el.value}>`);
      argumentsOf(el.children, out);
    }
  }
  return out;
}

describe("the pages' texts", () => {
  const source = texts("nb");

  it("has a file for every namespace in every language, and no others", () => {
    for (const locale of LOCALE_CODES) {
      const files = readdirSync(path.join(ROOT, locale)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
      expect(files.sort(), locale).toEqual([...NAMESPACES].sort());
    }
  });

  it.each(LOCALE_CODES.filter((l) => l !== "nb"))("has every Norwegian text in %s, with the same placeholders", (locale) => {
    const translated = texts(locale);
    expect([...translated.keys()].sort()).toEqual([...source.keys()].sort());
    for (const [key, text] of source) {
      const other = translated.get(key)!;
      expect(other.trim(), `${locale} ${key} is empty`).not.toBe("");
      expect([...argumentsOf(parse(other))].sort(), `${locale} ${key}`).toEqual([...argumentsOf(parse(text))].sort());
    }
  });

  it("are valid ICU messages in Norwegian", () => {
    for (const [key, text] of source) expect(() => parse(text), key).not.toThrow();
  });
});
