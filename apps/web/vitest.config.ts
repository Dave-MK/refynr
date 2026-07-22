import { defineConfig } from "vitest/config";

/**
 * Web-shell unit tests. Node environment on purpose — these cover the shell's
 * pure decision logic (lib/), not React rendering, so there's no jsdom or
 * component-testing stack to keep alive. Anything that needs a real browser is
 * verified by driving the app (see .claude/skills/verify).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
