import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [
    { name: "api", testDir: "./suites/api" },
    { name: "ui", testDir: "./suites/ui" },
  ],
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
  },
});
