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
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
