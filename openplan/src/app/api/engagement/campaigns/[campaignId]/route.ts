import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { loadCampaignAccess, loadProjectAccess } from "@/lib/engagement/api";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES } from "@/lib/engagement/catalog";
import { summarizeEngagementItems } from "@/lib/engagement/summary";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
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
    rtpCycleId: z.union([z.string().uuid(), z.null()]).optional(),
    rtpCycleChapterId: z.union([z.string().uuid(), z.null()]).optional(),
    // Disable-only — see SHARE_TOKEN_IS_SERVER_MINTED above.
    shareToken: z.null().optional(),
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
        supabase
          .from("engagement_items")
          .select(
            "id, campaign_id, category_id, title, body, submitted_by, status, source_type, latitude, longitude, metadata_json, moderation_notes, created_at, updated_at"
          )
          .eq("campaign_id", access.campaign.id)
          .order("updated_at", { ascending: false }),
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
      const { data: project } = await supabase
        .from("projects")
        .select("id, workspace_id")
        .eq("id", nextProjectId)
        .maybeSingle();
      if (!project || project.workspace_id !== access.campaign.workspace_id) {
        return NextResponse.json({ error: "Project not found in this workspace" }, { status: 404 });
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

    const { data: updated, error: updateError } = await supabase
      .from("engagement_campaigns")
      .update(updates)
      .eq("id", access.campaign.id)
      .select("id")
      .maybeSingle();

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

    audit.info("campaign_updated", {
      userId: user.id,
      campaignId: access.campaign.id,
      // A derived fact, never a token value: enough to reconstruct that the
      // public link was taken offline, and useless to anyone reading the log.
      shareTokenDisabled: parsed.data.shareToken === null,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ success: true, campaignId: access.campaign.id }, { status: 200 });
  } catch (error) {
    audit.error("campaign_patch_unhandled_error", { durationMs: Date.now() - startedAt, error });
    return NextResponse.json({ error: "Unexpected error while updating engagement campaign" }, { status: 500 });
  }
}
