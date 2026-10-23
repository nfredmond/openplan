import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), dispatch: vi.fn(), preflight: vi.fn(), auth: vi.fn(), access: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.query }), createServiceRoleClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/models/api', () => ({ loadModelAccess: mocks.access }));
vi.mock('@/lib/models/population-replacement-server', () => ({ replacementPreflight: mocks.preflight, dispatchPopulationReplacement: mocks.dispatch }));
vi.mock('@/lib/observability/audit', () => ({ createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { POST } from '@/app/api/models/[modelId]/runs/[modelRunId]/recovery/route';
const [actor, workspace, model, run, stage, checkpoint, requestId, next] = Array.from({ length: 8 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
const state = { run_id: run, workspace_id: workspace, model_id: model, status: 'failed' as const,
 updated_at: '2026-10-18T00:00:00Z', attempt_managed: false,
 stages: [{ id: stage, status: 'failed' as const, updated_at: '2026-10-18T00:00:00Z', attempt_managed: false, active_attempt_id: null }] };
const decision = { requestId, decision: 'create_population_replacement', expectedState: state,
 checkpointId: checkpoint, checkpointSha256: 'a'.repeat(64), reason: 'Retain this exact population', acknowledgedNewRun: true };
const receipt = () => ({ schema: 'openplan.population-replacement.v1', request_id: requestId, outcome: 'replacement_created',
 replacement_run_id: next, engine_key: 'aequilibrae', old_run_changed: false, model_resumed: false,
 request_payload: { workspace_id: workspace, run_id: run, actor_id: actor, expected_state: state,
 checkpoint_id: checkpoint, checkpoint_sha256: 'a'.repeat(64), reason: decision.reason, acknowledged_new_run: true } });
const context = { params: Promise.resolve({ modelId: model, modelRunId: run }) };
const request = (body: unknown = decision, extra: Record<string, string> = {}) => new NextRequest('http://localhost/api/recovery', {
 method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json',
 'x-openplan-expected-user': actor, 'x-openplan-expected-workspace': workspace, ...extra }, body: JSON.stringify(body) });
beforeEach(() => {
 vi.clearAllMocks(); mocks.auth.mockResolvedValue({ data: { user: { id: actor } } });
 mocks.access.mockResolvedValue({ model: { id: model, workspace_id: workspace }, membership: { workspace_id: workspace, role: 'owner' }, allowed: true });
 const query = { select: vi.fn().mockImplementation((columns: string) => { expect(columns).toBe('id, model_id, workspace_id, engine_key'); return query; }),
 eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: run, model_id: model, workspace_id: workspace, engine_key: 'aequilibrae' }, error: null }) };
 mocks.query.mockReturnValue(query); mocks.preflight.mockResolvedValue(null); mocks.dispatch.mockResolvedValue({ state: 'accepted' });
 mocks.rpc.mockImplementation(async (name: string) => name === 'read_model_population_replacement_receipt'
 ? { data: null, error: null } : { data: receipt(), error: null });
});
it('runs the real recovery route and keeps creation confirmed when dispatch is lost', async () => {
 mocks.dispatch.mockRejectedValue(new Error('supplied lost doorbell'));
 const result = await POST(request(), context); expect(result.status).toBe(200); expect(await result.json()).toEqual(receipt());
 expect(mocks.rpc).toHaveBeenCalledTimes(2);
 expect(mocks.rpc.mock.calls[1]).toEqual(['create_model_population_replacement', {
 p_request_id: requestId, p_workspace_id: workspace, p_run_id: run, p_actor_id: actor, p_expected_state: state,
 p_checkpoint_id: checkpoint, p_checkpoint_sha256: 'a'.repeat(64), p_reason: decision.reason, p_acknowledged_new_run: true }]);
 expect(mocks.dispatch).toHaveBeenCalledWith(requestId, next, 'aequilibrae');
});
it('recovers a committed creation from the same request without checking capacity or creating again', async () => {
 mocks.preflight.mockResolvedValue({ message: 'Configured compute cap reached', status: 429 });
 mocks.rpc.mockResolvedValue({ data: receipt(), error: null });
 const result = await POST(request(), context); expect(result.status).toBe(200);
 expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(mocks.preflight).not.toHaveBeenCalled();
 expect(await result.json()).toEqual(receipt());
});
it('refuses a fresh replacement at the configured compute cap before native creation', async () => {
 mocks.preflight.mockResolvedValue({ message: 'Configured compute cap reached', status: 429 });
 const result = await POST(request(), context); expect(result.status).toBe(429);
 expect(mocks.rpc).toHaveBeenCalledTimes(1);
 expect(mocks.rpc.mock.calls[0][0]).toBe('read_model_population_replacement_receipt');
 expect(mocks.dispatch).not.toHaveBeenCalled();
});
it.each(['replacement_run_id', 'old_run_changed', 'request_payload'])('keeps a changed %s receipt unconfirmed or conflicted', async (field) => {
 const wrong = { ...receipt(), [field]: field === 'replacement_run_id' ? run : field === 'old_run_changed' ? true : {} };
 mocks.rpc.mockResolvedValue({ data: wrong, error: null });
 expect((await POST(request(), context)).status).toBe(409); expect(mocks.dispatch).not.toHaveBeenCalled();
});
it('refuses explicit agents before native effects', async () => {
 expect((await POST(request(decision, { 'x-openplan-assistant-execution-source': 'planner_agent' }), context)).status).toBe(403);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('requires exact acknowledged operator intent', async () => {
 expect((await POST(request({ ...decision, acknowledgedNewRun: false }), context)).status).toBe(400);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('leaves lost native creation unconfirmed and never dispatches an inferred run', async () => {
 mocks.rpc.mockImplementation(async (name: string) => { if (name === 'create_model_population_replacement') throw new Error('supplied lost reply'); return { data: null, error: null }; });
 expect((await POST(request(), context)).status).toBe(503); expect(mocks.dispatch).not.toHaveBeenCalled();
});
