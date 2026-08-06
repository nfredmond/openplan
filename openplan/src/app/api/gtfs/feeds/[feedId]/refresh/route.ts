import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BODY_LIMITS, readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { classifyRouteReadFailure } from "@/lib/http/read-outcome";
import { createApiAuditLogger } from "@/lib/observability/audit";
import { isReadOnlyWorkspaceRole } from "@/lib/auth/role-matrix";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { checkWorkspaceMembership } from "@/lib/workspaces/membership";
import {
  readAssistantExecutionSource,
  verifyAssistantActionApproval,
  type AssistantApprovalVerification,
} from "@/lib/assistant/action-approval-server";
import { refuseOutOfScopeAgentRequest } from "@/lib/assistant/agent-request-scope";
import { USER_AUTHORED } from "@/lib/assistant/agent-principal";
import { getActionMetadata } from "@/lib/runtime/action-metadata";
import { recordAssistantActionExecution } from "@/lib/observability/action-audit";
import { resolveGtfsCatalogRedirect } from "@/lib/gtfs/catalog";
import { runGtfsIngest } from "@/lib/gtfs/ingest";
import { GTFS_FEED_REFRESH_SOURCE_COLUMNS } from "@/lib/gtfs/route-projections";

/**
 * FETCH THIS FEED AGAIN, FROM WHERE THE DATABASE SAYS IT CAME FROM.
 *
 * ===================================== THE ADDRESS COMES OFF THE STORED ROW
 *
 * The request carries a workspace id and, at most, one boolean. It carries NO
 * URL and no catalog id. That is the rule this route exists to hold: a refresh
 * re-fetches the source the feed was REGISTERED with, so the provenance columns
 * on every version keep meaning what they say. Accepting an address here would
 * let a caller repoint an established feed at anything they liked while every
 * derived row, every citation and every "last refreshed" timestamp continued to
 * carry the original agency's name. `GTFS_FEED_REFRESH_SOURCE_COLUMNS` is the
 * mechanism rather than the intention: the route holds only the columns it read
 * out of the database, so there is no address from the caller for it to prefer.
 *
 * A CATALOG FEED IS RE-RESOLVED THROUGH THE CATALOG'S OWN REDIRECTS, not
 * re-fetched from the address stored last time. Agencies republish under new
 * ids and the old row is marked `deprecated` with `redirect.id` naming the
 * successor — 244 US rows were in that state when this lane was written. A
 * refresh that used the stored URL would keep downloading a frozen mirror of a
 * schedule that no longer runs, indefinitely, and nothing on screen would say
 * so.
 *
 * ================================ A WITHHELD REFETCH IS A 200, NOT AN ERROR
 *
 * `promoteGtfsFeedVersion` declines to adopt a refetch that is materially
 * smaller than the feed in use — 20% fewer routes or stops — because a drop
 * that size is as likely to be a truncated download as a real service cut, and
 * adopting it would move every number that reads transit service with nothing
 * on screen changing. When that happens the refetch SUCCEEDED: it was
 * downloaded, parsed, stored and marked `ready`, and a human was simply not
 * asked to accept it yet. Answering 4xx would tell a planner their agency's
 * feed is broken. The response is 200 with the assessment — both counts, so
 * nobody has to trust a verdict — and `adoptDespiteCollapse` is how a person
 * who has read it says yes.
 *
 * THAT FLAG MUST NEVER BECOME REACHABLE BY AN ASSISTANT ACTION. An agent
 * optimising for "the refresh completed" would set it every time, which is
 * exactly the incentive the collapse rule exists to defeat.
 *
 * ======================= THE `refresh_gtfs_feed` ACTION, REGISTERED 2026-08-06
 *
 * It is registered, and this route is now the boundary that makes that safe.
 * The action's payload is `{ workspaceId, gtfsFeedId }` — two ids and nothing
 * else — which is why it is registrable at all when "ingest from this URL" is
 * refused: every value that decides what happens is read HERE, off the stored
 * row, and the model authors none of it.
 *
 * `adoptDespiteCollapse` is the reason this endpoint is WIDER than the action,
 * and the reason `refuseOutOfScopeAgentRequest` is called below. The approval
 * hash covers the action this route REBUILDS from its own parsed data, not the
 * request body — so a body carrying `{ workspaceId, adoptDespiteCollapse: true }`
 * hashes identically to the `{ workspaceId, gtfsFeedId }` a planner approved,
 * passes verification, and adopts a collapse nobody consented to. Leaving the
 * field off the union variant does not stop that: the type lives in the browser
 * bundle, and anything holding a session cookie can post whatever body it likes
 * with the agent header attached. The key check is the boundary; the missing
 * field is only the first of two locks.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const paramsSchema = z.object({ feedId: z.string().uuid() }).strict();

const refreshBodySchema = z
  .object({
    workspaceId: z.string().uuid(),
    /** See the header. A person who was shown the collapse assessment said yes. */
    adoptDespiteCollapse: z.boolean().optional(),
  })
  .strict();

