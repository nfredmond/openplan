import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { retainRuleReconciliation } from '@/lib/land-use-plans/rule-reconciliation-recovery';
import { LandUsePlanWorkbench } from '@/components/land-use-plans/land-use-plan-workbench';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/components/models/study-area-picker', () => ({ StudyAreaPicker: () => <div>Study area picker</div> }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

function fixture(reviewRelease = false) {
  const version = { id: '10000000-0000-4000-8000-000000000001', draft_revision: 7, version_number: 1, version_kind: 'original', state: reviewRelease ? 'public_review' : 'working', applicable_requirement_keys: ['local'], content_hash: null, frozen_at: null, published_report_id: null };
  const node = (id: string, title: string, kind = 'section') => ({ id, title, node_kind: kind, parent_node_id: null, requirement_key: kind === 'section' ? 'local' : null, body: `Saved ${title}`, sort_order: 0, evidence_document_id: null, evidence_url: null });
  return {
    plan: { descriptor_id: 'local-unconfigured', plan_kind_key: 'community', id: '10000000-0000-4000-8000-000000000002', workspace_id: '10000000-0000-4000-8000-000000000003', title: 'EXERCISE ONLY draft custody', authority_label: 'Local planning', geography_label: 'Fixture geography', geography_geojson: null, current_working_version_id: version.id, current_adopted_version_id: null },
    descriptor: { id: 'local-unconfigured', configured: false, disclosure: 'Local legal requirements are not configured.', verifiedAt: '', reviewDueAt: '', terminology: { plan: 'plan', section: 'section', adoptionInstrument: 'instrument', implementationReport: 'report' }, requirements: [{ key: 'local', label: 'Local content', applicability: 'locally_defined', sourceUrls: [] }], processSteps: [], sourceUrls: [] },
    actorId: '10000000-0000-4000-8000-000000000004', descriptorHash: 'a'.repeat(64), canWrite: true, versions: [version], activeVersion: version,
    nodes: [node('section-a', 'First section'), node('section-b', 'Second section'), node('policy-a', 'Policy', 'policy')],
    relationships: [], designations: [{ id: 'designation', layer_id: 'layer', layer_version_id: 'layer-version', designation_set_label: 'EXERCISE ONLY', public_field_keys: [], legend_field: null, map_note: '' }], actions: [{ id: 'action', title: 'EXERCISE ONLY action', responsible_party: null, due_on: null, status: 'not_started', project_id: null, program_id: null }], reviews: [], decisions: [], reports: [], consultations: [], processRecords: [], reviewReleases: reviewRelease ? [{ id: 'release', version_id: version.id, version_content_hash: 'b'.repeat(64), round_number: 1, share_token: 'synthetic-review', review_method: 'external_process', review_open_on: '2026-10-01', review_close_on: '2026-10-31', engagement_campaign_id: null, status: 'open', outcome_hash: null, withdrawal_reason: null }] : [], layers: [], layerVersions: [], documents: [{ id: 'document-a', title: 'Source document', citation_label: null }], campaigns: [], projects: [], programs: [],
  };
}

