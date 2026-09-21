import { defineConfig } from "vitest/config";

// バランス検算スクリプト（test/sim/*.sim.ts）。`npm run sim:battle` で実行。通常の `npm test` には含めない。
export default defineConfig({
  test: {
    include: ["test/sim/*.sim.ts"],
    testTimeout: 600_000,
  },
});