/**
 * Exactly the body keys the `refresh_gtfs_feed` action maps onto this endpoint.
 *
 * ONE KEY. `adoptDespiteCollapse` is absent, which is the whole point — see the
 * header. `gtfsFeedId` is not here either, because it never travels in the body:
 * it is a path segment, and the route reads it from its own parsed params.
 */
const AGENT_REFRESH_BODY_KEYS = ["workspaceId"] as const;

type StoredFeedSource = {
  id: string;
  workspace_id: string | null;
  agency_name: string;
  source_kind: string | null;
  feed_url: string | null;
  catalog_provider: string | null;
  catalog_source_id: string | null;
};

function membershipResponse(kind: "schema_pending" | "not_member" | "error"): NextResponse {
  if (kind === "schema_pending") {
    return NextResponse.json(
      {
        error: "Transit feed schema is not available yet",
        hint: "Apply the latest Supabase migrations, then try again.",
      },
      { status: 503 }
    );
  }
  if (kind === "error") {
    return NextResponse.json({ error: "Failed to verify workspace membership" }, { status: 500 });
  }
  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ feedId: string }> }
) {
  const audit = createApiAuditLogger("gtfs.feeds.refresh", request);
  const startedAt = Date.now();

  try {
    const routeParams = paramsSchema.safeParse(await context.params);
    if (!routeParams.success) {
      return NextResponse.json({ error: "Invalid feed id" }, { status: 400 });
    }

    const bodyRead = await readJsonOrNullWithLimit(request, BODY_LIMITS.smallJson);
    if (!bodyRead.ok) return bodyRead.response;
    const payload = refreshBodySchema.safeParse(bodyRead.data);
    if (!payload.success) {
      return NextResponse.json(
        {
          error: "Invalid refresh payload",
          hint: "Send { workspaceId } and, only when a person has accepted a smaller refetch, adoptDespiteCollapse.",
        },
        { status: 400 }
      );
    }
    const { feedId } = routeParams.data;
    const { workspaceId } = payload.data;

    /**
     * A NARROW ACTION MAY NOT RIDE THIS WIDE ROUTE.
     *
     * Run before any database work, because it is a refusal about the REQUEST
     * rather than about the workspace's state, and a refusal that costs four
     * round trips first is a refusal that invites being skipped. The raw body is
     * what is checked, not the parsed one: zod strips unknown keys, so a check
     * over parsed data would pass for a field the schema does not know while
     * missing the dangerous case — a field the schema DOES know, which here is
     * exactly `adoptDespiteCollapse`.
     */
    const executionSource = readAssistantExecutionSource(request);
    const scopeRefusal = refuseOutOfScopeAgentRequest({
      executionSource,
      body: bodyRead.data,
      allowedKeys: AGENT_REFRESH_BODY_KEYS,
      actionKind: "refresh_gtfs_feed",
    });
    if (scopeRefusal) {
      audit.warn("agent_request_out_of_scope", {
        workspaceId,
        feedId,
        rejectedKeys: scopeRefusal.rejectedKeys,
      });
      return NextResponse.json(
        { error: scopeRefusal.error, details: scopeRefusal.details },
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

    const membership = await checkWorkspaceMembership(supabase, user.id, workspaceId);
    if (!membership.ok) {
      if (membership.kind === "error") {
        audit.error("membership_lookup_failed", { message: membership.message });
      }
      return membershipResponse(membership.kind);
    }
    if (isReadOnlyWorkspaceRole(membership.role)) {
      return NextResponse.json(
        { error: "Viewers have read-only access to this workspace" },
        { status: 403 }
      );
    }

    const service = createServiceRoleClient();

    const feedResult = await service
      .from("gtfs_feeds")
      .select(GTFS_FEED_REFRESH_SOURCE_COLUMNS)
      .eq("id", feedId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const feedFailure = classifyRouteReadFailure("the transit feed", feedResult, {
      pendingError: "Transit feed schema is not available yet",
      pendingHint: "Apply the latest Supabase migrations, then try again.",
    });
    if (feedFailure) {
      audit.error("gtfs_feed_read_failed", { message: feedFailure.message });
      return NextResponse.json(feedFailure.body, { status: feedFailure.status });
    }

    if (!feedResult.data) {
      // A PUBLIC preloaded feed is readable by every signed-in user and
      // refreshable by none of them: a refresh writes a new version and can
      // move `current_version_id`, which would change what every other tenant
      // on this deployment analyses with. Naming it discloses nothing that
      // policy does not already make world-readable.
      const publicResult = await service
        .from("gtfs_feeds")
        .select("id")
        .eq("id", feedId)
        .is("workspace_id", null)
        .maybeSingle();

      const publicFailure = classifyRouteReadFailure("the transit feed", publicResult);
      if (publicFailure) {
        audit.error("gtfs_public_feed_read_failed", { message: publicFailure.message });
        return NextResponse.json(publicFailure.body, { status: publicFailure.status });
      }
      if (publicResult.data) {
        return NextResponse.json(
          {
            error: "This is a shared preloaded feed and cannot be refreshed by a workspace",
            detail:
              "Every workspace on this deployment analyses with this feed, so it is refreshed by " +
              "whoever operates the deployment. Your workspace can ingest its own copy of the " +
              "same agency's feed instead.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Transit feed not found" }, { status: 404 });
    }

    const feed = feedResult.data as unknown as StoredFeedSource;

    if (feed.source_kind === "upload") {
      return NextResponse.json(
        {
          error: "An uploaded feed cannot be refreshed",
          detail:
            "This feed was ingested from a file, so there is no address to fetch it from again. " +
            "Upload the agency's newer archive to this feed instead — the upload door takes a " +
            "feedId and adds a version to the feed named here rather than registering a second " +
            "one for the same agency.",
        },
        { status: 422 }
      );
    }

    /* ------------------------------------------------------------------ */
    /* Where to fetch from, decided entirely from the stored row           */
    /* ------------------------------------------------------------------ */

    let downloadUrl: string | null = null;
    let catalogProvider: string | null = null;
    let catalogSourceId: string | null = null;
    let catalogRowStatus: string | null = null;
    let supersededIds: string[] = [];

    if (feed.catalog_source_id) {
      const resolved = await resolveGtfsCatalogRedirect(feed.catalog_source_id);

      if (resolved.status === "catalog_unavailable") {
        audit.warn("gtfs_catalog_unavailable", {
          code: resolved.code,
          detail: resolved.detail,
          ...(resolved.diagnostic ? { diagnostic: resolved.diagnostic } : {}),
        });
        return NextResponse.json(
          { error: "The transit feed catalog could not be read", detail: resolved.detail },
          { status: 503 }
        );
      }
      if (resolved.status === "refused") {
        return NextResponse.json(
          {
            error: "This feed's catalog entry can no longer be fetched",
            reason: resolved.reason,
            detail: resolved.detail,
            supersededIds: resolved.supersededIds,
          },
          { status: 422 }
        );
      }

      downloadUrl = resolved.entry.downloadUrl;
      catalogProvider = resolved.entry.provider;
      catalogSourceId = resolved.entry.catalogId;
      catalogRowStatus = resolved.entry.status;
      supersededIds = resolved.supersededIds;
    } else {
      downloadUrl = feed.feed_url;
    }

    if (!downloadUrl) {
      return NextResponse.json(
        {
          error: "This feed has no address to refresh from",
          detail:
            "No download address was recorded for this feed, so there is nothing to fetch again. " +
            "Register the agency's feed URL, or upload their archive.",
        },
        { status: 422 }
      );
    }

    /**
     * APPROVAL EVIDENCE, VERIFIED AGAINST THE ACTION THIS ROUTE REBUILDS FROM
     * ITS OWN PARSED PARAMS — never echoed back from the request.
     *
     * WHY IT IS VERIFIED *HERE* AND NOT EARLIER. The approval is single-use and
     * is consumed by the check. Consuming it above would spend a planner's
     * consent on a request this route was always going to refuse — an uploaded
     * feed, a shared public feed, a catalog entry with no successor — and the
     * planner would then have to approve a second time for a fetch that never
     * happened. Everything that can refuse without fetching has refused by the
     * time control reaches this line, so what is left is the outbound fetch
     * itself. If THAT fails the approval is legitimately spent: a retry is
     * another fetch of a third party's server, and consenting to it again is the
     * honest cost.
     */
    const agentSourced = executionSource === "planner_agent_quick_link";
    let approval: AssistantApprovalVerification = {
      approvalId: null,
      inputHash: null,
      executionSource: "manual",
      authorship: USER_AUTHORED,
    };

    if (agentSourced) {
      try {
        approval = await verifyAssistantActionApproval({
          request,
          serviceSupabase: service,
          userId: user.id,
          workspaceId,
          action: { kind: "refresh_gtfs_feed", workspaceId, gtfsFeedId: feedId },
        });
      } catch (approvalError) {
        audit.warn("agent_approval_rejected", { workspaceId, feedId });
        return NextResponse.json(
          {
            error:
              approvalError instanceof Error ? approvalError.message : "Planner Agent approval failed",
          },
          { status: 403 }
        );
      }
    }

    const ingestStartedAt = new Date().toISOString();

    /**
     * The ledger row, written for the AGENT path only and written DIRECTLY
     * rather than through `withAssistantActionAudit`.
     *
     * The wrapper decides success by whether the body threw, and `runGtfsIngest`
     * does not throw — it RETURNS `{ ok: false }` with a code and a detail for
     * every ordinary failure (a refused address, a truncated archive, a feed
     * with no usable service). Wrapping it would stamp `outcome: 'succeeded'` on
     * every one of those, and a ledger that misreports outcomes is worse than
     * one that is missing rows, because it is believed.
     *
     * `adopted` is in the summary for the same reason. "The refetch succeeded
     * and was NOT adopted" is the single most important thing a reader of this
     * ledger needs to know about a refresh, and it is invisible from the outcome
     * column: a withheld collapse is a successful fetch that deliberately
     * changed nothing.
     *
     * The manual path writes no row on purpose. `action_kind` is a claim that
     * this was a Planner Agent action; stamping it on a refresh a person clicked
     * in the Data Hub would be false. A manual refresh is already recorded by
     * this route's own `gtfs_feed_refreshed` audit line.
     */
    const recordAgentLedgerRow = async (input: {
      outcome: "succeeded" | "failed";
      errorMessage?: string | null;
      inputSummary: Record<string, unknown>;
    }) => {
      if (!agentSourced) return;
      const metadata = getActionMetadata("refresh_gtfs_feed");
      const { error: ledgerError } = await recordAssistantActionExecution(service, {
        workspaceId,
        userId: user.id,
        actionKind: "refresh_gtfs_feed",
        auditEvent: metadata.auditEvent,
        approval: metadata.approval,
        regrounding: metadata.regrounding,
        outcome: input.outcome,
        errorMessage: input.errorMessage ?? null,
        inputSummary: input.inputSummary,
        approvalId: approval.approvalId,
        inputHash: approval.inputHash,
        executionSource: approval.executionSource,
        authorship: approval.authorship,
        startedAt: ingestStartedAt,
        completedAt: new Date().toISOString(),
      });
      if (ledgerError) {
        audit.warn("assistant_action_ledger_write_failed", {
          workspaceId,
          feedId,
          message: ledgerError.message,
        });
      }
    };

    let result: Awaited<ReturnType<typeof runGtfsIngest>>;
    try {
      result = await runGtfsIngest({
        service,
        workspaceId,
        feedId: feed.id,
        requestedBy: user.id,
        provisionalName: feed.agency_name,
        adoptDespiteCollapse: payload.data.adoptDespiteCollapse,
        source: catalogSourceId
          ? { kind: "catalog", downloadUrl, catalogProvider, catalogSourceId, catalogRowStatus }
          : { kind: "url", downloadUrl },
        onDiagnostic: (diagnostic) => audit.warn("gtfs_fetch_refusal_diagnostic", { diagnostic }),
      });
    } catch (ingestError) {
      // A throw out of the ingest is the one path that would otherwise leave an
      // approved agent action with no ledger row at all. The outer catch answers
      // 500; this makes sure the ledger says what was attempted first.
      await recordAgentLedgerRow({
        outcome: "failed",
        errorMessage: ingestError instanceof Error ? ingestError.message : String(ingestError),
        inputSummary: { feedId, sourceKind: feed.source_kind ?? null },
      });
      throw ingestError;
    }

    if (!result.ok) {
      audit.warn("gtfs_feed_refresh_failed", {
        workspaceId,
        feedId,
        versionId: result.versionId,
        code: result.code,
        durationMs: Date.now() - startedAt,
      });
      await recordAgentLedgerRow({
        outcome: "failed",
        errorMessage: `${result.code}: ${result.detail}`,
        inputSummary: {
          feedId,
          sourceKind: feed.source_kind ?? null,
          versionId: result.versionId ?? null,
        },
      });
      return NextResponse.json(
        {
          error: "This transit feed could not be refreshed",
          code: result.code,
          detail: result.detail,
          feedId: result.feedId,
          versionId: result.versionId,
        },
        { status: result.status }
      );
    }

    await recordAgentLedgerRow({
      outcome: "succeeded",
      inputSummary: {
        feedId,
        sourceKind: feed.source_kind ?? null,
        versionId: result.versionId,
        // See `recordAgentLedgerRow`: a withheld collapse is a SUCCESSFUL fetch
        // that deliberately changed nothing, and the outcome column cannot say
        // that on its own.
        adopted: result.adoption.adopted,
        adoptionReason: result.adoption.adopted ? null : result.adoption.reason,
      },
    });

    audit.info("gtfs_feed_refreshed", {
      workspaceId,
      feedId,
      versionId: result.versionId,
      adopted: result.adoption.adopted,
      adoptionReason: result.adoption.adopted ? null : result.adoption.reason,
      routeRows: result.routeServiceLevelRows,
      stopRows: result.stopServiceLevelRows,
      durationMs: Date.now() - startedAt,
    });

    // 200 IN ALL THREE ADOPTION OUTCOMES. The refetch is the thing that
    // succeeded; whether it replaced the feed in use is a separate fact the
    // body states rather than a status code encodes. See the header.
    return NextResponse.json(
      {
        feedId: result.feedId,
        versionId: result.versionId,
        adoption: result.adoption,
        displayName: result.displayName,
        routeServiceLevelRows: result.routeServiceLevelRows,
        stopServiceLevelRows: result.stopServiceLevelRows,
        droppedForMissingCoordinates: result.droppedForMissingCoordinates,
        warnings: result.warnings,
        caveats: result.caveats,
        checksumSha256: result.checksumSha256,
        byteSize: result.byteSize,
        // WHETHER THE REFRESHED VERSION CAN REACH A MODEL RUN. A refresh is a
        // catalog/URL refetch, which is exactly the door whose storage write may
        // miss without failing the ingest — so this route can answer `false` and
        // was the one door not saying so. `POST /api/gtfs/feeds` has returned it
        // since the byte handoff shipped; the panel renders both.
        bytesStored: result.bytesStored,
        bytesNotStoredReason: result.bytesNotStoredReason,
        supersededCatalogIds: supersededIds,
      },
      { status: 200 }
    );
  } catch (error) {
    audit.error("gtfs_feed_refresh_unhandled_error", { error });
    return NextResponse.json(
      { error: "Unexpected error while refreshing the transit feed" },
      { status: 500 }
    );
  }
}
