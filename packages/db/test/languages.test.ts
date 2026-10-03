import { LOCALE_CODES, LOCALES } from "@veriqall/shared";
import { describe, expect, it } from "vitest";
import { api, as, createOrg, member, owner, rejects } from "./helpers.ts";

const newCall = async (org: string, user: string) =>
  (
    await owner.query<{ id: string }>(
      "insert into calls (organization_id, user_id, source, transcription_mode) values ($1, $2, 'microphone', 'chunked') returning id",
      [org, user],
    )
  ).rows[0]!.id;

describe("languages", () => {
  it("match the languages in packages/shared, with their search configurations", async () => {
    const { rows } = await owner.query<{ code: string; config: string }>(
      "select code, app.search_config(code)::text as config from locales order by code",
    );
    expect(rows.map((r) => r.code)).toEqual([...LOCALE_CODES].sort());
    for (const r of rows) expect(r.config).toBe(LOCALES[r.code as keyof typeof LOCALES].search);
  });

  it("let a user choose their own language, and only a supported one", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    await as(api, { userId: seller, orgId: org, strong: false }, async (db) => {
      await db.query("select app.set_my_locale('sv')");
      expect((await db.query("select locale from users where id = $1", [seller])).rows[0].locale).toBe("sv");
      await db.query("select app.set_my_locale(null)");
      expect((await db.query("select locale from users where id = $1", [seller])).rows[0].locale).toBeNull();
      await rejects(db, "select app.set_my_locale('fr')", [], /foreign key/);
    });
  });

  it("give a call centre Norwegian by default, and check the Soniox languages", async () => {
    const org = await createOrg();
    const row = (await owner.query("select default_locale, content_locale, transcription_languages from organizations where id = $1", [org])).rows[0];
    expect(row).toEqual({ default_locale: "nb", content_locale: "nb", transcription_languages: ["no"] });
    await owner.query("update organizations set transcription_languages = '{no,sv,en,pl}' where id = $1", [org]);
    for (const bad of ["{}", "{No}", "{no,no}", "{norsk}"]) {
      await expect(owner.query("update organizations set transcription_languages = $2 where id = $1", [org, bad])).rejects.toThrow(/check/);
    }
  });

  it("let the seller choose a call's languages", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    const call = await newCall(org, seller);
    await as(api, { userId: seller, orgId: org, strong: false }, async (db) => {
      await db.query("update calls set output_locale = 'de', spoken_languages = '{de,en}' where id = $1", [call]);
      await rejects(db, "update calls set output_locale = 'fr' where id = $1", [call], /foreign key/);
    });
  });

  it("finds a transcript in any language: stemmed in its own, and word for word", async () => {
    const org = await createOrg();
    const seller = await member(org, "seller");
    const swedish = await newCall(org, seller);
    const norwegian = await newCall(org, seller);
    await owner.query("insert into transcripts (call_id, organization_id, text, language) values ($1, $2, 'Kunden köpte avtalen med bindningstid', 'sv')", [
      swedish,
      org,
    ]);
    await owner.query("insert into transcripts (call_id, organization_id, text) values ($1, $2, 'Kunden kjøpte avtalene i går')", [norwegian, org]);
    const find = async (config: string, words: string) =>
      (
        await owner.query<{ call_id: string }>(
          `select call_id from transcripts where organization_id = $1
             and search_all @@ (websearch_to_tsquery($2::regconfig, $3) || websearch_to_tsquery('simple', $3)) order by call_id`,
          [org, config, words],
        )
      ).rows.map((r) => r.call_id);
    // Swedish stemming: "bindningstiden" matches "bindningstid".
    expect(await find("swedish", "bindningstiden")).toEqual([swedish]);
    // A Norwegian user's search still finds the word as it is said in a Swedish call.
    expect(await find("norwegian", "bindningstid")).toEqual([swedish]);
    // Untagged transcripts are Norwegian; "avtale" stems to the same word as Swedish "avtalen".
    expect(await find("norwegian", "avtale")).toEqual([norwegian, swedish].sort());
  });
});
