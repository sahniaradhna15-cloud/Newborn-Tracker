/**
 * First Vitest config for the project (Phase 2 Task 1).
 *
 * TWO projects, deliberately isolated:
 *
 *  - `unit`        — the existing fast suite (`src/**\/*.test.ts`). NO setup
 *                    file, NO database, NO env loading. This MUST remain the
 *                    exact same DB-free 57-test suite that ran on Vitest
 *                    defaults before this config existed. `pnpm test` runs
 *                    only this project (CI default — never needs Postgres).
 *
 *  - `integration` — `test/integration/**\/*.test.ts`. Real Postgres, so it
 *                    runs SERIALLY against one shared dev database
 *                    (`fileParallelism: false` + a single fork). Loads the
 *                    harness (`test/integration/_harness.ts`) which opens the
 *                    RLS-enforcing `app_runtime` connection and the owner
 *                    `adminDb` connection, and TRUNCATEs between tests.
 *                    Run with `pnpm test:integration`.
 *
 * The two never mix: a green `pnpm test` proves the math layer without a DB;
 * `pnpm test:integration` is the security gate that needs the real database.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          // No setupFiles, no globalSetup, no env: this project must stay
          // DB-free and identical to the pre-config default behaviour.
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          // Real shared Postgres → no parallelism. Vitest 4 flattened
          // poolOptions: `maxWorkers: 1` + `fileParallelism: false` replace
          // the old `forks.singleFork` and run every spec serially against
          // the one shared dev database.
          pool: "forks",
          maxWorkers: 1,
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 30000,
          setupFiles: ["test/integration/_harness.ts"],
        },
      },
    ],
  },
});
