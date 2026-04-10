import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createDefaultTargetedReportSections } from "@/lib/reports/catalog";

function looksLikePendingSchema(message: string | null | undefined) {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

const applyPacketPresetsSchema = z.object({
  cycleIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(request: NextRequest) {
  const audit = createApiAuditLogger("rtp_cycles.packet_presets", request);
  const startedAt = Date.now();

  try {
    const payload = applyPacketPresetsSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      audit.warn("validation_failed", { issues: payload.error.issues });
      return NextResponse.json({ error: "Invalid packet preset update payload" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const uniqueCycleIds = [...new Set(payload.data.cycleIds)];
    const { data: cycles, error: cyclesError } = await supabase
      .from("rtp_cycles")
      .select("id, workspace_id, status, title")
      .in("id", uniqueCycleIds);

    if (cyclesError) {
      audit.error("cycle_lookup_failed", { message: cyclesError.message, code: cyclesError.code ?? null });
      return NextResponse.json({ error: "Failed to load RTP cycles" }, { status: 500 });
    }

    if ((cycles ?? []).length !== uniqueCycleIds.length) {
      return NextResponse.json({ error: "One or more RTP cycles could not be found" }, { status: 404 });
    }

    const workspaceIds = [...new Set((cycles ?? []).map((cycle) => cycle.workspace_id))];
    const { data: memberships, error: membershipsError } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .in("workspace_id", workspaceIds);

    if (membershipsError) {
      audit.error("membership_lookup_failed", {
        message: membershipsError.message,
        code: membershipsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify workspace access" }, { status: 500 });
    }

    const membershipByWorkspaceId = new Map((memberships ?? []).map((membership) => [membership.workspace_id, membership]));
    const unauthorizedCycle = (cycles ?? []).find((cycle) => {
      const membership = membershipByWorkspaceId.get(cycle.workspace_id);
      return !membership || !canAccessWorkspaceAction("reports.write", membership.role);
    });

    if (unauthorizedCycle) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const initialReportsLookupResult = await supabase
      .from("reports")
      .select("id, rtp_cycle_id, title, metadata_json")
      .in("rtp_cycle_id", uniqueCycleIds)
      .eq("report_type", "board_packet");

    const reportsLookupResult =
      initialReportsLookupResult.error && looksLikePendingSchema(initialReportsLookupResult.error.message)
        ? await supabase
            .from("reports")
            .select("id, rtp_cycle_id, title")
            .in("rtp_cycle_id", uniqueCycleIds)
            .eq("report_type", "board_packet")
        : initialReportsLookupResult;

    const { data: reports, error: reportsError } = reportsLookupResult;

    if (reportsError) {
      audit.error("reports_lookup_failed", { message: reportsError.message, code: reportsError.code ?? null });
      return NextResponse.json({ error: "Failed to load linked RTP packets" }, { status: 500 });
    }

    const cycleById = new Map((cycles ?? []).map((cycle) => [cycle.id, cycle]));
    const reportIds = (reports ?? []).map((report) => report.id);

    if (reportIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          updatedReportCount: 0,
          targetedCycleCount: uniqueCycleIds.length,
          skippedCycleCount: uniqueCycleIds.length,
        },
        { status: 200 }
      );
    }

    const { error: deleteSectionsError } = await supabase.from("report_sections").delete().in("report_id", reportIds);
    if (deleteSectionsError) {
      audit.error("sections_delete_failed", {
        message: deleteSectionsError.message,
        code: deleteSectionsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to replace existing packet sections" }, { status: 500 });
    }

    const nextSections = (reports ?? []).flatMap((report) => {
      const cycle = cycleById.get(report.rtp_cycle_id);
      const presetSections = createDefaultTargetedReportSections("board_packet", "rtp_cycle", {
        rtpCycleStatus: cycle?.status,
      });

      return presetSections.map((section, index) => ({
        report_id: report.id,
        section_key: section.sectionKey,
        title: section.title,
        enabled: section.enabled,
        sort_order: index,
        config_json: section.configJson ?? {},
      }));
    });

    if (nextSections.length > 0) {
      const { error: insertSectionsError } = await supabase.from("report_sections").insert(nextSections);
      if (insertSectionsError) {
        audit.error("sections_insert_failed", {
          message: insertSectionsError.message,
          code: insertSectionsError.code ?? null,
        });
        return NextResponse.json({ error: "Failed to apply recommended packet presets" }, { status: 500 });
      }
    }

    for (const report of reports ?? []) {
      const updateResult = await supabase
        .from("reports")
        .update({
          metadata_json: {
            queueTrace: {
              action: "reset_layout",
              actedAt: new Date().toISOString(),
              actorUserId: user.id,
              source: "rtp_cycles.packet_presets",
              detail: "Applied recommended RTP packet preset.",
            },
          },
        })
        .eq("id", report.id);

      if (updateResult.error && !looksLikePendingSchema(updateResult.error.message)) {
        audit.error("report_trace_update_failed", {
          reportId: report.id,
          message: updateResult.error.message,
          code: updateResult.error.code ?? null,
        });
        return NextResponse.json({ error: "Failed to persist packet preset trace" }, { status: 500 });
      }
    }

    audit.info("packet_presets_applied", {
      userId: user.id,
      targetedCycleCount: uniqueCycleIds.length,
      updatedReportCount: reportIds.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        success: true,
        updatedReportCount: reportIds.length,
        targetedCycleCount: uniqueCycleIds.length,
        skippedCycleCount: Math.max(uniqueCycleIds.length - new Set((reports ?? []).map((report) => report.rtp_cycle_id)).size, 0),
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("unhandled_error", {
      durationMs: Date.now() - startedAt,
      error,
    });
    return NextResponse.json({ error: "Failed to apply recommended packet presets" }, { status: 500 });
  }
}
