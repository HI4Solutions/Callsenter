import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auth } from "./helpers.ts";

const insert = (returnTo: string) =>
  auth.query(
    "insert into auth_states (state_hash, provider, nonce, code_verifier, return_to) values ($1, 'bankid', 'n', 'v', $2)",
    [randomBytes(32), returnTo],
  );

describe("login return paths", () => {
  it("accept paths inside the app", async () => {
    await insert("/");
    await insert("/admin/brukere?q=kari");
  });

  it("refuse paths a browser could turn into another site", async () => {
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/a\\b", "/a\nb", "https://evil.example"]) {
      await expect(insert(bad), bad).rejects.toThrow(/auth_states_return_to_check/);
    }
  });
});
