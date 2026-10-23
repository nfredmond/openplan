import { defaultServerConditions } from "vite";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config";

// Bind the real server-only package export for this bounded Reports project.
// This config does not enable live fixtures or grant a native target lifetime.
export default mergeConfig(baseConfig, defineConfig({
  ssr: {
    resolve: {
      conditions: [...defaultServerConditions, "react-server"],
    },
  },
  test: {
    include: [
      "src/test/guided-comparison-route-rls.test.ts",
      "src/test/reports-native-conditions.test.ts",
    ],
    env: { OPENPLAN_REPORTS_NATIVE_CONDITIONS: "react-server" },
  },
}));
