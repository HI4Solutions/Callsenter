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

  it("translates messages with field names, lists and module names in them", () => {
    expect(translateMessage("Kontaktperson må fylles ut.", "en")).toBe("Contact person is required.");
    expect(translateMessage("Ukjent kunde.", "de")).toBe("Kunde nicht gefunden.");
    expect(translateMessage("Ugyldig dato: fakturadato.", "sv")).toBe("Ogiltigt datum: fakturadatum.");
    expect(translateMessage("Bindingstid må være et helt tall mellom 0 og 120.", "da")).toBe("Bindingsperiode skal være et helt tal mellem 0 og 120.");
    expect(translateMessage("Fyll ut før publisering: pris (engangs eller per måned), vilkår.", "en")).toBe(
      "Fill in before publishing: price (one-off or monthly), terms.",
    );
    expect(translateMessage("AI-kontroll er ikke slått på for callsenteret.", "de")).toBe("KI-Prüfung ist für das Callcenter nicht aktiviert.");
  });

  it("translates the notes the system writes in a sale's history", () => {
    const body = translateBody({ events: [{ note: "Godtatt skriftlig av kunden med BankID" }], statusNote: "Sendt til kunden for bekreftelse" }, "en") as {
      events: { note: string }[];
      statusNote: string;
    };
    expect(body.events[0]!.note).toBe("Accepted in writing by the customer with BankID");
    expect(body.statusNote).toBe("Sent to the customer for confirmation");
  });
});
