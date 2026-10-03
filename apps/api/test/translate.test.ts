import { describe, expect, it } from "vitest";
import { requestLocale, translateBody, translateMessage, withLocale, currentLocale } from "../src/i18n/translate.ts";

describe("the API's texts in other languages", () => {
  it("takes the language from the web app's cookie, else the browser, else Norwegian", () => {
    expect(requestLocale("sv", "de-DE,de;q=0.9")).toBe("sv");
    expect(requestLocale(undefined, "de-DE,de;q=0.9")).toBe("de");
    expect(requestLocale("fr", "fr-FR")).toBe("nb");
    expect(withLocale("da", () => currentLocale())).toBe("da");
    expect(currentLocale()).toBe("nb");
  });

  it("leaves Norwegian and unknown text alone", () => {
    expect(translateMessage("Fant ikke ressursen.", "nb")).toBe("Fant ikke ressursen.");
    expect(translateMessage("Noe helt annet som ingen kjenner.", "en")).toBe("Noe helt annet som ingen kjenner.");
  });

  it("translates errors anywhere in a body, but notes only when they are whole known messages", () => {
    const body = translateBody({ error: "Fant ikke ressursen.", rows: [{ note: "Kunden ringer tilbake." }] }, "en") as {
      error: string;
      rows: { note: string }[];
    };
    expect(body.error).toBe("Not found.");
    expect(body.rows[0]!.note).toBe("Kunden ringer tilbake.");
  });
});
