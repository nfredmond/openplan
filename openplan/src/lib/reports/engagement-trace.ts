import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCloseLoopEntries, type CloseLoopEntriesResult } from "@/lib/engagement/close-loop";
import type { DecisionLinkSnapshot, VerifiedDecisionLink } from "@/lib/engagement/decision-links";
import { loadVerifiedDecisionLinks } from "@/lib/engagement/decision-links-server";
import { decisionSynthesisDetails } from "@/lib/engagement/decision-synthesis-display";
import { countContributionsByReviewState, type EngagementReviewState } from "@/lib/engagement/review-counts";

/**
 * The comment-to-decision trace a project packet carries for its linked
 * campaign: each published staff response, the contributions it answers, the
 * staff review theme it was linked to and the project decision it supports.
 *
 * It reuses the readers behind the internal engagement review files
 * (`read_engagement_response_snapshot` and `read_engagement_decision_links`,
 * each one complete campaign snapshot checked against its own count), and it
 * counts the way those files count, so the two documents reconcile.
 *
 * A packet is a staff document that is often circulated onward, so it carries
 * less than the internal review files: no words from a withheld (rejected,
 * pending or flagged) comment, no submitted names, no review notes, no actor
 * identifiers, no decision rationale and no demographics.
 */

export type ReportTraceItem = { id: string; title?: string | null; status: string | null };

export type ReportTraceSource =
  | { kind: "approved"; id: string; title: string | null }
  | { kind: "withheld"; id: string; status: string | null }
  | { kind: "missing"; id: string };

type ReportTraceTheme =
  | { kind: "linked"; label: string; revision: number; reviewId: string; groupId: string }
  | { kind: "withdrawn"; label: string; reviewId: string; groupId: string };

export type ReportTraceDecision = {
  /** The latest saved action on this response-decision link: its record identity. */
  linkId: string;
  decisionId: string;
  title: string;
  status: string;
  projectName: string;
  /** False when the decision is no longer on a project linked to the campaign; title and status are then the retained copy. */
  onLinkedProject: boolean;
  withdrawn: boolean;
  operations: Array<VerifiedDecisionLink["operation"]>;
  lastActionAt: string;
  /** Whether the response and sources changed since the last saved action. */
  sourceState: "unchanged" | "changed" | "unavailable";
  themes: { state: "captured"; rows: ReportTraceTheme[] } | { state: "not_captured" } | { state: "unreadable" };
};

export type ReportTraceResponse = {
  id: string;
  themeTitle: string;
  youSaid: string;
  weDid: string;
  publishedAt: string | null;
  sources: ReportTraceSource[];
  /** Null when the decision-link read failed: unknown, not none. */
  decisions: ReportTraceDecision[] | null;
};

export type ReportEngagementTrace =
  | { state: "not_loaded" }
  | {
      state: "loaded";
      counts: {
        contributions: number;
        byState: Record<EngagementReviewState, number>;
        /** Null when the response read failed. */
        publishedResponses: number | null;
        /** Every saved link, refresh and withdrawal on the campaign. Null when the read failed. */
        decisionLinkActions: number | null;
      };
      /** Null when the response read failed. */
      responses: ReportTraceResponse[] | null;
      responseReadError: string | null;
      decisionReadError: string | null;
    };

export type ReportTraceDecisionLinks =
  | { snapshot: DecisionLinkSnapshot; error: null }
  | { snapshot: null; error: { message: string } };

function themesFor(link: VerifiedDecisionLink): ReportTraceDecision["themes"] {
  try {
    const histories = decisionSynthesisDetails(link.context);
    if (histories === null) return { state: "not_captured" };
    const rows: ReportTraceTheme[] = [];
    for (const history of histories) {
      const last = history.events.at(-1);
      if (!last) continue;
      rows.push(
        last.intent.operation === "withdraw"
          ? { kind: "withdrawn", label: last.group.label, reviewId: history.reviewId, groupId: history.groupId }
          : {
              kind: "linked",
              label: last.group.label,
              revision: last.retained.revision.number,
              reviewId: history.reviewId,
              groupId: history.groupId,
            }
      );
    }
    return { state: "captured", rows };
  } catch {
    return { state: "unreadable" };
  }
}

