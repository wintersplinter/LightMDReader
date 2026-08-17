import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only the pure helpers in lib/ are tested. The app itself is checked by
    // opening it, which is what a project this size can actually sustain.
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
  },
});
