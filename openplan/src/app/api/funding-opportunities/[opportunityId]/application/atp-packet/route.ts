import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadFundingOpportunityAccess } from "@/lib/programs/api";
import {
  APPLICATION_PENDING_SCHEMA_ERROR,
  looksLikePendingAssemblySchema,
} from "@/lib/grants/application";
import {
  buildAtpPacketView,
  isAtpApplication,
  type AtpPacketRun,
  type SeededSectionFacts,
} from "@/lib/grants/atp-packet";
import { renderAtpPacketMarkdown } from "@/lib/planner-pack/render";
import { APP_VERSION } from "@/lib/runtime/app-version";

/**
 * The ATP scoring packet for one application, read-only. JSON for the panel;
 * `?format=markdown` returns the rendered packet as a download.
 *
 * The packet exists only for an application seeded from the ATP template
 * (`isAtpApplication`); every other application answers 404. Scores come from
 * the linked project's latest corridor analysis run. This route writes nothing
 * and calls no language model.
 */

const paramsSchema = z.object({
  opportunityId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ opportunityId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("funding-opportunities.application.atp-packet", request);

  try {
    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid funding opportunity id" }, { status: 400 });
    }
    const wantsMarkdown = request.nextUrl.searchParams.get("format") === "markdown";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadFundingOpportunityAccess(
      supabase,
      parsedParams.data.opportunityId,
      user.id,
      "programs.read"
    );
    if (access.error) {
      audit.error("funding_opportunity_access_failed", {
        opportunityId: parsedParams.data.opportunityId,
        userId: user.id,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to load funding opportunity" }, { status: 500 });
    }
    if (!access.opportunity) {
      return NextResponse.json({ error: "Funding opportunity not found" }, { status: 404 });
    }
    if (!access.membership || !access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }
    const opportunity = access.opportunity;

    const sectionsResult = await supabase
      .from("funding_opportunity_application_sections")
      .select("section_key, source")
      .eq("opportunity_id", opportunity.id);
    if (sectionsResult.error) {
      if (looksLikePendingAssemblySchema(sectionsResult.error.message)) {
        return NextResponse.json({ error: APPLICATION_PENDING_SCHEMA_ERROR }, { status: 503 });
      }
      audit.error("atp_packet_sections_failed", {
        opportunityId: opportunity.id,
        message: sectionsResult.error.message,
      });
      return NextResponse.json({ error: "Failed to load the application" }, { status: 500 });
    }
    if (!isAtpApplication((sectionsResult.data ?? []) as SeededSectionFacts[])) {
      return NextResponse.json(
        { error: "This application was not set up from the ATP template." },
        { status: 404 }
      );
    }

    const projectId = typeof opportunity.project_id === "string" ? opportunity.project_id : null;
    if (!projectId) {
      return NextResponse.json({ packet: null, missing: "project" });
    }

    const [projectResult, runResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id, name")
        .eq("id", projectId)
        .eq("workspace_id", opportunity.workspace_id)
        .maybeSingle(),
      supabase
        .from("runs")
        .select("id, title, created_at, metrics")
        .eq("workspace_id", opportunity.workspace_id)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    // A failed read is not "no run": it would turn every score into "not recorded".
    if (projectResult.error || runResult.error) {
      audit.error("atp_packet_evidence_failed", {
        opportunityId: opportunity.id,
        message: projectResult.error?.message ?? runResult.error?.message,
      });
      return NextResponse.json({ error: "Failed to load the project's analysis runs" }, { status: 500 });
    }

    const project = projectResult.data as { id?: unknown; name?: unknown } | null;
    if (!project || typeof project.id !== "string") {
      return NextResponse.json({ packet: null, missing: "project" });
    }

    const runs = (runResult.data ?? []) as AtpPacketRun[];
    const view = buildAtpPacketView({
      project: { id: project.id, name: typeof project.name === "string" ? project.name : project.id },
      run: runs[0] ?? null,
    });

    if (wantsMarkdown) {
      const markdown = renderAtpPacketMarkdown(view.packet, {
        runId: view.packet.run_id,
        engineVersion: `OpenPlan ${APP_VERSION}`,
      });
      return new NextResponse(markdown, {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="atp-scoring-packet-${view.packet.generated_at.slice(0, 10)}.md"`,
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json({ ...view, missing: null });
  } catch (error) {
    audit.error("atp_packet_unhandled", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to build the ATP packet" }, { status: 500 });
  }
}
