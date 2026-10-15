import { afterEach, describe, expect, it, vi } from "vitest";
import { handler } from "../src/migrator.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the migrator", () => {
  it("adds test data only in staging, before it touches the database", async () => {
    for (const environment of ["production", ""]) {
      vi.stubEnv("ENVIRONMENT", environment);
      await expect(handler({ action: "seed-test-data" })).rejects.toThrow("seed-test-data runs only in staging");
    }
  });
});
