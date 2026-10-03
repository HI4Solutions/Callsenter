// Every Norwegian text the API can send in a JSON body has a translation in every language
// (apps/api/src/i18n/messages.ts), with the same {placeholders}, and the catalogs hold nothing
// that is no longer used. The texts are read from the source, so a new message without a
// translation fails here with the text itself.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULES } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { BILLING_ERRORS } from "../src/admin/billing.ts";
import { FAILED, NOTE_FAILED } from "../src/calls/process.ts";
import { LABELS, MESSAGES } from "../src/i18n/messages.ts";

const SRC = join(import.meta.dirname, "../src");
// The catalog and the translator hold Norwegian keys, not messages of their own.
const SKIP = new Set([
  "i18n/messages.ts",
  "i18n/translate.ts",
  "i18n/documents.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !SKIP.has(relative(SRC, path))
      ? [path]
      : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path),
  source: readFileSync(path, "utf8"),
}));

// A string literal at `at` (", ' or `), as the text and the end; ${name} becomes {name}.
function literal(
  source: string,
  at: number,
  where: string,
): { text: string; end: number } {
  const quote = source[at]!;
  let text = "";
  let i = at + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === "\\") {
      const next = source[i + 1]!;
      text += next === "n" ? "\n" : next;
      i += 2;
    } else if (quote === "`" && source.startsWith("${", i)) {
      const close = source.indexOf("}", i);
      const expr = source.slice(i + 2, close).trim();
      if (!/^\w+$/.test(expr))
        throw new Error(
          `${where}: use a simple name in \${${expr}} (assign it to a const first)`,
        );
      text += `{${expr}}`;
      i = close + 1;
    } else text += source[i++];
  }
  return { text, end: i + 1 };
}

const QUOTES = new Set(['"', "'", "`"]);

// The string literals of an expression from `at` up to the end of the property or argument
// (a comma, a closing bracket or a semicolon outside brackets).
function literalsOfExpression(
  source: string,
  at: number,
  where: string,
): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i]!;
    if (QUOTES.has(ch)) {
      const { text, end } = literal(source, i, where);
      out.push(text);
      i = end - 1;
    } else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if ((ch === "," || ch === ";") && depth === 0) break;
  }
  return out;
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

