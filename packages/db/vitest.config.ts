import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // One shared test database; files must not run against it at the same time.
    fileParallelism: false,
  },
});
