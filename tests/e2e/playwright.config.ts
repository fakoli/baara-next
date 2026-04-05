import { defineConfig } from "@playwright/test";

export default defineConfig({
  projects: [
    { name: "specs", testDir: "./specs" },
    { name: "journeys", testDir: "./journeys" },
  ],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    headless: true,
  },
});
