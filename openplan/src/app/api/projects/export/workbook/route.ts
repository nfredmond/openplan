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

    const result = await supabase
      .from("projects")
      .select(PROJECT_EXPORT_COLUMNS)
      .eq("workspace_id", membership.workspace_id)
      .order("updated_at", { ascending: false })
      .limit(PORTFOLIO_IMPORT_MAX_ROWS + 1);
    if (result.error) {
      audit.error("portfolio_workbook_read_failed", {
        workspaceId: membership.workspace_id,
        code: result.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to read the project portfolio" }, { status: 500 });
    }

    const projects = (result.data ?? []) as unknown as PortfolioRoundTripProject[];
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
    const costsWithoutPriceYear = projects.filter(
      (project) => project.estimated_cost_amount != null && project.estimated_cost_basis_year == null
    );
    if (costsWithoutPriceYear.length > 0) {
      const count = costsWithoutPriceYear.length;
      audit.warn("portfolio_workbook_cost_year_missing", {
        workspaceId: membership.workspace_id,
        affectedProjects: count,
      });
      return NextResponse.json(
        {
          error: `${count.toLocaleString("en-US")} project cost estimate${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} no price year. The round-trip workbook was not generated because filling that gap would invent evidence. Add the recorded price year or clear the estimate first.`,
          code: "cost_price_year_missing",
        },
        { status: 409 }
      );
    }

    const generatedAt = new Date();
    const workspaceName = workspace.name?.trim() || "Workspace";
    const bytes = buildPortfolioRoundTripWorkbook({
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
