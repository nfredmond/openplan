import { NextRequest, NextResponse } from "next/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import {
  buildPortfolioRoundTripWorkbook,
  PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
  portfolioRoundTripFilename,
  type PortfolioRoundTripProject,
} from "@/lib/projects/portfolio-export";
import { PROJECT_PLACE_SCOPE_COLUMNS } from "@/lib/projects/project-place";
import { PORTFOLIO_IMPORT_MAX_ROWS } from "@/lib/projects/portfolio-workbook";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const runtime = "nodejs";

const PROJECT_EXPORT_COLUMNS = [
  "id",
  "name",
  "summary",
  "status",
  "plan_type",
  "delivery_phase",
  "estimated_cost_amount",
  "estimated_cost_currency",
  "estimated_cost_basis_year",
  "estimated_cost_source_document_id",
  "estimated_cost_recorded_at",
  "created_at",
  "updated_at",
  PROJECT_PLACE_SCOPE_COLUMNS,
].join(", ");

/** Download the active workspace's portfolio without silently truncating it. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const audit = createApiAuditLogger("projects.export.workbook", request);
  const startedAt = Date.now();
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);
    if (!membership || !workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const projects: PortfolioRoundTripProject[] = [];
    const pageSize = 1_000;
    let lastId: string | null = null;
    // Page by identity so updated_at edits cannot move unread rows behind an
    // offset. Short response caps are not exhaustion. These separate reads do
    // not provide an atomic snapshot of row values or concurrent inserts/deletes.
    while (projects.length <= PORTFOLIO_IMPORT_MAX_ROWS) {
      let query = supabase
        .from("projects")
        .select(PROJECT_EXPORT_COLUMNS)
        .eq("workspace_id", membership.workspace_id)
        .order("id", { ascending: true });
      if (lastId !== null) query = query.gt("id", lastId);
      const result = await query.limit(Math.min(pageSize, PORTFOLIO_IMPORT_MAX_ROWS + 1 - projects.length));
      if (result.error || !result.data) {
        audit.error("portfolio_workbook_read_failed", {
          workspaceId: membership.workspace_id,
          code: result.error?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to read the project portfolio" }, { status: 500 });
      }
      const page = result.data as unknown as PortfolioRoundTripProject[];
      if (page.length === 0) break;
      projects.push(...page);
      lastId = page[page.length - 1].id;
    }

    if (projects.length > PORTFOLIO_IMPORT_MAX_ROWS) {
      audit.warn("portfolio_workbook_row_limit", {
        workspaceId: membership.workspace_id,
        minimumRows: projects.length,
      });
      return NextResponse.json(
        {
          error: `This workspace has more than ${PORTFOLIO_IMPORT_MAX_ROWS.toLocaleString("en-US")} projects. The round-trip workbook was not generated because the importer cannot review it without truncation.`,
          code: "row_limit",
        },
        { status: 409 }
      );
    }
    // Preserve the previous presentation order using the values actually read.
    projects.sort((left, right) => {
      const milliseconds = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      // PostgreSQL timestamps retain microseconds beyond JavaScript's milliseconds.
      const submillisecond = (value: string) => Number(
        (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6)
      );
      return milliseconds || submillisecond(right.updated_at) - submillisecond(left.updated_at)
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    });
    // The workbook leaves an unknown price year blank; the reviewed importer
    // preserves it as unknown instead of substituting its default year.

    const generatedAt = new Date();
    const workspaceName = workspace.name?.trim() || "Workspace";
    const bytes = await buildPortfolioRoundTripWorkbook({
      workspaceId: membership.workspace_id,
      workspaceName,
      projects,
      generatedAt,
    });
    const filename = portfolioRoundTripFilename(workspaceName, generatedAt);
    audit.info("portfolio_workbook_exported", {
      workspaceId: membership.workspace_id,
      userId: user.id,
      projectCount: projects.length,
      bytes: bytes.byteLength,
      durationMs: Date.now() - startedAt,
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": PORTFOLIO_ROUND_TRIP_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    audit.error("portfolio_workbook_export_failed", {
      code: error instanceof Error ? error.name : "unknown_error",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ error: "Unexpected error while exporting the project portfolio" }, { status: 500 });
  }
}
