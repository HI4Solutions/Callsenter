import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Same throwaway database as packages/db (migrations run as a non-superuser owner).
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    fileParallelism: false,
  },
});
