import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandUsePlanWorkbench } from '@/components/land-use-plans/land-use-plan-workbench';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

function fixture() {
  const version = { id: 'version-a', version_number: 1, version_kind: 'original', state: 'working', applicable_requirement_keys: ['local'], content_hash: null, frozen_at: null, published_report_id: null };
  const node = (id: string, title: string, kind = 'section') => ({ id, title, node_kind: kind, parent_node_id: null, requirement_key: kind === 'section' ? 'local' : null, body: `Saved ${title}`, sort_order: 0, evidence_document_id: null, evidence_url: null });
  return {
    plan: { id: 'plan-a', title: 'EXERCISE ONLY draft custody', authority_label: 'Local planning', geography_label: 'Fixture geography', geography_geojson: null, current_working_version_id: version.id, current_adopted_version_id: null },
    descriptor: { id: 'local-unconfigured', configured: false, disclosure: 'Local legal requirements are not configured.', verifiedAt: '', reviewDueAt: '', terminology: { plan: 'plan', section: 'section', adoptionInstrument: 'instrument', implementationReport: 'report' }, requirements: [{ key: 'local', label: 'Local content', applicability: 'locally_defined', sourceUrls: [] }], processSteps: [], sourceUrls: [] },
    canWrite: true, versions: [version], activeVersion: version,
    nodes: [node('section-a', 'First section'), node('section-b', 'Second section'), node('policy-a', 'Policy', 'policy')],
    relationships: [], designations: [{ id: 'designation', layer_id: 'layer', layer_version_id: 'layer-version', designation_set_label: 'EXERCISE ONLY', public_field_keys: [], legend_field: null, map_note: '' }], actions: [{ id: 'action', title: 'EXERCISE ONLY action', responsible_party: null, due_on: null, status: 'not_started', project_id: null, program_id: null }], reviews: [], decisions: [], reports: [], consultations: [], processRecords: [], reviewReleases: [], layers: [], layerVersions: [], documents: [{ id: 'document-a', title: 'Source document', citation_label: null }], campaigns: [], projects: [], programs: [],
  };
}

async function setup(delay = false, options: { failSave?: boolean; failRefresh?: boolean; onWrite?: (saved: ReturnType<typeof fixture>) => void } = {}) {
  const saved = fixture();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const writes: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return options.failRefresh && writes.length ? Response.json({ error: 'Read unavailable' }, { status: 503 }) : Response.json(saved);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    writes.push(body);
    if (delay) await pending;
    if (options.failSave) return Response.json({ error: 'Save rejected' }, { status: 409 });
    const node = saved.nodes.find((item) => item.id === body.nodeId);
    if (node) Object.assign(node, { body: body.body, ...(body.title ? { title: body.title } : {}), ...(Object.hasOwn(body, 'evidenceUrl') ? { evidence_url: body.evidenceUrl, evidence_document_id: body.evidenceDocumentId } : {}) });
    options.onWrite?.(saved);
    return Response.json({ updated: true });
  }));
  const view = render(<LandUsePlanWorkbench planId={saved.plan.id} />);
  const fields = await screen.findAllByPlaceholderText('Author the plan text, with evidence links and policy details.');
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
    const url = within(section).getByPlaceholderText('Official evidence URL');
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
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved content changes');
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
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved content changes');
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
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved content changes');
  });

  it('never acknowledges the only dirty field after its save is refused', async () => {
    const { fields, buttons, saved } = await setup(false, { failSave: true });
    fireEvent.change(fields[0], { target: { value: 'Only unsaved draft' } });
    fireEvent.click(buttons[0]);
    await screen.findByText('Save rejected');
    expect(saved.nodes[0].body).toBe('Saved First section');
    expect(fields[0]).toHaveValue('Only unsaved draft');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved content changes');
    expect(screen.getByRole('button', { name: 'Freeze public draft' })).toBeDisabled();
  });

  it('blocks freezing until all edited content is actually saved', async () => {
    const { fields, buttons, writes } = await setup();
    const freeze = screen.getByRole('button', { name: 'Freeze public draft' });
    expect(freeze).toBeEnabled();
    fireEvent.change(fields[1], { target: { value: 'Unsubmitted section' } });
    expect(freeze).toBeDisabled();
    expect(screen.queryByText('The public draft is ready to freeze.')).not.toBeInTheDocument();
    expect(screen.getByText('Save edited sections and content nodes before freezing.')).toBeVisible();
    fireEvent.click(freeze);
    expect(writes).toHaveLength(0);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(freeze).toBeEnabled();
    expect(screen.getByText('The public draft is ready to freeze.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('All section and content-node changes are saved');
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
    expect(screen.getByRole('status')).toHaveTextContent('All section and content-node changes are saved');
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
      saved.plan.id = 'plan-b';
      saved.nodes[1].body = 'Different plan content';
      view.rerender(<LandUsePlanWorkbench planId={saved.plan.id} />);
    } else {
      saved.activeVersion.id = 'version-b';
      saved.nodes[1].body = 'Different version content';
      fireEvent.click(buttons[0]);
    }
    await waitFor(() => expect(fields[1]).toHaveValue(boundary === 'plan' ? 'Different plan content' : 'Different version content'));
    expect(screen.queryByDisplayValue('Old-scope private draft')).not.toBeInTheDocument();
  });
});
