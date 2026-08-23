import { readEveryPage } from "@/lib/supabase/paged-read";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, loadProjectAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { isWriteFailure, noRowsMatchedResponse, writeMatchedNoRows } from "@/lib/http/write-outcome";
import { placeKindSchema } from "@/lib/api/place-geographies";
import { corridorGeojsonSchema } from "@/lib/models/run-launch";
import { resolvePlaceBoundary } from "@/lib/geographies/place-resolver";
import {
  clearedProjectPlace,
  projectPlaceFromDrawnArea,
  projectPlaceFromPlaceBoundary,
} from "@/lib/projects/project-place";
import { loadPortalPlaceCandidates, resolvePortalMapFraming } from "@/lib/engagement/public-portal-data";
import {
  geofenceUpdateRefusal,
  placeCanGeofence,
  SUBMISSION_GEOFENCE_COLUMN,
} from "@/lib/engagement/geofence";
import {
  desiredCampaignProjectIds,
  diffCampaignProjectLinks,
  MAX_CAMPAIGN_PROJECT_LINKS,
} from "@/lib/engagement/campaign-projects";
import {
  isPublicSlugCandidate,
  normalizePublicSlugInput,
  PUBLIC_SLUG_FORMAT_REFUSAL,
  PUBLIC_SLUG_TAKEN_REFUSAL,
} from "@/lib/engagement/campaign-slugs";

// Setting a searched campaign area re-resolves the boundary through TIGERweb.
export const runtime = "nodejs";

const paramsSchema = z.object({
  campaignId: z.string().uuid(),
});

/**
 * A share token is the SOLE credential protecting a public engagement portal,
 * so it is never chosen by a caller and never written by this endpoint: POST
 * /api/engagement/campaigns/{campaignId}/share-token mints 144 bits of entropy
 * and saves it in one step, which is also the only way to rotate one.
 *
 * PATCH keeps exactly one token transition — DISABLE, an explicit null that
 * takes the public page offline — and refuses a caller-supplied token rather
 * than quietly ignoring it, so an API client learns where minting lives.
 */
const SHARE_TOKEN_IS_SERVER_MINTED =
  "Share tokens are minted server-side. Use POST /api/engagement/campaigns/{campaignId}/share-token to create or rotate the public link; this endpoint accepts only shareToken: null, which takes the link offline.";

const patchCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.union([z.string().trim().max(2000), z.null()]).optional(),
    status: z.enum(ENGAGEMENT_CAMPAIGN_STATUSES).optional(),
    engagementType: z.enum(ENGAGEMENT_TYPES).optional(),
    projectId: z.union([z.string().uuid(), z.null()]).optional(),
    /**
     * The FULL set of projects this campaign covers (20260810000003), lead
     * included — the console sends the whole checked list, not a delta, so a
     * stale browser cannot re-add a link somebody else just removed without
     * that removal being visible in the approval-shaped request body. The
     * route unions the lead in server-side, so omitting it here cannot
     * detach it.
     */
    projectIds: z.array(z.string().uuid()).max(MAX_CAMPAIGN_PROJECT_LINKS).optional(),
    rtpCycleId: z.union([z.string().uuid(), z.null()]).optional(),
    rtpCycleChapterId: z.union([z.string().uuid(), z.null()]).optional(),
    // Disable-only — see SHARE_TOKEN_IS_SERVER_MINTED above.
    shareToken: z.null().optional(),
    /**
     * The printable public address (20260810000002): /engage/{slug} instead of
     * the 28-character token. Loose here (any short string or null) so the
     * handler can normalize (trim + lowercase, exactly as the public resolution
     * path does before matching) and then refuse a bad format with the same
     * sentence the share-controls field uses — a zod issue would surface as a
     * generic "invalid payload". Null (or an emptied field) clears it.
     */
    publicSlug: z.union([z.string().max(200), z.null()]).optional(),
    publicDescription: z.union([z.string().trim().max(4000), z.null()]).optional(),
    /**
     * How a resident who cannot use the portal takes part anyway
     * (20260730000001). Agency-authored, never defaulted.
     *
     * Each is nullable so a field can be CLEARED, and each empty string is
     * normalised to null below rather than rejected: "I deleted this" is a
     * legitimate edit, while a blank string would be refused by the table's own
     * CHECK and surface to the operator as a validation error about a field
     * they intentionally emptied.
     */
    accessibilityContactLabel: z.union([z.string().trim().max(200), z.null()]).optional(),
    accessibilityContactEmail: z.union([z.string().trim().max(320), z.null()]).optional(),
    accessibilityContactPhone: z.union([z.string().trim().max(80), z.null()]).optional(),
    accessibilityAlternateFormats: z.union([z.string().trim().max(2000), z.null()]).optional(),
    allowPublicSubmissions: z.boolean().optional(),
    demographicsEnabled: z.boolean().optional(),
    /**
     * Refuse a submitted pin that falls outside this campaign's own area
     * (20260730000002). Opt-in, and refused outright unless an area with a
     * usable extent will be on record after this update — a check that cannot
     * run must never be storable, because an operator who believes
     * participation is being filtered when it is not is worse off than one who
     * knows it is not.
     */
    submissionGeofenceEnabled: z.boolean().optional(),
    /**
     * The area this campaign is about (20260729000003) — the area that frames
     * the resident-facing map, not a link to anything.
     *
     * A searched place is sent as a REFERENCE and re-resolved here, exactly as
     * `/api/projects/[projectId]` does it: a client-supplied bbox would be an
     * unverifiable geography wearing trusted-looking provenance, and this one is
     * published to every resident who opens the portal. A drawn area is sent as
     * geometry, because there is nothing to look it up by.
     */
    place: z
      .union([
        z.object({
          mode: z.literal("place"),
          kind: placeKindSchema,
          geoid: z.string().trim().min(5).max(7),
          label: z.string().trim().min(1).max(200).optional(),
        }),
        z.object({
          mode: z.literal("drawn"),
          geometry: corridorGeojsonSchema,
          label: z.string().trim().min(1).max(200).optional(),
        }),
        z.null(),
      ])
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.rtpCycleChapterId && value.rtpCycleId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rtpCycleId"],
        message: "An RTP chapter target requires an RTP cycle target.",
      });
    }
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "At least one field must be updated",
  });