// (a) Messages of the errors that are shown to users.
const ERROR_CONSTRUCTOR =
  /new (BadRequest|PasskeyError)\(\s*(?:\d+\s*,\s*)?(?=["'`])/g;
// (b) error: "..." in a response body (also both sides of a condition).
const ERROR_PROPERTY = /\berror:\s*/g;

function codeMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const { path, source } of files) {
    for (const match of source.matchAll(ERROR_CONSTRUCTOR)) {
      const at = match.index + match[0].length;
      const where = `${path}:${lineOf(source, at)}`;
      found.set(literal(source, at, where).text, where);
    }
    for (const match of source.matchAll(ERROR_PROPERTY)) {
      const at = match.index + match[0].length;
      const where = `${path}:${lineOf(source, at)}`;
      for (const text of literalsOfExpression(source, at, where))
        found.set(text, where);
    }
  }
  return found;
}

// Texts that reach users from elsewhere: the database's rules as messages (billing.ts), the
// worker's failures stored on calls and notes, and notes the database writes in a sale's history.
const SQL_NOTES = [
  // apps/api/src/org/confirmations.ts (status_note, copied to sale_events by the 0012 trigger)
  "Sendt til kunden for bekreftelse",
  // packages/db/migrations/0035_buyer_must_accept.sql (and 0014)
  "Godtatt skriftlig av kunden med BankID",
  "Godtatt skriftlig av kunden med Vipps",
  "Avslått av kunden",
  "Forsøk på å godta med BankID av en annen enn kjøperen. Navnet eller mobilnummeret stemte ikke. Salget venter fortsatt.",
  "Forsøk på å godta med Vipps av en annen enn kjøperen. Navnet eller mobilnummeret stemte ikke. Salget venter fortsatt.",
];

function allMessages(): Map<string, string> {
  const found = codeMessages();
  for (const [, text] of BILLING_ERRORS)
    found.set(text, "admin/billing.ts BILLING_ERRORS");
  for (const text of Object.values(FAILED))
    found.set(text, "calls/process.ts FAILED");
  for (const text of Object.values(NOTE_FAILED))
    found.set(text, "calls/process.ts NOTE_FAILED");
  for (const text of SQL_NOTES) found.set(text, "SQL note");
  return found;
}

// The validators that put a field name into a message, and where the name is among their
// arguments: (body, key, label, ...) or (value, label).
const LABEL_ARGUMENT: Record<string, number> = {
  optionalText: 2,
  requiredText: 2,
  optionalEmail: 2,
  optionalPhone: 2,
  optionalDate: 2,
  uuidOrNull: 2,
  wholeNumber: 2,
  phrases: 2,
  digits: 2,
  money: 1,
  date: 1,
  day: 1,
  monthStart: 1,
};
const LABELLED = new RegExp(
  `(?<![\\w.])(${[...Object.keys(LABEL_ARGUMENT), "price"].join("|")})\\(`,
  "g",
);

// The arguments of a call starting at `at` (just after the parenthesis), as source text.
function argumentsOf(source: string, at: number, where: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = at;
  for (let i = at; i < source.length; i++) {
    const ch = source[i]!;
    if (QUOTES.has(ch)) {
      i = literal(source, i, where).end - 1;
    } else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) {
        args.push(source.slice(start, i).trim());
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  return args.filter(Boolean);
}

function codeLabels(): Map<string, string> {
  const found = new Map<string, string>();
  for (const { path, source } of files) {
    for (const match of source.matchAll(LABELLED)) {
      // Not the definitions themselves ("function price(", "const date = (").
      if (
        /function\s+$/.test(
          source.slice(Math.max(0, match.index - 12), match.index),
        )
      )
        continue;
      const at = match.index + match[0].length;
      const where = `${path}:${lineOf(source, at)}`;
      const args = argumentsOf(source, at, where);
      const name = match[1]!;
      // price is (body, key, label) for products and (key, label) for billing.
      const index = name === "price" ? args.length - 1 : LABEL_ARGUMENT[name]!;
      const arg = args[index];
      if (!arg || !/^"[^"\\]*"$/.test(arg)) continue;
      found.set(JSON.parse(arg) as string, where);
    }
    // The missing parts of a product template (products.ts, publishProblems).
    for (const match of source.matchAll(/problems\.push\(("[^"]*")\)/g))
      found.set(JSON.parse(match[1]!) as string, path);
  }
  // Module names stand in "{name} er ikke slått på for callsenteret.".
  for (const module of Object.values(MODULES))
    found.set(module.name, "MODULES");
  return found;
}

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text: string) =>
  [...text.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
const LANGUAGES = ["en", "sv", "da", "de"] as const;

describe("translations of the API's messages", () => {
  const messages = allMessages();

  it("has every message in every language, with the same placeholders", () => {
    const problems: string[] = [];
    for (const [text, where] of messages) {
      for (const lang of LANGUAGES) {
        const translated = MESSAGES[lang][text];
        if (translated === undefined)
          problems.push(`${lang}: missing ${JSON.stringify(text)} (${where})`);
        else if (
          placeholders(translated).join() !== placeholders(text).join()
        ) {
          problems.push(
            `${lang}: placeholders differ in ${JSON.stringify(translated)} for ${JSON.stringify(text)}`,
          );
        } else if (!translated.trim())
          problems.push(
            `${lang}: empty translation for ${JSON.stringify(text)}`,
          );
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("holds no message that the code no longer uses", () => {
    const unused = LANGUAGES.flatMap((lang) =>
      Object.keys(MESSAGES[lang])
        .filter((key) => !messages.has(key))
        .map((key) => `${lang}: ${JSON.stringify(key)}`),
    );
    expect(unused, unused.join("\n")).toEqual([]);
  });

  it("has every field name in every language, and no others", () => {
    const labels = codeLabels();
    const problems: string[] = [];
    for (const [label, where] of labels) {
      for (const lang of LANGUAGES) {
        if (!LABELS[lang][label]?.trim())
          problems.push(
            `${lang}: missing label ${JSON.stringify(label)} (${where})`,
          );
      }
    }
    for (const lang of LANGUAGES) {
      for (const key of Object.keys(LABELS[lang]))
        if (!labels.has(key))
          problems.push(`${lang}: unused label ${JSON.stringify(key)}`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
