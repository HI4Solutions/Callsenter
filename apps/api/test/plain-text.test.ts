import { describe, expect, it } from "vitest";
import { plainText } from "../src/calls/plain-text.ts";

describe("notes as plain text", () => {
  it("takes away Markdown and keeps the words", () => {
    const note = [
      "## **Sammendrag**",
      "",
      "Kunden ble tilbudt **Strøm Fast** til *299 kr* i måneden.",
      "",
      "---",
      "",
      "### Tilbud og vilkår",
      "* Bindingstid: __12 måneder__",
      "+ Angrerett: _14 dager_",
      "• Pris: `299 kr`",
      "",
      "| Punkt | Svar |",
      "|---|:---:|",
      "| Pris | 299 kr |",
      "",
      "> Kunden sa ja.",
      "Se [vilkårene](https://example.com) og [https://example.com](https://example.com).",
      "Avslutning",
      "===",
    ].join("\n");
    expect(plainText(note)).toBe(
      [
        "Sammendrag",
        "",
        "Kunden ble tilbudt Strøm Fast til 299 kr i måneden.",
        "",
        "Tilbud og vilkår",
        "- Bindingstid: 12 måneder",
        "- Angrerett: 14 dager",
        "- Pris: 299 kr",
        "",
        "Punkt – Svar",
        "Pris – 299 kr",
        "",
        "Kunden sa ja.",
        "Se vilkårene (https://example.com) og https://example.com.",
        "Avslutning",
      ].join("\n"),
    );
  });

  it("leaves plain text, numbered lists, snake_case and arithmetic as they are", () => {
    const note = "1. Sammendrag\nKunden sa ja til 2*3 tilbud.\n- produkt_id er strom_fast\n\n2. Kundens svar\nJa.";
    expect(plainText(note)).toBe(note);
  });

  it("keeps at most one empty line and none at the ends", () => {
    expect(plainText("\r\n\r\nEn\r\n\r\n\r\n\r\nTo\n\n")).toBe("En\n\nTo");
  });
});
