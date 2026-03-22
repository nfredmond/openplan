import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess } from "@/lib/engagement/api";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

type ExportItemRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  body: string;
  submitted_by: string | null;
  status: string;
  source_type: string;
  latitude: number | null;
  longitude: number | null;
  moderation_notes: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ExportCategoryRow = {
  id: string;
  label: string;
  slug: string | null;
};

function escapeCSVField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCSV(items: ExportItemRow[], categoryMap: Map<string, string>): string {
  const headers = [
    "id", "title", "body", "submitted_by", "status", "source_type",
    "category_id", "category_label", "latitude", "longitude",
    "moderation_notes", "created_at", "updated_at",
  ];

  const rows = items.map((item) => [
    escapeCSVField(item.id),
    escapeCSVField(item.title),
    escapeCSVField(item.body),
    escapeCSVField(item.submitted_by),
    escapeCSVField(item.status),
    escapeCSVField(item.source_type),
    escapeCSVField(item.category_id),
    escapeCSVField(item.category_id ? categoryMap.get(item.category_id) ?? "" : ""),
    item.latitude !== null ? String(item.latitude) : "",
    item.longitude !== null ? String(item.longitude) : "",
    escapeCSVField(item.moderation_notes),
    escapeCSVField(item.created_at),
    escapeCSVField(item.updated_at),
  ].join(","));

  return [headers.join(","), ...rows].join("\n");
}

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.export", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const format = request.nextUrl.searchParams.get("format") ?? "csv";
    const statusFilter = request.nextUrl.searchParams.get("status") ?? null;

    if (format !== "csv" && format !== "json") {
      return NextResponse.json({ error: "Supported formats: csv, json" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.read");

    if (access.error) {
      audit.error("export_access_failed", {
        campaignId: parsedParams.data.campaignId,
        message: access.error.message,
      });
      return NextResponse.json({ error: "Failed to verify access" }, { status: 500 });
    }

    if (!access.campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const [{ data: categories }, { data: itemsData, error: itemsError }] = await Promise.all([
      supabase
        .from("engagement_categories")
        .select("id, label, slug")
        .eq("campaign_id", access.campaign.id),
      (() => {
        let query = supabase
          .from("engagement_items")
          .select("id, campaign_id, category_id, title, body, submitted_by, status, source_type, latitude, longitude, moderation_notes, metadata_json, created_at, updated_at")
          .eq("campaign_id", access.campaign.id)
          .order("created_at", { ascending: true });

        if (statusFilter) {
          query = query.eq("status", statusFilter);
        }

        return query;
      })(),
    ]);

    if (itemsError) {
      audit.error("export_items_failed", { message: itemsError.message });
      return NextResponse.json({ error: "Failed to load items for export" }, { status: 500 });
    }

    const items = (itemsData ?? []) as ExportItemRow[];
    const categoryMap = new Map(
      ((categories ?? []) as ExportCategoryRow[]).map((c) => [c.id, c.label])
    );

    audit.info("export_completed", {
      userId: user.id,
      campaignId: access.campaign.id,
      format,
      itemCount: items.length,
      durationMs: Date.now() - startedAt,
    });

    if (format === "json") {
      const exportData = {
        campaign: {
          id: access.campaign.id,
          title: access.campaign.title,
          status: access.campaign.status,
          exportedAt: new Date().toISOString(),
        },
        categories: (categories ?? []) as ExportCategoryRow[],
        items: items.map((item) => ({
          ...item,
          categoryLabel: item.category_id ? categoryMap.get(item.category_id) ?? null : null,
        })),
        meta: {
          totalItems: items.length,
          statusFilter,
        },
      };

      return new NextResponse(JSON.stringify(exportData, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="engagement-${access.campaign.id}-export.json"`,
        },
      });
    }

    const csv = buildCSV(items, categoryMap);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="engagement-${access.campaign.id}-export.csv"`,
      },
    });
  } catch (error) {
    audit.error("export_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error during export" }, { status: 500 });
  }
}
