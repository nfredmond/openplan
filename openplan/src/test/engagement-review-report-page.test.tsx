import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEngagementReviewReportPage } from '@/components/reports/specialized-report-page';
import ReportDetailPage from '@/app/(app)/reports/[reportId]/page';

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }));
vi.mock('@/components/reports/land-use-plan-report-page', () => ({ LandUsePlanReportPage: () => <h1>Retained land-use report</h1> }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('notFound'); },
  redirect: () => { throw new Error('redirect'); },
}));
vi.mock('@/components/reports/report-detail-controls', () => ({
  ReportDetailControls: ({ metadataOnly, report }: { metadataOnly?: boolean; report: { id: string } }) =>
    <section aria-label="Report editing" data-report={report.id} data-metadata-only={String(metadataOnly)} />,
}));
vi.mock('@/components/engagement/engagement-review-files', () => ({
  EngagementReviewFiles: ({ campaignId, reportId }: { campaignId: string; reportId: string }) =>
    <section aria-label="Retained file controls" data-campaign={campaignId} data-report={reportId} />,
}));

type Result = { data: unknown; error: { message: string } | null };
const report = { id: 'report-1', workspace_id: 'workspace-1', engagement_campaign_id: 'campaign-1', title: 'Saved consultation', summary: null, status: 'draft', generated_at: null };
let rows: Record<string, Result>;
let queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>;
const client = {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'staff-1' } } })) },
  from: vi.fn((table: string) => ({
    select: (columns: string) => {
      const query = { table, columns, filters: [] as Array<[string, unknown]> };
      queries.push(query);
      const builder = {
        eq: (column: string, value: unknown) => { query.filters.push([column, value]); return builder; },
        maybeSingle: async () => {
          if (!(table in rows)) throw new Error(`Unexpected table: ${table}`);
          return rows[table];
        },
      };
      return builder;
    },
  })),
};
const load = (value = report) => loadEngagementReviewReportPage(client as unknown as Parameters<typeof loadEngagementReviewReportPage>[0], value, 'staff-1');

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  rows = {
    workspace_members: { data: { role: 'member' }, error: null },
    reports: { data: report, error: null },
    engagement_report_jobs: { data: { id: 'job-1' }, error: null },
    engagement_campaigns: { data: { id: 'campaign-1', title: 'Current consultation', project_id: null }, error: null },
  };
  createClientMock.mockResolvedValue(client);
});

