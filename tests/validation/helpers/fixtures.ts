// tests/validation/helpers/fixtures.ts
//
// Custom Playwright test fixture factory for BAARA Next validation tests.
// Extends the base @playwright/test with:
//   - server    (worker-scoped): live ServerInstance for each worker
//   - apiClient (worker-scoped): typed API client bound to server.apiURL
//   - metrics   (test-scoped):  collects ValidationTiming[]; written to JSON on teardown
//   - page      (test-scoped override): navigates to server.baseURL with waitUntil: "networkidle"

import { test as baseTest, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startServer } from "./server";
import type { ServerInstance } from "./server";
import { createAPIClient } from "./api";
import type { APIClient } from "./api";
import type { ValidationTiming } from "./metrics";

export type { ServerInstance, APIClient, ValidationTiming };
export { expect };

// ---------------------------------------------------------------------------
// Fixture type declarations
//
// Playwright's extend<TestFixtures, WorkerFixtures> requires worker-scoped
// fixtures to live in the SECOND type parameter.
// ---------------------------------------------------------------------------

interface ValidationTestFixtures {
  /** Collects ValidationTiming records; written to JSON file on test teardown. */
  metrics: ValidationTiming[];
  /** page override: navigates to server.baseURL before each test. */
  page: Page;
}

interface ValidationWorkerFixtures {
  /** Running backend + Vite dev server for this worker. */
  server: ServerInstance;
  /** Typed API client bound to server.apiURL. */
  apiClient: APIClient;
}

// ---------------------------------------------------------------------------
// Results directory (relative to the validation test root)
// ---------------------------------------------------------------------------

// __dirname here is tests/validation/helpers/ — go up one level to tests/validation/.
const RESULTS_DIR = path.resolve(__dirname, "../results");

function ensureResultsDir(): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

export const test = baseTest.extend<ValidationTestFixtures, ValidationWorkerFixtures>({
  // -------------------------------------------------------------------
  // server — worker-scoped: one backend+vite pair per Playwright worker.
  // -------------------------------------------------------------------
  server: [
    async ({}, use) => {
      const instance = await startServer();
      await use(instance);
      await instance.cleanup();
    },
    { scope: "worker" },
  ],

  // -------------------------------------------------------------------
  // apiClient — worker-scoped: bound to the worker's server.
  // -------------------------------------------------------------------
  apiClient: [
    async ({ server }, use) => {
      const client = createAPIClient(server.apiURL);
      await use(client);
    },
    { scope: "worker" },
  ],

  // -------------------------------------------------------------------
  // metrics — test-scoped: fresh array per test; flushed to JSON on done.
  // Results are written to tests/validation/results/timings-{spec}-{timestamp}.json
  // -------------------------------------------------------------------
  metrics: async ({}, use, testInfo) => {
    const timings: ValidationTiming[] = [];
    await use(timings);

    // Only write when at least one timing was recorded.
    if (timings.length === 0) return;

    ensureResultsDir();

    // Derive a safe filename from the test file name.
    const testFile = path.basename(testInfo.file, path.extname(testInfo.file));
    const timestamp = Date.now();
    const outputPath = path.join(
      RESULTS_DIR,
      `timings-${testFile}-${timestamp}.json`
    );

    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          test: testInfo.title,
          file: testInfo.file,
          timings,
          writtenAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  },

  // -------------------------------------------------------------------
  // page — test-scoped override: navigates to server.baseURL before each test
  // with waitUntil: "networkidle" so the UI is fully settled.
  // -------------------------------------------------------------------
  page: async ({ page, server }, use) => {
    await page.goto(server.baseURL, { waitUntil: "networkidle" });
    await use(page);
  },
});
