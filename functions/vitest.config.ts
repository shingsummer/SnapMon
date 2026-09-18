import { defineConfig } from "vitest/config";

// 通常の `npm test` は純ロジックのみ。Firestore エミュレータが要るテストは test/integration/ に置き、
// `npm run test:integration`（vitest.integration.config.ts、firebase emulators:exec 経由）で実行する。
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
  },
});