async function setup(delay = false, options: { failSave?: boolean; failRefresh?: boolean; onWrite?: (saved: ReturnType<typeof fixture>) => void; reconciliation?: boolean; reviewRelease?: boolean } = {}) {
  localStorage.clear();
  const saved = fixture(options.reviewRelease);
  if (options.reconciliation) {
    saved.nodes[0].requirement_key = 'earlier';
    saved.nodes[1].requirement_key = null;
    saved.descriptor.requirements.push({ key: 'new-required', label: 'Current required section', applicability: 'required', sourceUrls: [] });
  }
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (_url.endsWith('/context')) return Response.json({ actorId:saved.actorId,workspaceId:saved.plan.workspace_id,planId:saved.plan.id,contextState:{status:'legacy'},contextHash:null,descriptorId:saved.descriptor.id,planKindKey:saved.plan.plan_kind_key,versionId:saved.plan.current_working_version_id,canWrite:saved.canWrite });
    if (!init?.method) return options.failRefresh && writes.length ? Response.json({ error: 'Read unavailable' }, { status: 503 }) : Response.json(saved);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    writes.push(body);
    if (delay) await pending;
    if (options.failSave) return Response.json({ error: 'Save rejected' }, { status: 409 });
    if (_url.endsWith('/reconcile-rules')) {
      const before = saved.activeVersion.draft_revision;
      const missing = saved.descriptor.requirements.filter(requirement => !saved.nodes.some(node => node.node_kind === 'section' && node.requirement_key === requirement.key));
      const added = missing.map((requirement, index) => ({ id: `10000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`, requirementKey: requirement.key }));
      saved.nodes.push(...missing.map((requirement, index) => ({ ...saved.nodes[0], id: added[index].id, requirement_key: requirement.key, title: requirement.label, body: '', evidence_document_id: null, evidence_url: null })));
      saved.activeVersion.applicable_requirement_keys = [...new Set([...saved.activeVersion.applicable_requirement_keys, ...saved.descriptor.requirements.filter(rule => rule.applicability !== 'conditional').map(rule => rule.key)])];
      saved.activeVersion.draft_revision += added.length + 1;
      return Response.json({ actorId: saved.actorId, workspaceId: saved.plan.workspace_id, planId: saved.plan.id,
        commandId: body.commandId, versionId: body.versionId, previousDraftRevision: before, draftRevision: saved.activeVersion.draft_revision,
        descriptorHash: body.expectedDescriptorHash, addedSections: added, applicableRequirementKeys: saved.activeVersion.applicable_requirement_keys,
        reconciledAt: '2026-10-07T00:00:00Z', replayed: false }, { status: 201 });
    }
    const node = saved.nodes.find((item) => item.id === body.nodeId);
    if (node) Object.assign(node, { body: body.body, ...(body.title ? { title: body.title } : {}), ...(Object.hasOwn(body, 'evidenceUrl') ? { evidence_url: body.evidenceUrl, evidence_document_id: body.evidenceDocumentId } : {}) });
    options.onWrite?.(saved);
    return Response.json({ updated: true });
  }));
  const view = render(<LandUsePlanWorkbench planId={saved.plan.id} />);
  const fields = await screen.findAllByPlaceholderText('Author the plan text, with evidence links and policy details.');
  await screen.findByText('Current saved context');
  return { saved, fields, writes, finish, view, buttons: screen.getAllByRole('button', { name: 'Save section' }) };
}

