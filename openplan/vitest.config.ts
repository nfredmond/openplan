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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
