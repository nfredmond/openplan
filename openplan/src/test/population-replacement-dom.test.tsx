import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelRecoveryPanel } from '@/components/models/model-recovery-panel';
import { readRecoveryDecisions } from '@/lib/models/pending-recovery-decision';
const [userId, workspaceId, modelId, runId, stage, checkpoint, next] = Array.from({ length: 7 }, (_, i) => `${String(i + 1).padStart(8, '0')}-1111-4111-8111-111111111111`);
const scope = { userId, workspaceId, modelId, runId };
const state = { run_id: runId, workspace_id: workspaceId, model_id: modelId, status: 'failed',
 updated_at: '2026-10-18T00:00:00Z', attempt_managed: false,
 stages: [{ id: stage, status: 'failed', updated_at: '2026-10-18T00:00:00Z', attempt_managed: false, active_attempt_id: null }] };
const inspection = { expected_state: state, process_termination_verified: false, continuation_authorized: false, model_resumed: false,
 replacement: { state: 'available', checkpointId: checkpoint, checkpointSha256: 'a'.repeat(64), engineKey: 'aequilibrae' } };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('retains explicit new-run intent before sending and retries that request after reply loss', async () => {
 const bodies: Record<string, unknown>[] = [];
 vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
  if (options?.method !== 'POST') return Response.json(inspection);
  const body = JSON.parse(options.body); bodies.push(body);
  expect(readRecoveryDecisions(localStorage, scope).records[0].decision).toEqual(body);
  if (bodies.length === 1) throw new Error('Supplied lost create reply');
  return Response.json({ schema: 'openplan.population-replacement.v1', request_id: body.requestId,
   outcome: 'replacement_created', replacement_run_id: next, engine_key: 'aequilibrae', old_run_changed: false, model_resumed: false,
   request_payload: { workspace_id: workspaceId, run_id: runId, actor_id: userId, expected_state: state,
    checkpoint_id: checkpoint, checkpoint_sha256: 'a'.repeat(64), reason: body.reason, acknowledged_new_run: true } });
 }));
 render(<ModelRecoveryPanel {...scope} permission="allowed" />);
 screen.getByTestId('model-recovery-panel').setAttribute('open', '');
 fireEvent.click(screen.getByText('Review current execution state'));
 const reason = await screen.findByLabelText('Reason for replacement');
 fireEvent.change(reason, { target: { value: 'Keep the exact retained population' } });
 expect(screen.getByText('Create replacement using saved population')).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByText('Create replacement using saved population'));
 await waitFor(() => expect(bodies).toHaveLength(1));
 cleanup(); render(<ModelRecoveryPanel {...scope} permission="allowed" />);
 screen.getByTestId('model-recovery-panel').setAttribute('open', '');
 fireEvent.click(await screen.findByText('Retry saved decision'));
 const link = await screen.findByRole('link', { name: next });
 expect(link).toHaveAttribute('href', `/models/${modelId}#model-run-${next}`);
 expect(bodies).toHaveLength(2); expect(bodies[0]).toEqual(bodies[1]);
 expect(readRecoveryDecisions(localStorage, scope).records[0].phase).toBe('confirmed');
});
it('displays an unsupported transport without a replacement control', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...inspection,
  replacement: { state: 'unavailable', reason: 'Hosted snapshot transport remains unsupported.' } })));
 render(<ModelRecoveryPanel {...scope} permission="allowed" />);
 screen.getByTestId('model-recovery-panel').setAttribute('open', '');
 fireEvent.click(screen.getByText('Review current execution state'));
 await screen.findByText('Hosted snapshot transport remains unsupported.');
 expect(screen.queryByText('Create replacement using saved population')).not.toBeInTheDocument();
});