describe('saved engagement report context', () => {
  it('keeps report detail editing with a scoped role check and metadata-only controls', async () => {
    render(await load());
    expect(screen.getByRole('region', { name: 'Report editing' })).toHaveAttribute('data-report', report.id);
    expect(screen.getByRole('region', { name: 'Report editing' })).toHaveAttribute('data-metadata-only', 'true');
  });

  it.each(['viewer', 'unknown', 'absent', 'failed'])('refuses report editing for %s membership', async role => {
    rows.workspace_members = { data: ['absent', 'failed'].includes(role) ? null : { role }, error: role === 'failed' ? { message: 'disconnected' } : null };
    render(await load());
    expect(screen.queryByRole('region', { name: 'Report editing' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Retained file controls' })).toBeInTheDocument();
    if (role === 'failed') expect(screen.getByRole('alert')).toHaveTextContent('Editing permissions could not be loaded');
  });

  it('preserves the land-use report owner before campaign review lookup', async () => {
    rows.reports.data = { ...report, land_use_plan_id: 'plan-1' };
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: report.id }) }));
    expect(screen.getByRole('heading', { name: 'Retained land-use report' })).toBeVisible();
    expect(queries.map(q => q.table)).toEqual(['reports']);
  });

  it('uses the saved job before any generic project, grant or model reads in the real route', async () => {
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: report.id }) }));
    expect(screen.getByRole('heading', { name: report.title, level: 1 })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Retained file controls' })).toHaveAttribute('data-report', report.id);
    expect(queries.map(q => q.table)).toEqual(['reports', 'engagement_report_jobs', 'engagement_campaigns', 'workspace_members']);
  });

  it('scopes the real job and campaign queries and keeps the retained report selection', async () => {
    render(await load());
    expect(queries).toEqual([
      { table: 'engagement_report_jobs', columns: 'id', filters: [['report_id', report.id], ['campaign_id', report.engagement_campaign_id], ['workspace_id', report.workspace_id]] },
      { table: 'engagement_campaigns', columns: 'id, title, project_id', filters: [['id', report.engagement_campaign_id], ['workspace_id', report.workspace_id]] },
      { table: 'workspace_members', columns: 'role', filters: [['workspace_id', report.workspace_id], ['user_id', 'staff-1']] },
    ]);
    expect(screen.getByRole('link', { name: 'Open consultation' })).toHaveAttribute('href', '/engagement/campaign-1?tab=record');
    const files = screen.getByRole('region', { name: 'Retained file controls' });
    expect(files).toHaveAttribute('data-report', report.id);
    expect(files).toHaveAttribute('data-campaign', report.engagement_campaign_id);
    expect(screen.queryByRole('link', { name: 'Open project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('only reads a project when the current campaign supplies its ID', async () => {
    rows.engagement_campaigns.data = { id: 'campaign-1', title: 'Current consultation', project_id: 'project-1' };
    rows.projects = { data: { id: 'project-1', name: 'Current project name' }, error: null };
    render(await load());
    expect(queries.find(q => q.table === 'projects')).toEqual({ table: 'projects', columns: 'id, name', filters: [['id', 'project-1'], ['workspace_id', report.workspace_id]] });
    expect(screen.getByRole('link', { name: 'Open project' })).toHaveAttribute('href', '/projects/project-1');
    expect(screen.getByText('Current project: Current project name')).toBeVisible();
  });

  it('keeps the legacy route when a successful lookup finds no review job', async () => {
    rows.engagement_report_jobs.data = null;
    expect(await load()).toBeNull();
    expect(queries.map(q => q.table)).toEqual(['engagement_report_jobs']);
  });

  it('does not query review jobs for a report without a campaign', async () => {
    expect(await load({ ...report, engagement_campaign_id: '' })).toBeNull();
    expect(queries).toEqual([]);
  });

  it('refuses the generic route on a failed job read instead of treating failure as absence', async () => {
    rows.engagement_report_jobs = { data: null, error: { message: 'disconnected' } };
    render(await ReportDetailPage({ params: Promise.resolve({ reportId: report.id }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('saved review could not be loaded');
    expect(queries.map(q => q.table)).toEqual(['reports', 'engagement_report_jobs']);
    expect(screen.queryByRole('region', { name: 'Retained file controls' })).not.toBeInTheDocument();
  });

  it.each([false, true])('retains file controls with unavailable campaign context; failed read=%s', async failed => {
    rows.engagement_campaigns = { data: null, error: failed ? { message: 'disconnected' } : null };
    render(await load());
    expect(screen.getByText(failed ? /Current consultation details could not be loaded/ : /consultation is no longer available/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Retained file controls' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open consultation' })).not.toBeInTheDocument();
    expect(queries.some(q => q.table === 'projects')).toBe(false);
  });

  it.each([false, true])('retains file controls with unavailable project context; failed read=%s', async failed => {
    rows.engagement_campaigns.data = { id: 'campaign-1', title: 'Current consultation', project_id: 'project-1' };
    rows.projects = { data: null, error: failed ? { message: 'disconnected' } : null };
    render(await load());
    expect(screen.getByText(failed ? /Current project details could not be loaded/ : /linked project is no longer available/)).toBeVisible();
    expect(screen.getByRole('region', { name: 'Retained file controls' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open project' })).not.toBeInTheDocument();
  });
});
