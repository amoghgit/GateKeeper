import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          env: { GATEKEEPER_MODE: "LOCAL_DEMO", DEMO_DATA_FILE: "memory" },
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["tests/frontend/**/*.test.tsx"],
          setupFiles: ["tests/helpers/setup-dom.ts"],
          css: false,
        },
      },
    ],
    coverage: { provider: "v8", include: ["src/server/**", "src/shared/**"], reporter: ["text-summary", "html"] },
  },
});
