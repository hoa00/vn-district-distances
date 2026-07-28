import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    // tests/perf là benchmark thu bằng chứng (nhạy với tải máy), không phải correctness gate;
    // chạy riêng qua `npm run test:perf` để không flake release:verify.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/perf/**"],
  },
});
