import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync, unlinkSync, rmdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// Exercise the real runner config with two files contending for one owned resource.
// This sees cross-file overlap, not PostgreSQL's lock order or within-test concurrency.
it.each([undefined, "4"])("serializes live suites and preserves ordinary worker settings with override %s", (workers) => {
  const directory = mkdtempSync(path.join(process.cwd(), ".rls-runner-proof-"));
  const lock = path.join(directory, "shared-catalog.lock");
  try {
    for (const name of ["first", "second"]) writeFileSync(path.join(directory, `${name}.test.ts`), `
      import { openSync, closeSync, unlinkSync } from 'node:fs';
      import { it } from 'vitest';
      it('owns the shared catalog without another suite overlapping', async () => {
        const lock = ${JSON.stringify(lock)};
        const handle = openSync(lock, 'wx');
        try { await new Promise(resolve => setTimeout(resolve, 1000)); }
        finally { closeSync(handle); unlinkSync(lock); }
      });
    `);
    const output = execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", directory, "--maxWorkers=2"], {
      cwd: process.cwd(), env: { ...process.env, OPENPLAN_RLS_LIVE_TEST: "1", VITEST_MAX_WORKERS: workers }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000,
    });
    expect(output).toMatch(/2 passed/);
    const ordinary = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { loadConfigFromFile } from 'vite';
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, 'vitest.config.ts');
      console.log('ordinary-parallel=' + loaded.config.test.fileParallelism);
      console.log('ordinary-workers=' + (process.env.VITEST_MAX_WORKERS ?? 'unset'));
    `], { cwd: process.cwd(), env: { ...process.env, OPENPLAN_RLS_LIVE_TEST: "0", VITEST_MAX_WORKERS: workers }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 });
    expect(ordinary).toContain("ordinary-parallel=true");
    expect(ordinary).toContain(`ordinary-workers=${workers ?? "unset"}`);
  } finally {
    for (const name of readdirSync(directory)) unlinkSync(path.join(directory, name));
    rmdirSync(directory);
  }
});