function decisionsFor(responseId: string, snapshot: DecisionLinkSnapshot): ReportTraceDecision[] {
  const entries = snapshot.entries.filter((row) => row.response_id === responseId);
  const byId = new Map(entries.map((row) => [row.id, row]));
  const hasChild = new Set(entries.map((row) => row.predecessor_id).filter((id): id is string => id !== null));
  const leaves = entries.filter((row) => !hasChild.has(row.id));

  return leaves.map((leaf) => {
    const operations: ReportTraceDecision["operations"] = [];
    for (let row: VerifiedDecisionLink | undefined = leaf; row; row = row.predecessor_id ? byId.get(row.predecessor_id) : undefined) {
      operations.unshift(row.operation);
    }
    const current = snapshot.decisions.find((row) => row.record.id === leaf.decision_id);
    const state = snapshot.current.find((row) => row.linkId === leaf.id);
    return {
      linkId: leaf.id,
      decisionId: leaf.decision_id,
      title: current?.record.title ?? leaf.context.decision.title,
      status: current?.record.status ?? leaf.context.decision.status,
      projectName: current?.projectName ?? leaf.context.project.name,
      onLinkedProject: Boolean(current),
      withdrawn: leaf.operation === "withdraw",
      operations,
      lastActionAt: leaf.created_at,
      sourceState: state?.sourceState ?? "unavailable",
      themes: themesFor(leaf),
    };
  });
}

/** Assemble the trace from already-read records. Pure, so the packet and its tests share one path. */
export function buildReportEngagementTrace(input: {
  items: ReadonlyArray<ReportTraceItem>;
  responses: CloseLoopEntriesResult;
  decisionLinks: ReportTraceDecisionLinks;
}): ReportEngagementTrace {
  const itemById = new Map(input.items.map((item) => [item.id, item]));
  const decisionSnapshot = input.decisionLinks.snapshot;
  const published = input.responses.error
    ? null
    : input.responses.rows.filter((row) => row.status === "published");

  const responses = published?.map((row): ReportTraceResponse => ({
    id: row.id,
    themeTitle: row.theme_title,
    youSaid: row.you_said,
    weDid: row.we_did,
    publishedAt: row.published_at,
    sources: row.source_item_ids.map((id): ReportTraceSource => {
      const item = itemById.get(id);
      if (!item) return { kind: "missing", id };
      return item.status === "approved"
        ? { kind: "approved", id, title: item.title ?? null }
        : { kind: "withheld", id, status: item.status };
    }),
    decisions: decisionSnapshot ? decisionsFor(row.id, decisionSnapshot) : null,
  })) ?? null;

  return {
    state: "loaded",
    counts: {
      contributions: input.items.length,
      byState: countContributionsByReviewState(input.items),
      publishedResponses: published ? published.length : null,
      decisionLinkActions: decisionSnapshot ? decisionSnapshot.entryCount : null,
    },
    responses,
    responseReadError: input.responses.error?.message ?? null,
    decisionReadError: input.decisionLinks.error?.message ?? null,
  };
}

/**
 * Read a campaign's staff responses and decision-link history for a packet.
 * Use the generating staff member's client: the decision-link reader requires
 * workspace membership and answers a service-role caller with an error.
 * Neither read can fail generation; a failure travels into the packet as unknown.
 */
export async function loadReportEngagementTrace(
  client: Pick<SupabaseClient, "rpc">,
  scope: { campaignId: string; workspaceId: string },
  items: ReadonlyArray<ReportTraceItem>
): Promise<ReportEngagementTrace> {
  const [responses, links] = await Promise.all([
    loadCloseLoopEntries(client, scope.campaignId),
    loadVerifiedDecisionLinks(client, scope),
  ]);
  return buildReportEngagementTrace({
    items,
    responses,
    decisionLinks: links.error === null
      ? { snapshot: links.snapshot, error: null }
      : { snapshot: null, error: { message: links.error.message } },
  });
}
