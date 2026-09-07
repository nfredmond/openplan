import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import packageJson from '../../package.json';

// Exercise the command's real Node startup flags without opening any database.
function targetFromCommand(command: string, configuration: string | null, explicit?: string) {
  const directory = mkdtempSync(join(tmpdir(), 'openplan-live-entry-'));
  try {
    if (configuration !== null) writeFileSync(join(directory, '.env.local'), configuration);
    const prefix = command.match(/^OPENPLAN_RLS_LIVE_TEST=1 node\s+(.*?)\s*node_modules\/vitest\/vitest\.mjs run /);
    if (!prefix) throw new Error('Live RLS must use a reviewable Node entry point');
    const environment = { ...process.env };
    delete environment.OPENPLAN_SUPABASE_WORKDIR;
    if (explicit) environment.OPENPLAN_SUPABASE_WORKDIR = explicit;
    return execFileSync(process.execPath, [
      ...prefix[1].split(/\s+/).filter(Boolean),
      '-e', "process.stdout.write(process.env.OPENPLAN_SUPABASE_WORKDIR ?? 'default-stack')",
    ], { cwd: directory, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

it('loads the configured checkout target when the shell omitted it, and detects removing that behavior', () => {
  const command = packageJson.scripts['test:rls-live'];
  const configuration = 'OPENPLAN_SUPABASE_WORKDIR=/owned/isolated-stack\n';
  const check = (value: string) => expect(value).toBe('/owned/isolated-stack');
  check(targetFromCommand(command, configuration));
  check(targetFromCommand(command, '# Harmless configuration comment\n' + configuration));
  expect(() => check(targetFromCommand(
    command.replace('--env-file-if-exists=.env.local', ''), configuration,
  ))).toThrow();
});

it('preserves explicit target overrides and supports CI without a local environment file', () => {
  const command = packageJson.scripts['test:rls-live'];
  expect(targetFromCommand(command, 'OPENPLAN_SUPABASE_WORKDIR=/owned/file-stack\n', '/owned/explicit-stack'))
    .toBe('/owned/explicit-stack');
  expect(targetFromCommand(command, null)).toBe('default-stack');
});
