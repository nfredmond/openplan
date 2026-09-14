import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ITEM_COLUMNS } from '@/lib/engagement/public-approved-items';
import { collectSupabaseSelectSites } from './supabase-call-sites';
import { LIVE_RLS } from './local-supabase-env';
import { resolveLocalDbContainer } from './helpers/live-catalog';
import { requireContractVerificationStack } from './helpers/contract-verification-stack';

const fixture = readFileSync('src/test/fixtures/engagement/public-copy-privacy.sql', 'utf8');

// Exercise installed definitions and grants. Every fixture and deliberate fault rolls back.
function run(fault = '') {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45_000,
    input: `BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s';\n${fault}\n${fixture}\nROLLBACK;`,
  }).trim().split('\n').at(-1);
}

describe.skipIf(!LIVE_RLS)('installed public-copy privacy', () => {
  it.each(['', '-- Harmless public-copy comment.'])('retains originals and excludes private public copies %s', comment => {
    expect(run(comment)).toBe('public-copy-privacy-verified');
  });
  it.each([
    ['anonymous view exposure', 'GRANT SELECT ON engagement_public_items TO anon;', 'view-no-anonymous-read'],
    ['staff view exposure', 'GRANT SELECT ON engagement_public_items TO authenticated;', 'view-no-authenticated-read'],
    ['direct view writes', 'GRANT ALL ON engagement_public_items TO service_role;', 'view-no-direct-writes'],
    ['vote guard removed', 'ALTER TABLE engagement_item_votes DISABLE TRIGGER engagement_public_vote_guard;', 'private-vote-denial'],
    ['privacy withdrawal removed', 'ALTER TABLE engagement_items DISABLE TRIGGER zz_engagement_public_copy_guard;', 'privacy-withdraws-response'],
    ['history capture removed', 'ALTER TABLE engagement_items DISABLE TRIGGER engagement_item_history_capture;', 'privacy-history-retained'],
  ])('detects %s through native behavior', (_name, fault, expected) => {
    let failure: unknown;
    try { run(fault); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(`Public privacy assertions failed:`);
    expect(String((failure as { stderr?: unknown }).stderr)).toContain(expected);
  });
});

// Native column resolution covers the public view excluded by the table-only
// source census, including the portal's imported projection constant.
function runPublicProjections(fault = '') {
  const container = resolveLocalDbContainer();
  requireContractVerificationStack(container);
  const sites = collectSupabaseSelectSites().filter(site => site.table === 'engagement_public_items' && site.projection !== null);
  expect(sites.length).toBeGreaterThanOrEqual(7);
  const projections = [...new Set([PUBLIC_ITEM_COLUMNS, ...sites.map(site => site.projection as string)])];
  for (const projection of projections) expect(projection).toMatch(/^[a-z_]+(?:,\s*[a-z_]+)*$/);
  const selects = projections.map(projection => `SELECT ${projection} FROM public.engagement_public_items LIMIT 0;`).join('\n');
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45_000,
    input: `BEGIN; SET LOCAL lock_timeout='3s';\n${fault}\nSET LOCAL ROLE service_role;\n${selects}\nSELECT 'public-projections-verified';\nROLLBACK;`,
  }).trim();
}

describe.skipIf(!LIVE_RLS)('installed public-copy projections', () => {
  it.each(['', '-- Harmless public projection comment.'])('resolves actual selected columns under the caller role %s', comment => {
    expect(runPublicProjections(comment)).toBe('public-projections-verified');
  });
  it('detects a selected column missing from the installed view', () => {
    let failure: unknown;
    try { runPublicProjections('ALTER VIEW public.engagement_public_items RENAME COLUMN body TO missing_body;'); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(String((failure as { stderr?: unknown }).stderr)).toContain('column "body" does not exist');
  });
});
