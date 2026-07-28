import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Cấu hình riêng cho benchmark hiệu năng (tests/perf):_include perf, không exclude.
// Chạy qua `npm run test:perf` để thu bằng chứng, tách khỏi release:verify gate.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/perf/**/*.test.ts"],
  },
});