type RouteContext = {
  params: Promise<{ campaignId: string }>;
};

/** The engagement-comment columns this route reads, as its counts and map need them. */
type CampaignItemRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  title: string | null;
  body: string | null;
  submitted_by: string | null;
  status: string | null;
  source_type: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata_json: Record<string, unknown> | null;
  moderation_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.detail", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
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
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement campaign" }, { status: 500 });
    }

    if (!access.campaign) {
      return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    const [
      { data: project, error: projectError },
      { data: categories, error: categoriesError },
      { data: items, error: itemsError },
      { data: reports, error: reportsError },
      placeCandidates,
      { data: geofenceRow, error: geofenceError },
      { data: rtpCycleRows, error: rtpCyclesError },
      { data: rtpChapterRows, error: rtpChaptersError },
      { data: campaignProjectRows, error: campaignProjectsError },
    ] =
      await Promise.all([
        access.campaign.project_id
          ? supabase
              .from("projects")
              .select("id, workspace_id, name, summary, status, plan_type, delivery_phase, updated_at")
              .eq("id", access.campaign.project_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("engagement_categories")
          .select("id, campaign_id, label, slug, description, sort_order, created_at, updated_at")
          .eq("campaign_id", access.campaign.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        // PAGED: these rows drive this campaign's tile counts and its handoff
        // readiness. A read capped at `max_rows` reports no error, so the
        // counts simply read low. An unfinished read becomes an error rather
        // than a short list, so the existing failure disclosure covers it.
        readEveryPage<CampaignItemRow, { message: string; code?: string | null }>(
          (from, toInclusive) =>
            supabase
              .from("engagement_items")
              .select(
                "id, campaign_id, category_id, title, body, submitted_by, status, source_type, latitude, longitude, metadata_json, moderation_notes, created_at, updated_at"
              )
              .eq("campaign_id", access.campaign.id)
              .order("updated_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, toInclusive) as PromiseLike<{
              data: CampaignItemRow[] | null;
              error: { message: string; code?: string | null } | null;
            }>
        ).then((read) =>
          read.complete
            ? { data: read.rows, error: null }
            : {
                data: null,
                error: read.error ?? {
                  message:
                    "the engagement comment read could not be completed, so any count from it would understate participation",
                  code: null,
                },
              }
        ),
        access.campaign.project_id
          ? supabase
              .from("reports")
              .select("id, project_id, title, report_type, status, generated_at, updated_at")
              .eq("project_id", access.campaign.project_id)
              .order("updated_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        // The SAME reader the public portal uses, through the operator's own RLS
        // client. An operator has to be able to see which area frames the portal
        // they are about to publish — and see it as the fact residents get, not
        // as a second calculation that can drift from it.
        loadPortalPlaceCandidates(supabase, {
          id: access.campaign.id,
          workspace_id: access.campaign.workspace_id,
          project_id: access.campaign.project_id,
        }),
        // Whether this campaign refuses pins outside its own area
        // (20260730000002). Read on its own rather than added to
        // `loadCampaignAccess`, which is the shared access select behind every
        // engagement route: a column that does not exist yet would 404 the whole
        // engagement module in the window between a deploy and its migration.
        // The same split the campaign console already makes for
        // `default_content_locale`, for the same reason.
        supabase
          .from("engagement_campaigns")
          .select(SUBMISSION_GEOFENCE_COLUMN)
          .eq("id", access.campaign.id)
          .maybeSingle(),
        // The workspace's RTP cycles and their chapters, so the campaign console
        // can SHOW and EDIT which plan this campaign feeds. Until this read
        // existed, `rtp_cycle_id` was set only by the RTP-side creator and was
        // invisible and uneditable from the campaign itself. Scoped to the
        // campaign's workspace — the PATCH below verifies any chosen id against
        // the same scope, so the options and the enforcement cannot disagree.
        supabase
          .from("rtp_cycles")
          .select("id, title, status")
          .eq("workspace_id", access.campaign.workspace_id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("rtp_cycle_chapters")
          .select("id, title, rtp_cycle_id")
          .eq("workspace_id", access.campaign.workspace_id)
          .order("sort_order", { ascending: true }),
        // The FULL set of projects this campaign covers (20260810000003),
        // lead included — the join table is the one source of truth for
        // coverage, and the console edits it through PATCH `projectIds`.
        // Read separately from `loadCampaignAccess` for the same
        // deploy-before-migrate reason as the geofence flag above.
        supabase
          .from("engagement_campaign_projects")
          .select("project_id")
          .eq("campaign_id", access.campaign.id),
      ]);

    if (projectError) {
      audit.error("campaign_project_lookup_failed", {
        campaignId: access.campaign.id,
        message: projectError.message,
        code: projectError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked project" }, { status: 500 });
    }

    if (categoriesError) {
      audit.error("campaign_categories_lookup_failed", {
        campaignId: access.campaign.id,
        message: categoriesError.message,
        code: categoriesError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement categories" }, { status: 500 });
    }

    if (itemsError) {
      audit.error("campaign_items_lookup_failed", {
        campaignId: access.campaign.id,
        message: itemsError.message,
        code: itemsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load engagement items" }, { status: 500 });
    }

    if (reportsError) {
      audit.error("campaign_reports_lookup_failed", {
        campaignId: access.campaign.id,
        projectId: access.campaign.project_id,
        message: reportsError.message,
        code: reportsError.code ?? null,
      });
      return NextResponse.json({ error: "Failed to load linked reports" }, { status: 500 });
    }

    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]));
    const counts = summarizeEngagementItems(categories ?? [], items ?? []);

    // The SAME resolver the public portal runs, over the same four candidates,
    // so the operator is told exactly what residents get rather than a second
    // calculation that can drift from it. Only APPROVED items count, because
    // only approved items are on the public map.
    /**
     * Whether the location check is on, as THREE states rather than two.
     *
     * `null` is "the read failed", and it must never render as "off": that
     * would tell an operator their consultation is accepting pins from anywhere
     * on the strength of a broken query, which is the confidently-wrong answer
     * this codebase refuses. The console shows a failure for it.
     */
    const geofenceEnabled = geofenceError
      ? null
      : (geofenceRow as Record<string, unknown> | null)?.[SUBMISSION_GEOFENCE_COLUMN] === true;

    if (geofenceError) {
      audit.error("campaign_geofence_flag_lookup_failed", {
        campaignId: access.campaign.id,
        message: geofenceError.message,
        code: geofenceError.code ?? null,
      });
    }

    /**
     * The RTP attachment options, or `null` when they could not be read.
     *
     * Failure-tolerant like the geofence read above, and for the same reason:
     * a broken cycle read must not 500 the whole campaign GET, and it must
     * arrive as "unknown" rather than as an empty list — a console that
     * renders "this workspace has no RTP cycles" out of a failed query is
     * telling an operator to go re-create a plan that already exists.
     */
    let rtpTargets: { cycles: Array<{ id: string; title: string; status: string; chapters: Array<{ id: string; title: string }> }> } | null = null;
    if (rtpCyclesError || rtpChaptersError) {
      audit.error("campaign_rtp_targets_lookup_failed", {
        campaignId: access.campaign.id,
        message: rtpCyclesError?.message ?? rtpChaptersError?.message ?? "unknown",
        code: rtpCyclesError?.code ?? rtpChaptersError?.code ?? null,
      });
    } else {
      const chapterRows = (rtpChapterRows ?? []) as Array<{ id: string; title: string; rtp_cycle_id: string }>;
      rtpTargets = {
        cycles: ((rtpCycleRows ?? []) as Array<{ id: string; title: string; status: string }>).map((cycle) => ({
          id: cycle.id,
          title: cycle.title,
          status: cycle.status,
          chapters: chapterRows
            .filter((chapter) => chapter.rtp_cycle_id === cycle.id)
            .map((chapter) => ({ id: chapter.id, title: chapter.title })),
        })),
      };
    }

    /**
     * The covered-project ids, or `null` when they could not be read.
     *
     * Failure-tolerant like the RTP targets above, including the window where
     * 20260810000003 has not run yet: `null` means "unknown", the console
     * hides the multi-select and does not send `projectIds` on save, so a
     * failed read can never silently unlink a campaign from its projects.
     */
    let linkedProjectIds: string[] | null = null;
    if (campaignProjectsError) {
      audit.error("campaign_project_links_lookup_failed", {
        campaignId: access.campaign.id,
        message: campaignProjectsError.message,
        code: campaignProjectsError.code ?? null,
      });
    } else {
      linkedProjectIds = ((campaignProjectRows ?? []) as Array<{ project_id: string }>).map(
        (row) => row.project_id
      );
    }

    const mapFraming = resolvePortalMapFraming({
      campaignPlace: placeCandidates.campaign,
      projectPlace: placeCandidates.project,
      workspaceHome: placeCandidates.workspaceHome,
      approvedItems: (items ?? [])
        .filter((item) => item.status === "approved")
        .map((item) => ({ latitude: item.latitude, longitude: item.longitude })),
      submissionGeofenceEnabled: geofenceEnabled === true,
    });

    return NextResponse.json(
      {
        campaign: access.campaign,
        project,
        categories,
        recentItems: (items ?? []).slice(0, 8).map((item) => ({
          ...item,
          category: item.category_id ? categoryMap.get(item.category_id) ?? null : null,
        })),
        linkedReports: reports ?? [],
        counts,
        mapFraming,
        rtpTargets,
        linkedProjectIds,
        /**
         * Everything the console needs to offer the location check honestly:
         * whether it is on, whether it CAN be on, and what the area is called.
         *
         * `canEnable` is derived from the campaign's OWN place of record and
         * nothing else. The map may perfectly well be framed by the linked
         * project or the workspace home geography, but the check never runs
         * against either: an operator who has not chosen an area for THIS
         * campaign has not chosen the area residents would be refused against,
         * and inheriting one silently is how a consultation starts turning
         * people away on a boundary nobody picked for it.
         */
        submissionGeofence: {
          enabled: geofenceEnabled,
          canEnable:
            placeCandidates.campaign.state === "set" &&
            placeCanGeofence({ bbox: placeCandidates.campaign.bbox }),
          areaState: placeCandidates.campaign.state,
          areaLabel: placeCandidates.campaign.label,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("campaign_detail_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while loading engagement campaign" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const audit = createApiAuditLogger("engagement.campaigns.patch", request);
  const startedAt = Date.now();

  try {
    const routeParams = await context.params;
    const parsedParams = paramsSchema.safeParse(routeParams);

    if (!parsedParams.success) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }

    const payloadBody = await readJsonOrNullWithLimit(request, BODY_LIMITS.normalJson);

    if (!payloadBody.ok) return payloadBody.response;

    const payload = payloadBody.data;
    const parsed = patchCampaignSchema.safeParse(payload);

    if (!parsed.success) {
      // Log the SHAPE of the failure only. A rejected share token is still a
      // credential someone tried to install, so nothing derived from the
      // submitted values reaches the audit trail.
      audit.warn("validation_failed", {
        issues: parsed.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
      const rejectedTokenSet = parsed.error.issues.some((issue) => issue.path[0] === "shareToken");
      return NextResponse.json(
        { error: rejectedTokenSet ? SHARE_TOKEN_IS_SERVER_MINTED : "Invalid campaign update payload" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await loadCampaignAccess(supabase, parsedParams.data.campaignId, user.id, "engagement.write");

    if (access.error) {
      audit.error("campaign_access_failed", {
        campaignId: parsedParams.data.campaignId,
        userId: user.id,
        message: access.error.message,
        code: access.error.code ?? null,
      });
      return NextResponse.json({ error: "Failed to verify engagement campaign access" }, { status: 500 });
    }

    if (!access.campaign) {
      return NextResponse.json({ error: "Engagement campaign not found" }, { status: 404 });
    }

    if (!access.allowed) {
      return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
    }

    let nextProjectId = access.campaign.project_id;
    if (parsed.data.projectId !== undefined) {
      if (parsed.data.projectId === null) {
        nextProjectId = null;
      } else {
        const projectAccess = await loadProjectAccess(supabase, parsed.data.projectId, user.id, "engagement.write");
        if (projectAccess.error) {
          audit.error("campaign_patch_project_access_failed", {
            campaignId: access.campaign.id,
            projectId: parsed.data.projectId,
            message: projectAccess.error.message,
            code: projectAccess.error.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify linked project" }, { status: 500 });
        }

        if (!projectAccess.project) {
          return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        if (!projectAccess.allowed || projectAccess.project.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
        }

        nextProjectId = projectAccess.project.id;
      }
    }

    let nextRtpCycleId = access.campaign.rtp_cycle_id ?? null;
    if (parsed.data.rtpCycleId !== undefined) {
      if (parsed.data.rtpCycleId === null) {
        nextRtpCycleId = null;
      } else {
        const { data: cycle, error: cycleError } = await supabase
          .from("rtp_cycles")
          .select("id, workspace_id")
          .eq("id", parsed.data.rtpCycleId)
          .maybeSingle();

        if (cycleError) {
          audit.error("campaign_patch_rtp_cycle_access_failed", {
            campaignId: access.campaign.id,
            rtpCycleId: parsed.data.rtpCycleId,
            message: cycleError.message,
            code: cycleError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify RTP cycle target" }, { status: 500 });
        }

        if (!cycle || cycle.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "RTP cycle not found in this workspace" }, { status: 404 });
        }

        nextRtpCycleId = cycle.id;
      }
    }

    let nextRtpCycleChapterId = access.campaign.rtp_cycle_chapter_id ?? null;
    if (parsed.data.rtpCycleChapterId !== undefined) {
      if (parsed.data.rtpCycleChapterId === null) {
        nextRtpCycleChapterId = null;
      } else {
        const { data: chapter, error: chapterError } = await supabase
          .from("rtp_cycle_chapters")
          .select("id, workspace_id, rtp_cycle_id")
          .eq("id", parsed.data.rtpCycleChapterId)
          .maybeSingle();

        if (chapterError) {
          audit.error("campaign_patch_rtp_chapter_access_failed", {
            campaignId: access.campaign.id,
            rtpCycleChapterId: parsed.data.rtpCycleChapterId,
            message: chapterError.message,
            code: chapterError.code ?? null,
          });
          return NextResponse.json({ error: "Failed to verify RTP chapter target" }, { status: 500 });
        }

        if (!chapter || chapter.workspace_id !== access.campaign.workspace_id) {
          return NextResponse.json({ error: "RTP chapter not found in this workspace" }, { status: 404 });
        }

        if (nextRtpCycleId && chapter.rtp_cycle_id !== nextRtpCycleId) {
          return NextResponse.json({ error: "RTP chapter does not belong to the selected RTP cycle" }, { status: 400 });
        }

        nextRtpCycleId = chapter.rtp_cycle_id;
        nextRtpCycleChapterId = chapter.id;
      }
    }

    if (parsed.data.projectId !== undefined && nextProjectId) {
      // The 404 below is a claim about workspace membership, so it may only be
      // reached by a read that succeeded. A discarded error made a broken query
      // say the project is not in this workspace — about a project the operator
      // is looking at, in the workspace they are working in.
      const projectScopeResult = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", nextProjectId)
        .maybeSingle();

      const projectScopeFailure = classifyRouteReadFailure("linked project", projectScopeResult);
      if (projectScopeFailure) {
        audit.error("campaign_patch_project_workspace_check_failed", {
          campaignId: access.campaign.id,
          projectId: nextProjectId,
          message: projectScopeFailure.message,
        });
        return NextResponse.json(projectScopeFailure.body, { status: projectScopeFailure.status });
      }

      const project = projectScopeResult.data as { workspace_id?: string | null } | null;
      if (!project || project.workspace_id !== access.campaign.workspace_id) {
        return NextResponse.json({ error: "Project not found in this workspace" }, { status: 404 });
      }
    }

    /**
     * Every project in the requested coverage set is verified against THIS
     * campaign's workspace before anything is written. One batch read through
     * the caller's own client: a project the caller cannot see comes back
     * absent, and a project they can see in another workspace comes back with
     * the wrong workspace_id — both are refused as the same sentence, and the
     * 404 is only reachable from a read that succeeded (the same rule as the
     * lead-project check above).
     */
    let requestedProjectIds: string[] | null = null;
    if (parsed.data.projectIds !== undefined) {
      requestedProjectIds = [...new Set(parsed.data.projectIds)];
      if (requestedProjectIds.length > 0) {
        const linkScopeResult = await supabase
          .from("projects")
          .select("id, workspace_id")
          .in("id", requestedProjectIds);

        const linkScopeFailure = classifyRouteReadFailure("covered projects", linkScopeResult);
        if (linkScopeFailure) {
          audit.error("campaign_patch_project_links_check_failed", {
            campaignId: access.campaign.id,
            requestedCount: requestedProjectIds.length,
            message: linkScopeFailure.message,
          });
          return NextResponse.json(linkScopeFailure.body, { status: linkScopeFailure.status });
        }

        const inWorkspace = new Set(
          ((linkScopeResult.data ?? []) as Array<{ id: string; workspace_id: string | null }>)
            .filter((row) => row.workspace_id === access.campaign.workspace_id)
            .map((row) => row.id)
        );
        if (requestedProjectIds.some((id) => !inWorkspace.has(id))) {
          return NextResponse.json(
            { error: "Some of those projects are not in this workspace" },
            { status: 404 }
          );
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.summary !== undefined) updates.summary = parsed.data.summary;
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    if (parsed.data.engagementType !== undefined) updates.engagement_type = parsed.data.engagementType;
    if (parsed.data.projectId !== undefined) updates.project_id = nextProjectId;
    if (parsed.data.rtpCycleId !== undefined || parsed.data.rtpCycleChapterId !== undefined) {
      updates.rtp_cycle_id = nextRtpCycleId;
      updates.rtp_cycle_chapter_id = nextRtpCycleChapterId;
    }
    // Only null survives the schema, so this is the disable transition and
    // nothing else; no uniqueness check is needed to clear a column.
    if (parsed.data.shareToken !== undefined) updates.share_token = null;
    if (parsed.data.publicSlug !== undefined) {
      if (parsed.data.publicSlug === null) {
        updates.public_slug = null;
      } else {
        // Trim + lowercase FIRST — the same normalization the public
        // resolution path applies before matching — so "Jefferson-Street "
        // saves as the address the flyer reader will actually reach.
        const normalizedSlug = normalizePublicSlugInput(parsed.data.publicSlug);
        if (normalizedSlug === "") {
          // An emptied field is a deliberate clear, same as the accessibility
          // fields below — not a format error about a value nobody typed.
          updates.public_slug = null;
        } else if (!isPublicSlugCandidate(normalizedSlug)) {
          // Refused in words, and refused again by the table's format CHECK
          // (20260810000002) if a future writer forgets this branch.
          return NextResponse.json(
            { error: PUBLIC_SLUG_FORMAT_REFUSAL, message: PUBLIC_SLUG_FORMAT_REFUSAL },
            { status: 400 }
          );
        } else {
          updates.public_slug = normalizedSlug;
        }
      }
    }
    if (parsed.data.publicDescription !== undefined) updates.public_description = parsed.data.publicDescription;
    if (parsed.data.allowPublicSubmissions !== undefined) updates.allow_public_submissions = parsed.data.allowPublicSubmissions;
    if (parsed.data.demographicsEnabled !== undefined) updates.demographics_enabled = parsed.data.demographicsEnabled;

    // Empty string means "cleared", which the column stores as NULL. The table's
    // CHECK refuses a blank string, so normalising here is what keeps a
    // deliberate deletion from arriving as a constraint violation.
    const blankToNull = (value: string | null) => (value === null || value.trim() === "" ? null : value);
    if (parsed.data.accessibilityContactLabel !== undefined)
      updates.accessibility_contact_label = blankToNull(parsed.data.accessibilityContactLabel);
    if (parsed.data.accessibilityContactEmail !== undefined)
      updates.accessibility_contact_email = blankToNull(parsed.data.accessibilityContactEmail);
    if (parsed.data.accessibilityContactPhone !== undefined)
      updates.accessibility_contact_phone = blankToNull(parsed.data.accessibilityContactPhone);
    if (parsed.data.accessibilityAlternateFormats !== undefined)
      updates.accessibility_alternate_formats = blankToNull(parsed.data.accessibilityAlternateFormats);

    if (parsed.data.place !== undefined) {
      // The campaign's place columns are deliberately the same names as
      // `projects.place_*` — 20260729000003 says so, and the shared
      // `PlaceOfRecord` shape is why — so the project row builders apply
      // verbatim rather than being copied under a second name.
      if (parsed.data.place === null) {
        Object.assign(updates, clearedProjectPlace());
      } else if (parsed.data.place.mode === "place") {
        const boundary = await resolvePlaceBoundary(parsed.data.place.kind, parsed.data.place.geoid);
        if (!boundary) {
          // Fail closed. Recording the id without a verified boundary would give
          // the campaign an area that frames nothing — which is the state this
          // whole column set exists to end, so silently half-writing it would be
          // worse than refusing.
          audit.warn("campaign_place_unresolved", {
            campaignId: access.campaign.id,
            kind: parsed.data.place.kind,
            geoid: parsed.data.place.geoid,
          });
          return NextResponse.json(
            {
              error: "Could not resolve that place",
              message:
                "The boundary service did not return a boundary for that place. Search for it again and pick it from the list.",
            },
            { status: 404 }
          );
        }
        Object.assign(
          updates,
          projectPlaceFromPlaceBoundary(boundary, { label: parsed.data.place.label ?? null })
        );
      } else {
        const drawn = projectPlaceFromDrawnArea(parsed.data.place.geometry, {
          label: parsed.data.place.label ?? null,
        });
        if (!drawn) {
          return NextResponse.json({ error: "That drawn area has no usable coordinates." }, { status: 400 });
        }
        Object.assign(updates, drawn);
      }
    }

    /**
     * The location check and the area it tests against, resolved TOGETHER.
     *
     * They cannot be validated apart, because the broken state — a check with
     * nothing to test — is reachable from either side: by turning the check on
     * for a campaign with no area, and by clearing the area under a check that
     * is already on. Both are refused here in words, and both are refused again
     * by `engagement_campaigns_geofence_needs_area` in the database, so a future
     * writer that forgets this block still cannot store the broken state.
     *
     * Only runs when this request touches one of the two. A PATCH that renames
     * the campaign reads nothing extra.
     */
    if (parsed.data.submissionGeofenceEnabled !== undefined || parsed.data.place !== undefined) {
      const placeChanging = parsed.data.place !== undefined;
      const flagChanging = parsed.data.submissionGeofenceEnabled !== undefined;

      let hasAreaAfter = placeChanging
        ? updates.place_min_lon != null &&
          updates.place_min_lat != null &&
          updates.place_max_lon != null &&
          updates.place_max_lat != null
        : false;
      let enabledAfter = parsed.data.submissionGeofenceEnabled ?? false;

      if (!placeChanging || !flagChanging) {
        const { data: currentRow, error: currentError } = await supabase
          .from("engagement_campaigns")
          .select(`${SUBMISSION_GEOFENCE_COLUMN}, place_min_lon, place_min_lat, place_max_lon, place_max_lat`)
          .eq("id", access.campaign.id)
          .maybeSingle();

        if (currentError || !currentRow) {
          // Fail closed. Writing either half without knowing the other could
          // store a check with nothing behind it, or trip the table's CHECK and
          // surface to the operator as an unexplained failure.
          audit.error("campaign_geofence_precondition_read_failed", {
            campaignId: access.campaign.id,
            message: currentError?.message ?? "no row",
            code: currentError?.code ?? null,
          });
          return NextResponse.json(
            { error: "Failed to verify this campaign's area before changing the location check" },
            { status: 500 }
          );
        }

        const current = currentRow as Record<string, unknown>;
        if (!placeChanging) {
          hasAreaAfter =
            current.place_min_lon != null &&
            current.place_min_lat != null &&
            current.place_max_lon != null &&
            current.place_max_lat != null;
        }
        if (!flagChanging) {
          enabledAfter = current[SUBMISSION_GEOFENCE_COLUMN] === true;
        }
      }

      const refusal = geofenceUpdateRefusal({
        enabled: enabledAfter,
        hasArea: hasAreaAfter,
        areaCleared: parsed.data.place === null,
      });

      if (refusal) {
        return NextResponse.json({ error: refusal, message: refusal }, { status: 400 });
      }

      if (flagChanging) {
        updates[SUBMISSION_GEOFENCE_COLUMN] = parsed.data.submissionGeofenceEnabled;
      }
    }

    // A request may carry ONLY `projectIds`, which touches the join table and
    // no campaign column; an empty `.update({})` would be refused by PostgREST,
    // so the campaign write runs only when there is one.
    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from("engagement_campaigns")
        .update(updates)
        .eq("id", access.campaign.id)
        .select("id")
        .maybeSingle();

      // The slug is GLOBALLY unique (it is a path segment with no workspace
      // context), so two campaigns wanting the same name is an ordinary
      // planner-facing outcome, not a server failure. The database's own
      // refusal is mapped to a sentence; a raw "duplicate key value violates
      // unique constraint" must never be the answer a planner reads.
      if (updateError?.code === "23505" && updateError.message?.includes("public_slug")) {
        audit.warn("campaign_public_slug_taken", {
          campaignId: access.campaign.id,
          userId: user.id,
        });
        return NextResponse.json(
          { error: PUBLIC_SLUG_TAKEN_REFUSAL, message: PUBLIC_SLUG_TAKEN_REFUSAL },
          { status: 409 }
        );
      }

      if (isWriteFailure(updateError)) {
        audit.error("campaign_update_failed", {
          campaignId: access.campaign.id,
          message: updateError?.message ?? "unknown",
          code: updateError?.code ?? null,
        });
        return NextResponse.json({ error: "Failed to update engagement campaign" }, { status: 500 });
      }

      if (writeMatchedNoRows({ data: updated, error: updateError })) {
        // `loadCampaignAccess` read this exact campaign through the caller's own
        // client and passed the role gate, so a write matching nothing is the
        // database refusing what the application allowed — not a missing campaign.
        // Before this branch existed the route answered `{ success: true }` over
        // zero changed rows, which is the silent degrade this codebase refuses.
        audit.error("campaign_update_matched_no_rows", {
          campaignId: access.campaign.id,
          workspaceId: access.campaign.workspace_id,
          userId: user.id,
          role: access.membership?.role ?? null,
        });
        return noRowsMatchedResponse({ subject: "engagement campaign", targetWasVerified: true });
      }
    }

    /**
     * The coverage set (20260810000003), synced AFTER the campaign write so
     * the lead the trigger just recorded is part of the "current" read. The
     * desired set always unions the lead in, so this sync can never delete
     * the lead's row — removing the lead from coverage is only possible by
     * changing the lead itself.
     *
     * Runs only when the request carried `projectIds`. A rename PATCH, and
     * the console while the link list is unreadable, leave coverage exactly
     * as it was.
     */
    let projectLinksChanged: { added: number; removed: number } | null = null;
    if (requestedProjectIds !== null) {
      const currentLinks = await supabase
        .from("engagement_campaign_projects")
        .select("project_id")
        .eq("campaign_id", access.campaign.id);

      const currentLinksFailure = classifyRouteReadFailure("campaign project links", currentLinks);
      if (currentLinksFailure) {
        audit.error("campaign_project_links_read_failed", {
          campaignId: access.campaign.id,
          message: currentLinksFailure.message,
        });
        return NextResponse.json(
          {
            error: "The campaign saved, but its project list could not be read to update it",
            hint: "Reload and try the project list again; the campaign's other fields were saved.",
          },
          { status: currentLinksFailure.status }
        );
      }

      const current = ((currentLinks.data ?? []) as Array<{ project_id: string }>).map(
        (row) => row.project_id
      );
      const desired = desiredCampaignProjectIds({
        leadProjectId: nextProjectId,
        requestedProjectIds,
      });
      const { toAdd, toRemove } = diffCampaignProjectLinks(current, desired);

      if (toRemove.length > 0) {
        const { data: removedRows, error: removeError } = await supabase
          .from("engagement_campaign_projects")
          .delete()
          .eq("campaign_id", access.campaign.id)
          .in("project_id", toRemove)
          .select("project_id");
        if (removeError) {
          audit.error("campaign_project_links_remove_failed", {
            campaignId: access.campaign.id,
            removeCount: toRemove.length,
            message: removeError.message,
            code: removeError.code ?? null,
          });
          return NextResponse.json(
            { error: "The campaign saved, but its project list could not be updated" },
            { status: 500 }
          );
        }
        if ((removedRows?.length ?? 0) < toRemove.length) {
          // The rows were just read through this same client, so a shortfall
          // is the database refusing the delete (RLS), not a stale diff —
          // reporting success over it would leave the console showing a list
          // the planner believes they just changed.
          audit.error("campaign_project_links_remove_matched_fewer_rows", {
            campaignId: access.campaign.id,
            expected: toRemove.length,
            removed: removedRows?.length ?? 0,
          });
          return NextResponse.json(
            { error: "The campaign saved, but part of its project list could not be removed" },
            { status: 500 }
          );
        }
      }

      if (toAdd.length > 0) {
        const { error: addError } = await supabase.from("engagement_campaign_projects").insert(
          toAdd.map((projectId) => ({
            workspace_id: access.campaign.workspace_id,
            campaign_id: access.campaign.id,
            project_id: projectId,
            created_by: user.id,
          }))
        );
        if (addError) {
          audit.error("campaign_project_links_add_failed", {
            campaignId: access.campaign.id,
            addCount: toAdd.length,
            message: addError.message,
            code: addError.code ?? null,
          });
          return NextResponse.json(
            { error: "The campaign saved, but its project list could not be updated" },
            { status: 500 }
          );
        }
      }

      projectLinksChanged = { added: toAdd.length, removed: toRemove.length };
    }

    audit.info("campaign_updated", {
      userId: user.id,
      campaignId: access.campaign.id,
      // A derived fact, never a token value: enough to reconstruct that the
      // public link was taken offline, and useless to anyone reading the log.
      shareTokenDisabled: parsed.data.shareToken === null,
      // Changed/cleared, not the value: the slug is public by design, but the
      // ledger convention here is derived facts, and the row itself records
      // the value with better provenance than a log line.
      publicSlugChanged: parsed.data.publicSlug !== undefined,
      // Counts, not ids: enough to reconstruct that coverage changed and by
      // how much; the join table itself records which rows, with provenance.
      projectLinksAdded: projectLinksChanged?.added ?? 0,
      projectLinksRemoved: projectLinksChanged?.removed ?? 0,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, campaignId: access.campaign.id }, { status: 200 });
  } catch (error) {
    audit.error("campaign_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement campaign" }, { status: 500 });
  }
}
