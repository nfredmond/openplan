import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from '../../../openplan/node_modules/vitest/dist/config.js';
import { createRequire } from 'node:module';
const react = createRequire(new URL('../../../openplan/package.json', import.meta.url))('@vitejs/plugin-react').default;

// Mirror the relevant base test settings without its bundle-only __dirname.
// The runner loader and owned cache avoid temporary writes to borrowed modules.
const app = fileURLToPath(new URL('../../../openplan/', import.meta.url));
export default defineConfig({
  root: app,
  cacheDir: fileURLToPath(new URL('../../../.tmp/jurisdiction-corrections-cache', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': `${app}src` } },
  test: {
    environment: 'jsdom', setupFiles: [`${app}src/test/setup.ts`], globals: true,
    maxWorkers: 1, fileParallelism: false, testTimeout: 20_000, hookTimeout: 20_000,
    exclude: [...defaultExclude, '**/.claude/**'],
    unstubEnvs: true, unstubGlobals: true, clearMocks: true,
  },
});
