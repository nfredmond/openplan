import { z } from "zod";
import type { GtfsMemberStatus } from "./managed-worker-service";
import type { GtfsAdoptionReview } from "./managed-human-command";
import type { GtfsRequestCancellation } from "./managed-request-cancellation";
const id = z.string().uuid().transform(value => value.toLowerCase());
const date = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative().max(2147483647);
const statusSchema = z.object({ schemaVersion: z.literal(1), requestId: id, versionId: id, feedId: id, workspaceId: id,
 state: z.enum(["awaiting_archive", "queued", "running", "ready", "failed", "cancelled"]), stage: z.enum(["pending", "fetching", "parsing", "ready", "failed"]),
 attempts: count, leaseUntil: date.nullable(), archiveConfirmed: z.boolean(), submittedAt: date, isCurrent: z.boolean(),
 failureCode: z.string().nullable(), failureDetail: z.string().nullable(), submitterAccessUnavailable: z.boolean() }).strict();
const terminalSchema = z.object({ command: id, version: id, state: z.literal("cancelled"),
 closure: z.object({ recorded: z.literal(true), feedStatusChanged: z.boolean() }).strict(), cleanupPending: z.boolean(), closedAt: date }).strict();
const cancellationSchema = z.object({ command: id, requestId: id, workspaceId: id, state: z.literal("cancelled"), versionId: id.nullable(), cancelledAt: date,
 versionCancellation: terminalSchema.nullable() }).strict();
const basisSchema = z.object({ feedId: id, versionId: id, routeCount: count.positive(), stopCount: count.positive(), previousVersionId: id.nullable(), previousRouteCount: count.nullable(), previousStopCount: count.nullable() }).strict();
const reviewSchema = z.object({ managed: z.literal(true), review: z.object({ basis: basisSchema, materialShrinkage: z.boolean(), isCurrent: z.boolean() }).strict(), detail: z.string().optional() }).strict();
function requireMatch(value: boolean, message: string): asserts value { if (!value) throw new Error(message); }

/** Browser progress accepts only this request and workspace. Missing,
 * unavailable and cancelled remain different outcomes. It never infers service
 * coverage, parser counts or adoption from a successful HTTP response alone.
 */
export function readGtfsClientProgress(raw: unknown, scope: { workspaceId: string; requestId: string }): { status: GtfsMemberStatus | null; cancellation: GtfsRequestCancellation | null } {
 const expected = z.object({ workspaceId: id, requestId: id }).strict().parse(scope);
 const body = z.object({ managed: z.literal(true), requestId: id, status: statusSchema.nullable(), cancellation: cancellationSchema.nullable(), detail: z.string().optional() }).strict().parse(raw);
 requireMatch(body.requestId === expected.requestId, "Transit progress request differs");
 const { status, cancellation } = body;
 if (status) {
  requireMatch(status.requestId === expected.requestId && status.workspaceId === expected.workspaceId, "Transit progress scope differs");
  const stageMatches = status.state === "ready" ? status.stage === "ready" && status.archiveConfirmed
   : status.state === "failed" || status.state === "cancelled" ? status.stage === "failed" && status.failureCode !== null
    : ["pending", "fetching", "parsing"].includes(status.stage);
  requireMatch(stageMatches && (!status.isCurrent || status.state === "ready"), "Transit progress stage or current version differs");
  requireMatch(status.state === "running" ? status.attempts > 0 && status.leaseUntil !== null : status.leaseUntil === null, "Transit progress ownership differs");
 }
 if (cancellation) {
  requireMatch(cancellation.requestId === expected.requestId && cancellation.workspaceId === expected.workspaceId, "Transit cancellation scope differs");
  requireMatch(cancellation.versionCancellation === null || (cancellation.versionCancellation.version === cancellation.versionId && cancellation.versionCancellation.command === cancellation.command), "Transit cancellation closure differs");
  requireMatch(status === null || (status.state === "cancelled" && status.versionId === cancellation.versionId), "Transit cancellation and processing differ");
 }
 return { status, cancellation };
}
/** Review counts belong to the completed version and feed selected from
 * current workspace records. A material reduction needs explicit acceptance.
 */
export function readGtfsClientReview(raw: unknown, scope: { feedId: string; versionId: string }): GtfsAdoptionReview {
 const expected = z.object({ feedId: id, versionId: id }).strict().parse(scope), { review } = reviewSchema.parse(raw), basis = review.basis;
 requireMatch(basis.feedId === expected.feedId && basis.versionId === expected.versionId, "Transit review scope differs");
 requireMatch(basis.previousVersionId === null ? basis.previousRouteCount === null && basis.previousStopCount === null : basis.previousRouteCount !== null && basis.previousStopCount !== null, "Transit review predecessor differs");
 const material = basis.previousVersionId !== null && ((basis.previousRouteCount! > 0 && basis.routeCount < basis.previousRouteCount! * 0.8) || (basis.previousStopCount! > 0 && basis.stopCount < basis.previousStopCount! * 0.8));
 requireMatch(material === review.materialShrinkage && (!review.isCurrent || basis.previousVersionId === basis.versionId), "Transit review shrinkage or current version differs");
 return review;
}
