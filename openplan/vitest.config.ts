import { defaultExclude, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Never discover tests inside a nested checkout. A `git worktree` created
    // from this directory instead of the repo root lands at
    // `openplan/.claude/worktrees/<name>/`, and vitest would then run THAT
    // tree's tests alongside this one's — reporting failures from a branch
    // nobody is running, and silently double-counting the suite. The gate must
    // only ever see the checkout it was invoked in.
    exclude: [...defaultExclude, '**/.claude/**'],
    // Vitest's default is 5 seconds. That is a limit on how loaded the machine
    // is, not on whether the code is correct, and it went red twice on
    // 2026-08-18 for tests that pass locally in well under a second: the
    // `npm run doctor` checks (which spawn a real node process that itself
    // shells out to docker and supabase) and the Safety ingest lane (which
    // drives the real ingest pipeline across every crash-source adapter).
    // Both failures were reported as the code under test timing out.
    //
    // 20s applies to everything, so no individual file has to remember to ask.
    // It costs nothing when tests pass — only a genuinely hung test waits
    // longer to be declared hung, and a hung test is a defect either way.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Isolation is a property of the runner, not of whether each of ~1,000 test
    // files remembered to clean up after itself. Vitest reuses a worker process
    // across files, so a file that stubs a global or an env var and forgets to
    // put it back hands it to whatever file the scheduler runs next — which is
    // how this suite stayed green in file-name order while failing under
    // `--sequence.shuffle`.
    //
    // Turned on one at a time on 2026-08-22, running the full suite in normal
    // order after each. Blast radius of all three, measured rather than
    // predicted: ZERO failures — 1053 files / 12178 tests before and after.
    // `src/test/the-runner-isolates-tests-from-each-other.test.ts` is what
    // fails if any of the three is later removed; without it nothing in the
    // suite can tell you they are still on.
    unstubEnvs: true,
    unstubGlobals: true,
    // `clearMocks` clears call history between tests. It does NOT reset mock
    // implementations (that is `mockReset`) and does not un-spy
    // (`restoreMocks`) — either of those would be a rewrite of the suite rather
    // than a config change, because ~300 files set implementations at module
    // scope and expect them to survive. Note the consequence: `clearMocks`
    // also does not drain a queued `mockResolvedValueOnce` that the code under
    // test never consumed, which remains the live leak this config cannot
    // close. Only running in a varied order finds those — `npm run
    // test:shuffled`, and the `order independence` CI job.
    clearMocks: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