afterEach(cleanup);
describe('Live workbench draft custody', () => {
  it('control: saves the requested section and refreshes', async () => {
    const { saved, fields, buttons } = await setup();
    fireEvent.change(fields[0], { target: { value: 'Submitted first section' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(saved.nodes[0].body).toBe('Submitted first section');
    expect(fields[0]).toHaveValue('Submitted first section');
  });

  it('keeps another section draft when saving a different section', async () => {
    const { saved, fields, buttons } = await setup();
    fireEvent.change(fields[1], { target: { value: 'Unsaved second section' } });
    fireEvent.change(fields[0], { target: { value: 'Submitted first section' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(saved.nodes[0].body).toBe('Submitted first section');
    expect(saved.nodes[1].body).toBe('Saved Second section');
    expect(fields[1]).toHaveValue('Unsaved second section');
  });

  it('keeps typing in the saving section after the submitted snapshot', async () => {
    const { saved, fields, buttons, writes, finish } = await setup(true);
    fireEvent.change(fields[0], { target: { value: 'Submitted snapshot' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.change(fields[0], { target: { value: 'Newer local typing' } });
    await act(async () => finish());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(saved.nodes[0].body).toBe('Submitted snapshot');
    expect(fields[0]).toHaveValue('Newer local typing');
  });

  it('keeps unsaved section source selections and URLs', async () => {
    const { fields, buttons } = await setup();
    const section = fields[1].parentElement!;
    const source = within(section).getByRole('combobox');
    const url = within(section).getByLabelText('Official evidence URL');
    fireEvent.change(source, { target: { value: 'document-a' } });
    fireEvent.change(url, { target: { value: 'https://example.org/official-source' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(source).toHaveValue('document-a');
    expect(url).toHaveValue('https://example.org/official-source');
  });

  it('keeps unsaved policy text when a section is saved', async () => {
    const { buttons } = await setup();
    const body = screen.getByLabelText('Draft text');
    fireEvent.change(body, { target: { value: 'Unsaved policy text' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(body).toHaveValue('Unsaved policy text');
  });

  it('keeps a deliberate reversion to the old saved text during the request', async () => {
    const { saved, fields, buttons, writes, finish } = await setup(true);
    fireEvent.change(fields[0], { target: { value: 'Submitted snapshot' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.change(fields[0], { target: { value: 'Saved First section' } });
    await act(async () => finish());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(saved.nodes[0].body).toBe('Submitted snapshot');
    expect(fields[0]).toHaveValue('Saved First section');
    expect(screen.getByRole('status')).toHaveTextContent('Context, content or an unfinished form needs attention');
  });

  it('refreshes clean fields changed on the server rather than retaining every local value', async () => {
    const { fields, buttons } = await setup(false, { onWrite: (saved) => { saved.nodes[1].body = 'Server-updated clean section'; } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fields[1]).toHaveValue('Server-updated clean section');
  });

  it('retains both drafts after a refused save without claiming saved status', async () => {
    const { fields, buttons } = await setup(false, { failSave: true });
    fireEvent.change(fields[0], { target: { value: 'Refused first draft' } });
    fireEvent.change(fields[1], { target: { value: 'Unsaved second draft' } });
    fireEvent.click(buttons[0]);
    await screen.findByText('Save rejected');
    expect(fields[0]).toHaveValue('Refused first draft');
    expect(fields[1]).toHaveValue('Unsaved second draft');
    expect(screen.getByRole('status')).toHaveTextContent('Context, content or an unfinished form needs attention');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retains local drafts and the explicit error when a saved operation cannot refresh', async () => {
    const { fields, buttons } = await setup(false, { failRefresh: true });
    fireEvent.change(fields[0], { target: { value: 'Submitted first draft' } });
    fireEvent.change(fields[1], { target: { value: 'Unsaved second draft' } });
    fireEvent.click(buttons[0]);
    await screen.findByText('Read unavailable');
    expect(fields[0]).toHaveValue('Submitted first draft');
    expect(fields[1]).toHaveValue('Unsaved second draft');
    expect(screen.getByRole('status')).toHaveTextContent('Context, content or an unfinished form needs attention');
  });

  it('never acknowledges the only dirty field after its save is refused', async () => {
    const { fields, buttons, saved } = await setup(false, { failSave: true });
    fireEvent.change(fields[0], { target: { value: 'Only unsaved draft' } });
    fireEvent.click(buttons[0]);
    await screen.findByText('Save rejected');
    expect(saved.nodes[0].body).toBe('Saved First section');
    expect(fields[0]).toHaveValue('Only unsaved draft');
    expect(screen.getByRole('status')).toHaveTextContent('Context, content or an unfinished form needs attention');
    expect(screen.getByRole('button', { name: 'Freeze public draft' })).toBeDisabled();
  });

  it('blocks freezing until all edited content is actually saved', async () => {
    const { fields, buttons, writes } = await setup();
    const freeze = screen.getByRole('button', { name: 'Freeze public draft' });
    await waitFor(() => expect(freeze).toBeEnabled());
    fireEvent.change(fields[1], { target: { value: 'Unsubmitted section' } });
    expect(freeze).toBeDisabled();
    expect(screen.queryByText('The public draft is ready to freeze.')).not.toBeInTheDocument();
    expect(screen.getByText('Save edited context, sections, content nodes and staff forms, and review recovery copies before freezing.')).toBeVisible();
    fireEvent.click(freeze);
    expect(writes).toHaveLength(0);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(freeze).toBeEnabled());
    expect(screen.getByText('The public draft is ready to freeze.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Context, content and staff forms have no unsaved edits');
  });

  it('acknowledges a saved policy and displays its server-normalized title', async () => {
    await setup(false, { onWrite: (saved) => { saved.nodes[2].title = saved.nodes[2].title.trim(); } });
    const title = screen.getByLabelText('Title', { exact: true });
    const body = screen.getByLabelText('Draft text');
    fireEvent.change(title, { target: { value: '  Revised policy  ' } });
    fireEvent.change(body, { target: { value: 'Submitted policy body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save content node' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(title).toHaveValue('Revised policy');
    expect(body).toHaveValue('Submitted policy body');
    expect(screen.getByRole('status')).toHaveTextContent('Context, content and staff forms have no unsaved edits');
  });

  it('shows only stored frozen content after the server closes editing', async () => {
    const { fields, buttons } = await setup(false, { onWrite: (saved) => { saved.activeVersion.state = 'public_review'; } });
    fireEvent.change(fields[1], { target: { value: 'Unfrozen local draft' } });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fields[1]).toHaveValue('Saved Second section');
    expect(fields[1]).toBeDisabled();
    expect(screen.queryByDisplayValue('Unfrozen local draft')).not.toBeInTheDocument();
  });

  it.each(['plan', 'version'])('does not carry dirty values into another %s with reused fixture node IDs', async (boundary) => {
    const { fields, saved, view, buttons } = await setup();
    fireEvent.change(fields[1], { target: { value: 'Old-scope private draft' } });
    if (boundary === 'plan') {
      saved.plan.id = '10000000-0000-4000-8000-000000000005';
      saved.nodes[1].body = 'Different plan content';
      view.rerender(<LandUsePlanWorkbench planId={saved.plan.id} />);
    } else {
      saved.activeVersion.id = '10000000-0000-4000-8000-000000000006';
      saved.nodes[1].body = 'Different version content';
      fireEvent.click(buttons[0]);
    }
    await waitFor(() => expect(fields[1]).toHaveValue(boundary === 'plan' ? 'Different plan content' : 'Different version content'));
    expect(screen.queryByDisplayValue('Old-scope private draft')).not.toBeInTheDocument();
  });
});


describe('Working-plan checklist reconciliation integration', () => {
  const button = () => screen.getByRole('button', { name: 'Add reviewed checklist items' });
  async function reviewed(delay = false) {
    const state = await setup(delay, { reconciliation: true });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /I reviewed these section additions/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed these section additions/ }));
    await waitFor(() => expect(button()).toBeEnabled());
    return state;
  }
  it('adds reviewed blank sections while displaying retained keyed and unkeyed text', async () => {
    const { saved, fields, writes } = await reviewed();
    expect(screen.getAllByText('Earlier section outside the current checklist')).toHaveLength(2);
    expect(fields[0]).toBeEnabled(); expect(fields[1]).toBeEnabled();
    fireEvent.click(button());
    await screen.findByRole('textbox', { name: 'Current required section' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ operation: 'reconcile', versionId: saved.activeVersion.id, expectedDraftRevision: 7, expectedDescriptorHash: saved.descriptorHash });
    expect(saved.nodes.slice(0, 2).map(node => [node.id, node.body])).toEqual([['section-a', 'Saved First section'], ['section-b', 'Saved Second section']]);
    expect(screen.getByRole('textbox', { name: 'First section' })).toHaveValue('Saved First section');
    expect(screen.getByRole('textbox', { name: 'Second section' })).toHaveValue('Saved Second section');
    expect(screen.getByRole('textbox', { name: 'Current required section' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Add reviewed checklist items' })).not.toBeInTheDocument();
  });
  it.each(['section', 'document', 'url', 'policy', 'relationship', 'consultation'])('blocks reconciliation while %s edits are unsaved', async kind => {
    const { fields, writes } = await reviewed();
    if (kind === 'section') fireEvent.change(fields[0], { target: { value: 'Unsaved section' } });
    if (kind === 'document') fireEvent.change(within(fields[0].parentElement!).getByRole('combobox'), { target: { value: 'document-a' } });
    if (kind === 'url') fireEvent.change(within(fields[0].parentElement!).getByLabelText('Official evidence URL'), { target: { value: 'https://example.org/new-source' } });
    if (kind === 'policy') fireEvent.change(screen.getByLabelText('Draft text'), { target: { value: 'Unsaved policy' } });
    if (kind === 'relationship') fireEvent.change(screen.getByLabelText('Related plan label'), { target: { value: 'Unsaved relationship' } });
    if (kind === 'consultation') fireEvent.change(screen.getByLabelText('Confidential consultation notes'), { target: { value: 'SYNTHETIC private draft' } });
    expect(button()).toBeDisabled(); fireEvent.click(button()); expect(writes).toHaveLength(0);
  });
  it('unblocks after a staff form reverts to its original values', async () => {
    await reviewed(); const field = screen.getByLabelText('Related plan label');
    fireEvent.change(field, { target: { value: 'Changed' } }); expect(button()).toBeDisabled();
    fireEvent.change(field, { target: { value: '' } }); expect(button()).toBeEnabled();
  });
  it('resets an unchanged submitted staff form and clears its draft guard', async () => {
    const { writes } = await reviewed(); const field = screen.getByLabelText('Related plan label');
    fireEvent.change(field, { target: { value: 'Submitted relationship' } }); expect(button()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(field).toHaveValue(''));
    await waitFor(() => expect(button()).toBeEnabled());
    expect(writes[0]).toMatchObject({ relatedPlanLabel: 'Submitted relationship' });
  });
  it('keeps staff form text entered after submission and acknowledges only submitted bytes', async () => {
    const { writes, finish } = await reviewed(true); const field = screen.getByLabelText('Related plan label');
    fireEvent.change(field, { target: { value: 'Submitted relationship' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.change(field, { target: { value: 'Newer relationship draft' } });
    await act(async () => finish()); await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(field).toHaveValue('Newer relationship draft'); expect(button()).toBeDisabled();
    expect(writes[0]).toMatchObject({ relatedPlanLabel: 'Submitted relationship' });
    fireEvent.change(field, { target: { value: 'Submitted relationship' } });
    await waitFor(() => expect(button()).toBeEnabled());
  });
  it.each(['Disposition summary for external review', 'Reason for withdrawal'])('blocks saved checklist retries over unfinished %s', async label => {
    const { saved, writes } = await setup(false, { reviewRelease: true });
    retainRuleReconciliation(localStorage, { actorId: saved.actorId, workspaceId: saved.plan.workspace_id, planId: saved.plan.id,
      schemaVersion: 1, versionNumber: 1, savedAt: '2026-10-07T00:00:00Z', commandText: JSON.stringify({
        operation: 'reconcile', commandId: '10000000-0000-4000-8000-000000000090', versionId: saved.activeVersion.id,
        expectedDraftRevision: 7, expectedDescriptorHash: saved.descriptorHash }) });
    act(() => window.dispatchEvent(new StorageEvent('storage')));
    const retry = screen.getByRole('button', { name: 'Check or retry saved checklist change' });
    await waitFor(() => expect(retry).toBeEnabled());
    const field = screen.getByLabelText(label);
    fireEvent.change(field, { target: { value: 'Unfinished review text' } });
    expect(retry).toBeDisabled(); fireEvent.click(retry); expect(writes).toHaveLength(0);
    fireEvent.change(field, { target: { value: '' } }); expect(retry).toBeEnabled();
  });

});
