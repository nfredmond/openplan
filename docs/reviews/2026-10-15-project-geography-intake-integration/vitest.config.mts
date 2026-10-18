import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { defaultExclude, defineConfig } from '../../../openplan/node_modules/vitest/dist/config.js';
const react = createRequire(new URL('../../../openplan/package.json', import.meta.url))('@vitejs/plugin-react').default;
const app = fileURLToPath(new URL('../../../openplan/', import.meta.url));
export default defineConfig({
  root: app,
  cacheDir: fileURLToPath(new URL('../../../.tmp/project-geography-intake-integration/vite', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': `${app}src` } },
  test: {
    environment: 'jsdom', setupFiles: [`${app}src/test/setup.ts`], globals: true,
    maxWorkers: 1, fileParallelism: false, testTimeout: 20_000, hookTimeout: 20_000,
    exclude: [...defaultExclude, '**/.claude/**'],
    unstubEnvs: true, unstubGlobals: true, clearMocks: true,
  },
});
