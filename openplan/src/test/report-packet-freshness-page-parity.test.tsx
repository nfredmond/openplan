vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { loadReportPacketFreshness } from "@/lib/reports/packet-freshness-loader";
import { evaluateProjectOverviewPacketFreshness, latestArtifactByReport } from "@/lib/reports/packet-freshness-rules";
import { createFakeSupabase, type Db } from "./helpers/fake-my-work-tables";
import { buildFreshnessDb, FRESH_P1, FRESH_WS } from "./helpers/report-freshness-fixtures";

/**
 * PAGE-OUTPUT PARITY: the shared loader must say what each page says.
 *
 * The Reports page is rendered from the same in-memory database the loader
 * reads, through its own reads and its own markup, and every report card's
 * freshness badge and sentence are compared with the loader's verdict.
 *
 * The Project page reads about forty tables, so it is not rendered here.
 * Instead its two report reads are replayed with the exact projections taken
 * from the page source, and its rule is applied to them as the page does.
 * Its own tests (`project-detail-page.test.tsx`, unchanged) cover the render.
 */

const createClientMock = vi.fn();
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: (...args: unknown[]) => createClientMock(...args) }));
vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: async () => ({
    membership: { workspace_id: "aaaaaaaa-0000-4000-8000-000000000001" },
    workspace: { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Parity workspace" },
  }),
}));
vi.mock("@/components/reports/report-creator", () => ({ ReportCreator: () => <div data-testid="report-creator" /> }));

import ReportsPage from "@/app/(app)/reports/page";

async function renderReportsPage(db: Db, failures: Record<string, string> = {}) {
  const fake = createFakeSupabase(db, failures);
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: fake.client.from,
  });
  const view = render(await ReportsPage({ searchParams: Promise.resolve({}) }));
  const cards = new Map<string, { label: string; detail: string }>();
  for (const heading of view.container.querySelectorAll("h3.module-record-title")) {
    const card = heading.closest(".module-record-row")!;
    const badges = [...card.querySelectorAll(".module-record-kicker > *")].map((node) => node.textContent ?? "");
    const detail = card.querySelector("p.text-sm.text-muted-foreground")?.textContent ?? "";
    cards.set(heading.textContent ?? "", { label: badges[1] ?? "", detail });
  }
  view.unmount();
  return cards;
}

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), ...relativePath.split("/")), "utf8");
}

/** The projection of the first `.select(` after `.from("<table>")` at or after `from`. */
function selectAfter(source: string, table: string, from = 0): string {
  const fromAt = source.indexOf(`.from("${table}")`, from);
  const selectAt = source.indexOf(".select(", fromAt);
  const quote = source.indexOf('"', selectAt);
  return source.slice(quote + 1, source.indexOf('"', quote + 1));
}

describe("Reports page and the shared loader agree", () => {
  it.each([
    ["every source readable", {}],
    ["crash evidence unreadable", { safety_crash_ingests: "permission denied for table safety_crash_ingests" }],
  ])("shows the loader's verdict on every card: %s", async (_label, failures: Record<string, string>) => {
    const db = buildFreshnessDb();
    const cards = await renderReportsPage(db, failures);
    const loaded = await loadReportPacketFreshness(createFakeSupabase(db, failures).client, { workspaceId: FRESH_WS });

    expect(loaded.entries.length).toBeGreaterThan(0);
    expect([...cards.keys()].sort()).toEqual(loaded.entries.map((entry) => entry.title).sort());
    for (const entry of loaded.entries) {
      expect(cards.get(entry.title), entry.title).toEqual({ label: entry.freshness.label, detail: entry.freshness.detail });
    }
  });
});

describe("Project page and the shared loader agree", () => {
  const pageSource = sourceOf("src/app/(app)/projects/[projectId]/page.tsx");
  const reportSelect = selectAfter(pageSource, "reports");
  const artifactSelect = selectAfter(pageSource, "report_artifacts", pageSource.indexOf("const reportArtifactsResult"));

  it("replays the page's own projections", () => {
    // No metadata_json: the page's rule skips the guided-comparison checks.
    expect(reportSelect).toBe("id, title, summary, report_type, status, updated_at, generated_at, latest_artifact_kind");
    expect(artifactSelect).toBe("report_id, generated_at, metadata_json");
    expect(pageSource).toContain("evaluateProjectOverviewPacketFreshness({");
  });

  it("gives every project report the loader's verdict", async () => {
    const db = buildFreshnessDb();
    const { client } = createFakeSupabase(db);
    // The page's reads, as the page issues them (four reports, newest first).
    const reports = (await client.from("reports").select(reportSelect).eq("project_id", FRESH_P1)
      .order("updated_at", { ascending: false }).limit(4)).data as Array<{ id: string; title: string; latest_artifact_kind: string | null; generated_at: string | null; updated_at: string }>;
    const artifacts = (await client.from("report_artifacts").select(artifactSelect).in("report_id", reports.map((report) => report.id))
      .order("generated_at", { ascending: false })).data as Array<{ report_id: string; generated_at: string; metadata_json: Record<string, unknown> | null }>;
    const project = (db.projects as Array<Record<string, unknown>>).find((row) => row.id === FRESH_P1);
    const latest = latestArtifactByReport(artifacts);

    const loaded = await loadReportPacketFreshness(createFakeSupabase(db).client, { workspaceId: FRESH_WS, projectId: FRESH_P1, rule: "project_overview" });
    const byId = new Map(loaded.entries.map((entry) => [entry.reportId, entry]));
    expect(reports.length).toBe(4);
    for (const report of reports) {
      const pageFreshness = evaluateProjectOverviewPacketFreshness({ report, latestArtifact: latest.get(report.id), project });
      expect(byId.get(report.id)?.freshness, report.title).toEqual(pageFreshness);
    }
  });
});
