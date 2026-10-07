import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({ client: null as unknown, service: null as unknown, writes: [] as Record<string, unknown>[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => h.client, createServiceRoleClient: () => h.service }));
vi.mock('@/lib/observability/audit', () => ({ createApiAuditLogger: () => ({ info() {}, warn() {}, error() {} }) }));
vi.mock('@/lib/programs/api', () => ({ loadProjectAccess: async () => ({ project: { id: '44444444-4444-4444-8444-444444444444', workspace_id: '33333333-3333-4333-8333-333333333333' }, membership: { role: 'member' }, allowed: true }) }));
import { PATCH } from '@/app/api/projects/[projectId]/funding-profile/route';
import { hashAssistantActionPayload } from '@/lib/assistant/action-approval-server';
const projectId = '44444444-4444-4444-8444-444444444444';
const workspaceId = '33333333-3333-4333-8333-333333333333';
const userId = '22222222-2222-4222-8222-222222222222';
const approvalId = '11111111-1111-4111-8111-111111111111';
async function run(body: Record<string, unknown>) {
  h.writes = [];
  const approved = { kind: 'create_project_funding_profile', projectId, notes: 'Approved profile note' };
  const inputHash = hashAssistantActionPayload(approved);
  let consumed = false;
  h.service = { from(table: string) {
    if (table === 'assistant_action_executions') return { insert: async () => ({ error: null }) };
    if (table !== 'assistant_action_approvals') throw new Error(table);
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: approvalId, workspace_id: workspaceId, user_id: userId, action_kind: approved.kind, input_hash: inputHash, expires_at: new Date(Date.now() + 300000).toISOString(), consumed_at: consumed ? new Date().toISOString() : null, created_at: new Date().toISOString() }, error: null }) }) }),
      update: () => ({ eq: () => ({ is: () => ({ select: async () => { const data = consumed ? [] : [{ id: approvalId }]; consumed = true; return { data, error: null }; } }) }) })
    };
  } };
  h.client = { auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, from(table: string) {
    if (table !== 'project_funding_profiles') throw new Error(table);
    return { upsert: (payload: Record<string, unknown>) => { h.writes.push(payload); return { select: () => ({ single: async () => ({ data: payload, error: null }) }) }; } };
  } };
  const response = await PATCH(new NextRequest(`http://localhost/api/projects/${projectId}/funding-profile`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openplan-assistant-execution-source': 'planner_agent_quick_link', 'x-openplan-assistant-input-hash': inputHash, 'x-openplan-assistant-approval-id': approvalId }, body: JSON.stringify(body) }), { params: Promise.resolve({ projectId }) });
  return { status: response.status, consumed, writes: h.writes };
}
describe('Review observation: financial fields outside approved payload', () => {
  it('accepts unchanged approved note and normal null amounts', async () => { expect(await run({ notes: 'Approved profile note', fundingNeedAmount: null, localMatchNeedAmount: null })).toMatchObject({ status: 200, consumed: true }); });
  it('harmless JSON property order preserves behavior', async () => { expect(await run({ localMatchNeedAmount: null, fundingNeedAmount: null, notes: 'Approved profile note' })).toMatchObject({ status: 200, consumed: true }); });
  it('rejects a changed signed note before a financial write', async () => { expect(await run({ notes: 'Changed note', fundingNeedAmount: 9999999 })).toEqual({ status: 403, consumed: false, writes: [] }); });
  it('demonstrates changed unsigned financial values reach write with unchanged approval', async () => {
    const observed = await run({ notes: 'Approved profile note', fundingNeedAmount: 9999999, localMatchNeedAmount: 7777777 });
    expect(observed).toMatchObject({ status: 200, consumed: true, writes: [{ funding_need_amount: 9999999, local_match_need_amount: 7777777 }] });
  });
});
