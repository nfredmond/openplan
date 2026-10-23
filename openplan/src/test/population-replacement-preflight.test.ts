import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ from: vi.fn(), health: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/models/worker-health-server', () => ({ loadModelingWorkerHealth: mocks.health }));
import { replacementPreflight } from '@/lib/models/population-replacement-server';
import { MODELING_QUEUE_DEPTH_ENV } from '@/lib/models/run-dispatch';
const workspace = '11111111-1111-4111-8111-111111111111';
const calls: unknown[][] = [];
let count = 0;
let error: { message: string; code: string } | null = null;
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; count = 0; error = null;
  vi.stubEnv('OPENPLAN_MONTHLY_RUN_CAP', ''); vi.stubEnv('DEV_UNLIMITED_QUOTA', '0');
  vi.stubEnv('OPENPLAN_HOSTED_ARTIFACT_MIRROR', '0'); vi.stubEnv(MODELING_QUEUE_DEPTH_ENV, '');
  mocks.health.mockResolvedValue({ aequilibrae: { state: 'fresh' }, activitysim: { state: 'fresh' } });
  mocks.from.mockImplementation((table: string) => {
    calls.push(['from', table]);
    const query = { select: (projection: string, options: unknown) => { calls.push(['select', projection, options]); return query; },
      eq: (key: string, value: string) => { calls.push(['eq', key, value]); return query; },
      gte: async (key: string, value: string) => { calls.push(['gte', key, value]); return { count, error }; } };
    return query;
  });
});
afterEach(() => { vi.unstubAllEnvs(); });
it('preserves unlimited independent installation without a monthly count query', async () => {
  expect(await replacementPreflight('aequilibrae', workspace)).toBeNull(); expect(mocks.from).not.toHaveBeenCalled();
});
it('applies the real optional cap with the existing five-unit model launch weight', async () => {
  vi.stubEnv('OPENPLAN_MONTHLY_RUN_CAP', '10'); count = 6;
  expect(await replacementPreflight('behavioral_demand', workspace)).toMatchObject({ status: 429 });
  expect(calls.slice(0, 3)).toEqual([['from', 'model_runs'], ['select', 'id', { count: 'exact', head: true }], ['eq', 'workspace_id', workspace]]);
  expect(calls[3]).toEqual(['gte', 'created_at', expect.stringMatching(/^\d{4}-\d{2}-01T00:00:00\.000Z$/)]);
  expect(mocks.health).not.toHaveBeenCalled();
  count = 5; expect(await replacementPreflight('behavioral_demand', workspace)).toBeNull();
});
it('keeps a failed count query explicit and does not authorize new work', async () => {
  vi.stubEnv('OPENPLAN_MONTHLY_RUN_CAP', '10'); error = { message: 'supplied count unavailable', code: 'fixture' };
  expect(await replacementPreflight('aequilibrae', workspace)).toEqual({ message: 'Failed to validate the run limit', status: 500 });
  expect(mocks.health).not.toHaveBeenCalled();
});
