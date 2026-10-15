import { randomBytes } from "node:crypto";
import type { ClientBase } from "pg";

// Test data for staging: a fictitious product with a published template, and a note template,
// so a call centre can try Salgsstudio, the AI control and the notes right away. Testkraft AS
// does not exist. Runs as the owner, through the migrator Lambda, which refuses outside staging.
export const TEST_PRODUCT = {
  name: "Testkraft Fastpris 12 (fiktiv)",
  description:
    "Fiktivt produkt for testing av Salgsstudio, AI-kontrollen og notatene: strøm til fastpris i 12 måneder fra det oppdiktede selskapet Testkraft AS.",
  priceMonthly: 49,
  bindingMonths: 12,
  noticeMonths: 1,
  withdrawalDays: 14,
  terms: [
    "Fiktive vilkår for testing. Testkraft AS finnes ikke.",
    "",
    "Pris: 89,9 øre per kWh, fast i 12 måneder, og et månedsbeløp på 49 kr. Nettleie og offentlige avgifter kommer i tillegg og faktureres av nettselskapet.",
    "Bindingstid: 12 måneder. Sier kunden opp før bindingstiden er ute, betaler kunden et bruddgebyr på 500 kr.",
    "Oppsigelse: 1 måned etter bindingstiden.",
    "Angrerett: 14 dager fra kunden har godtatt tilbudet skriftlig.",
    "Avtalen gjelder først når kunden har godtatt tilbudet skriftlig. Etter samtalen får kunden tilbudet på SMS eller e-post.",
    "Oppstart: Testkraft leverer strømmen fra første virkedag etter at angrefristen er ute, med mindre kunden ber om tidligere oppstart.",
  ].join("\n"),
  requiredPoints: [
    "Si navnet ditt og at du ringer fra Testkraft AS",
    "Opplys at samtalen tas opp",
    "Oppgi prisen: 89,9 øre per kWh fast i 12 måneder, og 49 kr i månedsbeløp",
    "Opplys om bindingstiden på 12 måneder og bruddgebyret på 500 kr",
    "Opplys om angreretten på 14 dager",
    "Forklar at kunden får tilbudet skriftlig og må godta det før avtalen gjelder",
  ],
  approvedPhrases: [
    "Du får tilbudet skriftlig, og avtalen gjelder først når du har godtatt det.",
    "Du har 14 dagers angrerett fra du godtar tilbudet.",
    "Prisen er fast i 12 måneder.",
  ],
  forbiddenPhrases: ["gratis", "ingen binding", "du sparer garantert", "dette er bare en formalitet", "du må bestemme deg nå"],
} as const;

export const TEST_NOTE_TEMPLATE = {
  name: "Salgsnotat (test)",
  instructions: [
    "Skriv et kort salgsnotat som selgeren kan lime inn i callsenterets eget system:",
    "1. Kunde: hvem selgeren snakket med, og hva kunden har i dag hvis det ble nevnt.",
    "2. Tilbud: produkt, pris, bindingstid og angrerett slik selgeren la dem fram.",
    "3. Kundens svar: takket kunden ja, nei, eller ville kunden tenke seg om? Ta med det kunden sa, ordrett.",
    "4. Avvik: punkter fra produktmalen som ikke ble sagt, eller som ble sagt feil.",
    "5. Neste steg: hva som skal skje videre, og når.",
    "Hold notatet under 150 ord.",
  ].join("\n"),
} as const;

export interface TestDataResult {
  organizations: number;
  products: number;
  noteTemplates: number;
}

// Adds the test product and the note template to each call centre that does not have them. A
// call centre that has one by the same name, archived or not, keeps what it has, so test data
// that was archived or changed stays that way. The note template becomes the default only where
// the call centre has none.
export async function seedTestData(client: ClientBase, organizationIds: string[]): Promise<TestDataResult> {
  const result: TestDataResult = { organizations: organizationIds.length, products: 0, noteTemplates: 0 };
  await client.query("begin");
  try {
    for (const org of organizationIds) {
      const product = await client.query(
        "select 1 from products where organization_id = $1 and lower(name) = lower($2)",
        [org, TEST_PRODUCT.name],
      );
      if (!product.rowCount) {
        const created = await client.query<{ id: string }>(
          "insert into products (organization_id, name, description) values ($1, $2, $3) returning id",
          [org, TEST_PRODUCT.name, TEST_PRODUCT.description],
        );
        // Ids like the ones the API gives the points (apps/api/src/org/products.ts).
        const points = TEST_PRODUCT.requiredPoints.map((text) => ({ id: randomBytes(6).toString("hex"), text }));
        await client.query(
          `insert into product_template_versions (organization_id, product_id, version, status, published_at, price_monthly,
             binding_months, notice_months, withdrawal_days, terms, required_points, approved_phrases, forbidden_phrases)
           values ($1, $2, 1, 'published', now(), $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            org,
            created.rows[0]!.id,
            TEST_PRODUCT.priceMonthly,
            TEST_PRODUCT.bindingMonths,
            TEST_PRODUCT.noticeMonths,
            TEST_PRODUCT.withdrawalDays,
            TEST_PRODUCT.terms,
            JSON.stringify(points),
            TEST_PRODUCT.approvedPhrases,
            TEST_PRODUCT.forbiddenPhrases,
          ],
        );
        result.products++;
      }

      const note = await client.query(
        "select 1 from report_templates where organization_id = $1 and lower(name) = lower($2)",
        [org, TEST_NOTE_TEMPLATE.name],
      );
      if (!note.rowCount) {
        await client.query(
          `insert into report_templates (organization_id, name, instructions, is_default)
           values ($1, $2, $3, not exists (
             select 1 from report_templates where organization_id = $1 and is_default and archived_at is null))`,
          [org, TEST_NOTE_TEMPLATE.name, TEST_NOTE_TEMPLATE.instructions],
        );
        result.noteTemplates++;
      }
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
