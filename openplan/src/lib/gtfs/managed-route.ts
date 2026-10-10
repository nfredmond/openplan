import { join } from "node:path";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { gtfsQueueOptions } from "./managed-worker-queue";
import { admitGtfsSubmission, type GtfsAdmissionOptions } from "./managed-admission";
import { GTFS_ALWAYS_APPLICABLE_CAVEATS } from "./caveats";
import { readAssistantExecutionSource } from "../assistant/action-approval-server";

export const GTFS_REQUEST_ID_HEADER = "x-openplan-gtfs-request-id";

/** Enrollment stays opt-in while migration and worker installation are explicit.
 * This operational switch provides no software entitlement or claim of capacity.
 */
export function managedGtfsEnabled(env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (env.OPENPLAN_GTFS_MANAGED_INGESTION === undefined || env.OPENPLAN_GTFS_MANAGED_INGESTION === "0") return false;
  if (env.OPENPLAN_GTFS_MANAGED_INGESTION !== "1") throw new Error("GTFS managed ingestion configuration is invalid");
  return true;
}

/** Admission files use a sibling directory so independent request locks cannot
 * change the version queue's inventory or installation lock. Both persist under
 * the same configured private worker root and database-target namespace.
 */
export function managedGtfsRequestDirectory(requestId: string, env: Partial<NodeJS.ProcessEnv> = process.env) {
  const options = gtfsQueueOptions(["--once"], env);
  if (options.help) throw new Error("GTFS admission configuration is unavailable");
  const request = z.string().uuid().transform(value => value.toLowerCase()).parse(requestId);
  return { ...options, directory: join(`${options.directory}-submissions`, request) };
}

export class GtfsSourceResolutionError extends Error {
  constructor(readonly status: number, readonly body: { error: string; detail?: string; reason?: string }) { super(body.error); }
}

/** Call only after route-local writer authorization and bounded input reading.
 * A client retains its request UUID before sending bytes. An unavailable reply
 * returns that identity and never asserts that admission, custody or completion
 * failed. Recovery must reuse the exact intent and original actor.
 */
export async function managedGtfsRouteSubmission(request: NextRequest, options: Pick<GtfsAdmissionOptions,
  "workspaceId" | "actorId" | "intent" | "resolve" | "service" | "upload">, env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (readAssistantExecutionSource(request) !== "manual") return NextResponse.json({ error: "Planner Agent managed transit submission is not available",
    detail: "The asynchronous action custody and audit are not established. A planner can submit this import directly." }, { status: 403 });
  const identity = z.string().uuid().transform(value => value.toLowerCase()).safeParse(request.headers.get(GTFS_REQUEST_ID_HEADER));
  if (!identity.success) return NextResponse.json({ error: "Retain a request UUID before submitting this import", header: GTFS_REQUEST_ID_HEADER }, { status: 400 });
  const requestId = identity.data;
  try {
    const configuration = managedGtfsRequestDirectory(requestId, env);
    const result = await admitGtfsSubmission({ ...configuration, ...options, requestId,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "", signal: request.signal, env });
    return NextResponse.json({ managed: true, requestId, feedId: result.registration.feedId, versionId: result.registration.versionId,
      createdFeed: result.registration.createdFeed, status: result.status,
      detail: result.status.state === "ready" ? "Processing completed. Review this version before adopting it."
        : "Import retained for the transit worker. Processing and adoption are separate steps.",
      caveats: [...GTFS_ALWAYS_APPLICABLE_CAVEATS],
    }, { status: ["queued", "running", "awaiting_archive"].includes(result.status.state) ? 202 : 200 });
  } catch (error) {
    if (error instanceof GtfsSourceResolutionError) return NextResponse.json({ ...error.body, requestId }, { status: error.status });
    return NextResponse.json({ error: "Import submission is unconfirmed", requestId,
      detail: "Check this request's status or recover it using the same intent. Retain the original ZIP when local custody is unavailable.",
    }, { status: 503 });
  }
}
