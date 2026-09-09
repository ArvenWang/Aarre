import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "../../../vite.config";

// Audit-only fault injection. These cases are deliberately outside the normal
// *.test.ts suite. They assert the required behavior and fail on the audit baseline.
export default mergeConfig(viteConfig, defineConfig({
  test: { include: ["docs/audits/2026-09-09/*.cases.ts"], environment: "node" }
}));
