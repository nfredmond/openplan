import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * WHICH FILES MAY USE THE SERVICE-ROLE CLIENT (KI-2026-11-02-052).
 *
 * `createServiceRoleClient()` in `src/lib/supabase/server.ts` signs every
 * request with `SUPABASE_SERVICE_ROLE_KEY`, so row-level security does not
 * apply to it. A page or route that reads through it has no RLS net: the
 * `.eq("workspace_id", …)` filters and the membership check before them ARE
 * the access control. Until this guard, nothing limited which files could
 * reach for it, and a new route could read another workspace's rows with no
 * test noticing.
 *
 * So every shipped file under `src/` that uses the service role is listed
 * below with the reason it may. A new user fails until someone reads it and
 * gives it a category; an entry that no longer uses the client fails until it
 * is deleted (the list only shrinks on its own). A client component, and
 * anything under `src/components`, may not use it at all.
 *
 * WHAT COUNTS AS A USE, read from the TypeScript syntax tree, so comments and
 * string literals never count:
 *   - a static, aliased, namespace or type-only import of the factory from the
 *     server module (by `@/` path or a relative path);
 *   - a dynamic `import()` or `require()` of the server module in a file that
 *     names the factory;
 *   - a read of `SUPABASE_SERVICE_ROLE_KEY` (property, element, destructuring,
 *     or a call argument such as `requireEnv("…")`);
 *   - a value import of a Supabase client constructor (`createClient`,
 *     `createServerClient`, `createBrowserClient`) outside `src/lib/supabase`,
 *     because a raw client is how the key travels past the factory.
 * A file whose only references sit inside `typeof …` uses the TYPE; it receives
 * a client from its caller and creates none. Those are listed as TYPE_ONLY, and
 * the guard checks that they stay that way.
 *
 * HOW THE CATEGORIES WERE ASSIGNED (November 2, 2026, on 6c499c5). Each file was
 * read for where its authorization comes from. Most entries were read in full;
 * the six engagement synthesis routes (continuation, execution, proposals,
 * response-links, reviews, thematic-choices), `reports/[reportId]/generate`
 * and `workspaces/invitations/decline` were classified from their
 * authorization block and call shape, and the TYPE_ONLY entries are
 * mechanical. Module loaders (`loadProjectAccess`, `loadModelAccess`,
 * `authorizeWorkProgram`, …) were taken as membership checks; the write-role
 * guard (`workspace-write-role-gate-guard.test.ts`) proves those consult the
 * role matrix.
 *
 * ENTRIES THAT NEED A SENTENCE
 *   - `(published)/plan/[shareToken]/document/page.tsx` is a share-token page,
 *     but its `project_rtp_cycle_links` read filters by `rtp_cycle_id` only.
 *     The sibling `/plan/[shareToken]` page adds `workspace_id =
 *     cycle.workspace_id` to the same read (found 2026-08-16). Open finding,
 *     not fixed here.
 *   - `lib/models/run-reconcile.ts` probes `model_run_stages` across every
 *     workspace on purpose (is the single worker alive at all?) and keeps only
 *     a boolean; no other workspace's row reaches the caller.
 *   - `lib/gtfs/managed-route.ts` passes the key to
 *     `lib/gtfs/managed-worker-intake.ts`, which builds the raw client for the
 *     admission upload under `<workspaceId>/<feedId>/`.
 *   - `components/models/analysis-sequence-facts.ts` is a server-only loader
 *     that sits in `src/components`; it is the one entry in
 *     COMPONENT_FOLDER_DEBT below.
 *
 * BLIND CATEGORIES, stated:
 *   - Transitive use. A helper that wraps the factory, or receives a service
 *     client as an untyped parameter, makes its callers service-role users
 *     too; those callers are not listed. CALLER_AUTHORIZES and TYPE_ONLY mark
 *     the helpers, not who calls them.
 *   - The category is a reading on a date. The guard proves a listed file
 *     still uses the client, and that TYPE_ONLY files create none; it does not
 *     prove a listed file's reads stay scoped.
 *   - Code outside `src/` (`scripts/`, `workers/`) is not scanned, nor are
 *     test files.
 *   - The key read through a computed name (`process.env[name]`) is not seen.
 */

const SRC = path.join(process.cwd(), "src");
const SERVER_MODULE = path.join(SRC, "lib", "supabase", "server");
const DEFINER = "src/lib/supabase/server.ts";
const SUPABASE_HELPERS_DIR = "src/lib/supabase/";
const FACTORY = "createServiceRoleClient";
const KEY = "SUPABASE_SERVICE_ROLE_KEY";
const SUPABASE_PACKAGES = new Set(["@supabase/supabase-js", "@supabase/ssr"]);
const CLIENT_CONSTRUCTORS = new Set(["createClient", "createServerClient", "createBrowserClient"]);
const THIS_GUARD = "src/test/service-role-client-guard.test.ts";

const CATEGORIES = {
  AFTER_MEMBERSHIP_CHECK:
    "Signed-in caller. The file, or a loader it calls, checks membership or role first, and the service-role calls are scoped to that workspace or to a row proven to be in it.",
  AUDIT_WRITE:
    "After the route's own role check, the service role only verifies an agent approval or writes audit, usage, rate-limit or telemetry rows users may not write.",
  PUBLIC_SHARE_TOKEN:
    "Public page or route with no session. A share token or published state picks one record, and every read is keyed to it.",
  WORKER_CALLBACK:
    "Machine caller: a bearer- or secret-checked worker callback, a cron route, or a job processor that runs in a worker.",
  AUTH_BOOTSTRAP:
    "The caller has no membership yet or acts on their own identity: workspace bootstrap and invitations.",
  CROSS_WORKSPACE_ADMIN: "Operator surface behind its own token that reads across workspaces by design.",
  INSTALLATION_STATUS:
    "Reads installation-wide operating status (cron heartbeat, worker heartbeats) that belongs to no workspace.",
  CALLER_AUTHORIZES:
    "A library helper that creates the client and acts on ids its caller passes; the callers checked hold the membership check.",
  TYPE_ONLY: "Uses only the client's type and receives a client from its caller; creates none.",
  UNREVIEWED: "Not yet justified from the code. A debt, not an exemption; the count may not grow.",
} as const;

type Category = keyof typeof CATEGORIES;

/**
 * SHRINK-ONLY. Deleting an entry because the file stopped using the service
 * role is the intended change. Adding one means you read the file and can say
 * which category carries its authorization; "RLS would block it" is the reason
 * to use the session client instead, not a reason to be here.
 */
const SERVICE_ROLE_USERS: Record<string, Category> = {
  // AFTER_MEMBERSHIP_CHECK (115)
  "src/app/(app)/aerial/missions/[missionId]/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/(app)/engagement/[campaignId]/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/(app)/my-work/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/(app)/projects/[projectId]/management/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/(app)/projects/[projectId]/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/(app)/workspace/page.tsx": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/imagery/[imageryId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/imagery/[imageryId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/imagery/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/imagery/upload/complete/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/imagery/upload/start/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/missions/[missionId]/process/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/aerial/processing-jobs/[jobId]/artifacts/[custodyId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/analysis/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/assistant/actions/approvals/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/assistant/actions/holds/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/assistant/actions/submittals/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/assistant/providers/connections/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/assistant/providers/turns/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/attachments/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/survey/export/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/survey/review/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/approvals/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/continuation/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/execution/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/progress/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/proposals/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/response-links/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/reviews/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/thematic-choices/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/engagement/campaigns/[campaignId]/translations/generation/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/funding-awards/[awardId]/handoff/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/funding-opportunities/[opportunityId]/application/export/[exportId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/funding-opportunities/[opportunityId]/application/export/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/funding-opportunities/[opportunityId]/application/safety-seed/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/geographies/census-tracts/ingest/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/[feedId]/refresh/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/[feedId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/upload/complete/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/upload/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/feeds/upload/start/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/gtfs/submissions/[requestId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/invoicing/client-invoices/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/invoicing/staff/[staffId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/invoicing/staff/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/[documentId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/[documentId]/ocr/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/[documentId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/paste/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/upload/complete/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/knowledge-base/documents/upload/start/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/[planId]/context/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/[planId]/decisions/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/[planId]/freeze/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/[planId]/implementation-reports/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/[planId]/reconcile-rules/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/creation-requests/[commandId]/stop/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/land-use-plans/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/map-layers/aerial-orthos/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/map-packages/[packageId]/files/[fileName]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/map-packages/[packageId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/map-packages/[packageId]/upload/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/map-packages/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/models/[modelId]/runs/[modelRunId]/artifacts/[artifactId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/models/[modelId]/runs/[modelRunId]/recovery/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/models/[modelId]/runs/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/models/project-comparison/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/closeout/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/export/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/packets/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/reimbursement/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/reporting/reports/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/reporting/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/sources/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/programs/[programId]/work-program/workflow/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/decision-packages/[submissionId]/decision/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/decision-packages/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/evidence-bundles/[bundleId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/evidence-bundles/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/records/[recordId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/records/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/[projectId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/projects/import/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/reports/[reportId]/artifacts/[artifactId]/aerial/[custodyId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/reports/[reportId]/artifacts/[artifactId]/download/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/reports/[reportId]/generate/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/rtp-cycles/[rtpCycleId]/extraction-candidates/[candidateId]/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/rtp-cycles/[rtpCycleId]/extraction-candidates/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/rtp-cycles/[rtpCycleId]/extraction-runs/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/safety/crashes/ingest/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/safety/crashes/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/stage-gates/decisions/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/title-vi/service-equity/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/home-geography/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/integration-keys/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/integration-keys/validate/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/invitations/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/members/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/provider-api-connections/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/roster/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/app/api/workspaces/stage-gate-template/route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/engagement/review-export-download.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/gtfs/managed-human-route.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/invoicing/contracts/jobs-server.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/invoicing/contracts/server.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/land-use-plans/implementation-report-snapshot.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/programs/work-program/reporting-server.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/programs/work-program/workflow-server.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/reports/guided-comparison-server.ts": "AFTER_MEMBERSHIP_CHECK",
  "src/lib/reports/safety-comparison-server.ts": "AFTER_MEMBERSHIP_CHECK",

  // AUDIT_WRITE (9)
  "src/app/api/engagement/campaigns/[campaignId]/survey/questions/route.ts": "AUDIT_WRITE",
  "src/app/api/funding-opportunities/[opportunityId]/route.ts": "AUDIT_WRITE",
  "src/app/api/funding-opportunities/route.ts": "AUDIT_WRITE",
  "src/app/api/invoicing/invoices/[invoiceId]/route.ts": "AUDIT_WRITE",
  "src/app/api/projects/[projectId]/funding-profile/route.ts": "AUDIT_WRITE",
  "src/app/api/report/route.ts": "AUDIT_WRITE",
  "src/app/api/reports/route.ts": "AUDIT_WRITE",
  "src/app/api/rtp-cycles/[rtpCycleId]/horizon-bands/from-cycle-horizon/route.ts": "AUDIT_WRITE",
  "src/lib/runtime/ai-rate-limit.ts": "AUDIT_WRITE",

  // PUBLIC_SHARE_TOKEN (18)
  "src/app/(published)/measure/[shareToken]/page.tsx": "PUBLIC_SHARE_TOKEN",
  "src/app/(published)/plan/[shareToken]/document/page.tsx": "PUBLIC_SHARE_TOKEN",
  "src/app/(published)/plan/[shareToken]/page.tsx": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/items/[itemId]/photo/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/items/[itemId]/translate/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/items/[itemId]/vote/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/photo-upload/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/submit/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/subscribe/confirm/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/subscribe/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/subscribe/unsubscribe/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/survey/draft/resume/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/survey/draft/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/app/api/engage/[shareToken]/survey/submit/route.ts": "PUBLIC_SHARE_TOKEN",
  "src/lib/engagement/public-portal-data.ts": "PUBLIC_SHARE_TOKEN",
  "src/lib/land-use-plans/public-map.ts": "PUBLIC_SHARE_TOKEN",
  "src/lib/land-use-plans/public.ts": "PUBLIC_SHARE_TOKEN",

  // WORKER_CALLBACK (17)
  "src/app/api/aerial/processing-callback/custody/route.ts": "WORKER_CALLBACK",
  "src/app/api/aerial/processing-callback/route.ts": "WORKER_CALLBACK",
  "src/app/api/assistant/providers/native/route.ts": "WORKER_CALLBACK",
  "src/app/api/county-runs/[countyRunId]/manifest/route.ts": "WORKER_CALLBACK",
  "src/app/api/cron/reap-gtfs-ingests/route.ts": "WORKER_CALLBACK",
  "src/app/api/cron/reap-model-runs/route.ts": "WORKER_CALLBACK",
  "src/app/api/cron/sweep-deadlines/route.ts": "WORKER_CALLBACK",
  "src/app/api/cron/sweep-engagement-photos/route.ts": "WORKER_CALLBACK",
  "src/app/api/cron/sweep-staged-uploads/route.ts": "WORKER_CALLBACK",
  "src/app/api/geographies/equity-designation/ingest/route.ts": "WORKER_CALLBACK",
  "src/app/api/knowledge-base/ocr-callback/route.ts": "WORKER_CALLBACK",
  "src/app/api/map-packages/connector/route.ts": "WORKER_CALLBACK",
  "src/lib/engagement/review-export-worker.ts": "WORKER_CALLBACK",
  "src/lib/knowledge-base/extraction-jobs.ts": "WORKER_CALLBACK",
  "src/lib/ops/node-queue-observation.ts": "WORKER_CALLBACK",
  "src/lib/programs/work-program/export-job.ts": "WORKER_CALLBACK",
  "src/lib/programs/work-program/source-page-images.ts": "WORKER_CALLBACK",

  // AUTH_BOOTSTRAP (4)
  "src/app/(auth)/invitations/[token]/page.tsx": "AUTH_BOOTSTRAP",
  "src/app/api/workspaces/bootstrap/route.ts": "AUTH_BOOTSTRAP",
  "src/app/api/workspaces/invitations/accept/route.ts": "AUTH_BOOTSTRAP",
  "src/app/api/workspaces/invitations/decline/route.ts": "AUTH_BOOTSTRAP",

  // CROSS_WORKSPACE_ADMIN (1)
  "src/app/api/health/deep/route.ts": "CROSS_WORKSPACE_ADMIN",

  // INSTALLATION_STATUS (2)
  "src/app/(app)/my-work/layout.tsx": "INSTALLATION_STATUS",
  "src/lib/models/worker-health-server.ts": "INSTALLATION_STATUS",

  // CALLER_AUTHORIZES (14)
  "src/components/models/analysis-sequence-facts.ts": "CALLER_AUTHORIZES",
  "src/lib/assistant/provider-chat-worker.ts": "CALLER_AUTHORIZES",
  "src/lib/grants/award-handoff-server.ts": "CALLER_AUTHORIZES",
  "src/lib/gtfs/managed-route.ts": "CALLER_AUTHORIZES",
  "src/lib/gtfs/managed-worker-intake.ts": "CALLER_AUTHORIZES",
  "src/lib/integrations/workspace-keys.ts": "CALLER_AUTHORIZES",
  "src/lib/models/artifact-source.ts": "CALLER_AUTHORIZES",
  "src/lib/models/attempt-output-read.ts": "CALLER_AUTHORIZES",
  "src/lib/models/population-replacement-server.ts": "CALLER_AUTHORIZES",
  "src/lib/models/recovery-status-server.ts": "CALLER_AUTHORIZES",
  "src/lib/models/relaunch-custody.ts": "CALLER_AUTHORIZES",
  "src/lib/models/run-reconcile.ts": "CALLER_AUTHORIZES",
  "src/lib/models/zone-attribute-payload.ts": "CALLER_AUTHORIZES",
  "src/lib/rtp/extraction/acceptance.ts": "CALLER_AUTHORIZES",

  // TYPE_ONLY (15)
  "src/lib/aerial/imagery-intake.ts": "TYPE_ONLY",
  "src/lib/assistant/provider-server.ts": "TYPE_ONLY",
  "src/lib/data-sources/census-tract-ingest-limit.ts": "TYPE_ONLY",
  "src/lib/engagement/geofence-enforcement.ts": "TYPE_ONLY",
  "src/lib/engagement/public-translation-generation.ts": "TYPE_ONLY",
  "src/lib/engagement/translation-generation-queue.ts": "TYPE_ONLY",
  "src/lib/engagement/translation-generation-worker.ts": "TYPE_ONLY",
  "src/lib/knowledge-base/document-intake.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/create-store.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/freeze-store.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/implementation-report-store.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/plan-context-store.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/publication.ts": "TYPE_ONLY",
  "src/lib/land-use-plans/rule-reconciliation-store.ts": "TYPE_ONLY",
  "src/lib/workspaces/owned-workspace-limit.ts": "TYPE_ONLY",
};

/** UNREVIEWED entries recorded on November 2, 2026. Lower it when one is reviewed; never raise it. */
const UNREVIEWED_CEILING = 0;

/**
 * Files under src/components that use the service role. SHRINK-ONLY, and each
 * must stay a server-only module (no "use client"). Moving the loader to
 * src/lib and deleting the entry is the intended fix.
 */
const COMPONENT_FOLDER_DEBT: Record<string, string> = {
  "src/components/models/analysis-sequence-facts.ts":
    "server-only analysis loader imported by the models, scenarios and county-runs pages; dynamic import for one custody RPC keyed to the page's workspace",
};

type UseKind = "value" | "type" | "key" | "raw" | "reexport";
type Use = { kind: UseKind; line: number; detail: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(entry) ? [full] : [];
  });
}

/** Repo-relative with forward slashes, e.g. `src/app/api/x/route.ts`. */
function rel(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function resolvesToServerModule(fromFile: string, specifier: string): boolean {
  let target: string;
  if (specifier.startsWith("@/")) target = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) target = path.resolve(path.dirname(path.join(process.cwd(), fromFile)), specifier);
  else return false;
  return target.replace(/\.(ts|tsx|js|mjs)$/, "").replace(/[\\/]index$/, "") === SERVER_MODULE;
}

function insideTypeQuery(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isTypeQueryNode(current)) return true;
    if (ts.isStatement(current)) return false;
  }
  return false;
}

function isUseClient(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

/**
 * Every service-role use in one file, from its syntax tree. `fileName` is
 * repo-relative; it decides how relative import paths resolve and whether the
 * file is one of the Supabase helpers.
 */
function serviceRoleUses(fileName: string, source: string): { uses: Use[]; useClient: boolean } {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true,
    /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const uses: Use[] = [];
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const isHelper = fileName.startsWith(SUPABASE_HELPERS_DIR);

  const factoryLocals = new Map<string, { node: ts.Node; typeOnly: boolean; detail: string }>();
  const namespaceLocals = new Map<string, { node: ts.Node; typeOnly: boolean }>();
  let dynamicServerImport: ts.Node | null = null;

  // Pass 1: imports, re-exports, dynamic imports, key reads, raw constructors.
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (resolvesToServerModule(fileName, specifier) && clause) {
        if (bindings && ts.isNamespaceImport(bindings)) {
          namespaceLocals.set(bindings.name.text, { node, typeOnly: clause.isTypeOnly });
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if ((element.propertyName ?? element.name).text !== FACTORY) continue;
            factoryLocals.set(element.name.text, {
              node,
              typeOnly: clause.isTypeOnly || element.isTypeOnly,
              detail: element.propertyName ? `import as ${element.name.text}` : "import",
            });
          }
        }
      }
      if (SUPABASE_PACKAGES.has(specifier) && !isHelper && clause && !clause.isTypeOnly
        && bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly || !CLIENT_CONSTRUCTORS.has((element.propertyName ?? element.name).text)) continue;
          uses.push({ kind: "raw", line: line(node), detail: `raw ${(element.propertyName ?? element.name).text} from ${specifier}` });
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      && resolvesToServerModule(fileName, node.moduleSpecifier.text)) {
      const clause = node.exportClause;
      if (!clause || ts.isNamespaceExport(clause)
        || clause.elements.some((element) => (element.propertyName ?? element.name).text === FACTORY)) {
        uses.push({ kind: "reexport", line: line(node), detail: "re-exports the server module or the factory" });
      }
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const specifier = node.arguments[0].text;
      if (resolvesToServerModule(fileName, specifier)) dynamicServerImport ??= node;
      if (SUPABASE_PACKAGES.has(specifier) && !isHelper) {
        uses.push({ kind: "raw", line: line(node), detail: `dynamic import of ${specifier}` });
      }
    }
    const readsKey =
      (ts.isPropertyAccessExpression(node) && node.name.text === KEY)
      || (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        && node.argumentExpression.text === KEY)
      || (ts.isBindingElement(node) && ts.isIdentifier(node.propertyName ?? node.name)
        && (node.propertyName ?? node.name).getText(sf) === KEY)
      || (ts.isCallExpression(node) && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && arg.text === KEY));
    if (readsKey) uses.push({ kind: "key", line: line(node), detail: `reads ${KEY}` });
    ts.forEachChild(node, collect);
  };
  collect(sf);

  // Pass 2: how each imported binding is referenced.
  const references = new Map<string, { value: boolean; type: boolean }>();
  let namesFactoryOutsideType = false;
  const refer = (node: ts.Node) => {
    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isNamespaceImport(node.parent)) {
      const isPropertyName = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        || (ts.isQualifiedName(node.parent) && node.parent.right === node);
      if (factoryLocals.has(node.text) && !isPropertyName) {
        const seen = references.get(node.text) ?? { value: false, type: false };
        if (insideTypeQuery(node)) seen.type = true;
        else seen.value = true;
        references.set(node.text, seen);
      }
      if (namespaceLocals.has(node.text) && !isPropertyName) {
        const parent = node.parent;
        const member = ts.isPropertyAccessExpression(parent) ? parent.name.text
          : ts.isQualifiedName(parent) ? parent.right.text : null;
        if (member === null || member === FACTORY) {
          const seen = references.get(`*${node.text}`) ?? { value: false, type: false };
          if (insideTypeQuery(node)) seen.type = true;
          else seen.value = true;
          references.set(`*${node.text}`, seen);
        }
      }
      if (node.text === FACTORY && !insideTypeQuery(node)) namesFactoryOutsideType = true;
    }
    if (ts.isExportSpecifier(node) && !node.parent.parent.moduleSpecifier
      && factoryLocals.has((node.propertyName ?? node.name).text)) {
      uses.push({ kind: "reexport", line: line(node), detail: "re-exports the imported factory" });
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression) && factoryLocals.has(node.expression.text)) {
      uses.push({ kind: "reexport", line: line(node), detail: "default-exports the imported factory" });
    }
    ts.forEachChild(node, refer);
  };
  refer(sf);

  for (const [local, binding] of factoryLocals) {
    const seen = references.get(local);
    // An import nobody references is still an import of the factory; count it as a value use.
    const valueUse = !binding.typeOnly && (!seen || seen.value);
    uses.push({ kind: valueUse ? "value" : "type", line: line(binding.node), detail: binding.detail });
  }
  for (const [local, binding] of namespaceLocals) {
    const seen = references.get(`*${local}`);
    if (!seen) continue;
    uses.push({ kind: !binding.typeOnly && seen.value ? "value" : "type", line: line(binding.node), detail: `namespace import ${local}` });
  }
  if (dynamicServerImport && namesFactoryOutsideType) {
    uses.push({ kind: "value", line: line(dynamicServerImport), detail: "dynamic import" });
  }
  return { uses: uses.sort((a, b) => a.line - b.line), useClient: isUseClient(sf) };
}

type Inventory = Map<string, { uses: Use[]; useClient: boolean }>;

let shipped: Inventory | null = null;

/**
 * Every shipped source file under src/ that uses the service role, except the
 * factory's own module. Parsing about 4,000 files takes seconds, so the tree is
 * read once; `sources` overlays probe files on that result.
 */
function inventory(sources: Record<string, string> = {}): Inventory {
  if (!shipped) {
    shipped = new Map();
    for (const file of walk(SRC)) {
      const id = rel(file);
      if (id.startsWith("src/test/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(id) || id === DEFINER) continue;
      const result = serviceRoleUses(id, readFileSync(file, "utf8"));
      if (result.uses.length > 0) shipped.set(id, result);
    }
  }
  const found: Inventory = new Map(shipped);
  for (const [id, source] of Object.entries(sources)) {
    const result = serviceRoleUses(id, source);
    if (result.uses.length > 0) found.set(id, result);
    else found.delete(id);
  }
  return found;
}

function describeUses(uses: Use[]): string {
  return uses.map((use) => `${use.detail} at line ${use.line}`).join("; ");
}

/** The failures a given inventory produces. Kept as a function so the guard can be run against a probe. */
function violations(found: Inventory): string[] {
  const problems: string[] = [];
  for (const [id, { uses, useClient }] of found) {
    if (useClient) {
      problems.push(`${id} is a "use client" file and uses the service role (${describeUses(uses)}). `
        + "The service-role key must never reach a browser bundle. Fetch through a route or a server component instead.");
    }
    if (id.startsWith("src/components/") && !(id in COMPONENT_FOLDER_DEBT)) {
      problems.push(`${id} is under src/components and uses the service role (${describeUses(uses)}). `
        + "Components render; they do not hold the key. Move the read to src/lib or the page and pass the result down.");
    }
    for (const use of uses.filter((candidate) => candidate.kind === "reexport")) {
      problems.push(`${id} ${use.detail} at line ${use.line}. A re-export opens a second door this guard cannot follow. `
        + `Import ${FACTORY} from "@/lib/supabase/server" where it is used.`);
    }
    if (!(id in SERVICE_ROLE_USERS)) {
      problems.push(`${id} uses the service-role client (${describeUses(uses)}) and has no entry in SERVICE_ROLE_USERS. `
        + "The service role bypasses row-level security. Use the session client from createClient() if RLS should decide. "
        + "If the service role is needed, check membership first and scope every read by workspace in code, then add "
        + `"${id}" to SERVICE_ROLE_USERS in ${THIS_GUARD} with the category that carries its authorization.`);
    }
  }
  return problems;
}

const SAFE_ROUTE = `import { NextResponse } from "next/server";\nexport async function GET() { return NextResponse.json({ ok: true }); }\n`;

describe("which files may use the service-role client", () => {
  it("lists every file that uses it, with a reason", () => {
    expect(violations(inventory())).toEqual([]);
  });

  it("only shrinks: every entry still uses the client", () => {
    const found = inventory();
    const stale = Object.keys(SERVICE_ROLE_USERS)
      .filter((id) => !found.has(id))
      .map((id) => `${id} no longer uses the service role (or no longer exists). Delete its SERVICE_ROLE_USERS entry.`);
    expect(stale).toEqual([]);
  });

  it("keeps TYPE_ONLY honest in both directions", () => {
    const found = inventory();
    const wrong: string[] = [];
    for (const [id, category] of Object.entries(SERVICE_ROLE_USERS)) {
      const uses = found.get(id)?.uses ?? [];
      if (uses.length === 0) continue;
      const createsOne = uses.some((use) => use.kind !== "type");
      if (category === "TYPE_ONLY" && createsOne) {
        wrong.push(`${id} is listed TYPE_ONLY but now creates or reaches a client (${describeUses(uses)}). Read it and give it the category that carries its authorization.`);
      }
      if (category !== "TYPE_ONLY" && !createsOne) {
        wrong.push(`${id} is listed ${category} but only uses the type now. Change its entry to TYPE_ONLY.`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("gives every entry a defined category", () => {
    const undefinedCategory = Object.entries(SERVICE_ROLE_USERS).filter(([, category]) => !(category in CATEGORIES));
    expect(undefinedCategory).toEqual([]);
  });

  it("does not let UNREVIEWED entries grow", () => {
    const unreviewed = Object.entries(SERVICE_ROLE_USERS).filter(([, category]) => category === "UNREVIEWED");
    expect(unreviewed.length, `UNREVIEWED entries: ${unreviewed.map(([id]) => id).join(", ")}`).toBeLessThanOrEqual(UNREVIEWED_CEILING);
  });

  it("keeps the component-folder debt shrinking and server-only", () => {
    const found = inventory();
    for (const [id, reason] of Object.entries(COMPONENT_FOLDER_DEBT)) {
      expect(reason.length).toBeGreaterThan(20);
      const entry = found.get(id);
      expect(entry, `${id} no longer uses the service role. Delete it from COMPONENT_FOLDER_DEBT.`).toBeDefined();
      expect(entry!.useClient, `${id} must stay server-only`).toBe(false);
      expect(id in SERVICE_ROLE_USERS, `${id} must also be in SERVICE_ROLE_USERS`).toBe(true);
    }
  });

  it("anchors on the factory that actually holds the key", () => {
    // If the factory is renamed or moved, every check above would go quiet.
    const definer = readFileSync(path.join(process.cwd(), DEFINER), "utf8");
    expect(definer).toMatch(new RegExp(`export function ${FACTORY}\\(`));
    expect(serviceRoleUses(DEFINER, definer).uses.some((use) => use.kind === "key")).toBe(true);
    const found = inventory();
    expect(found.size).toBeGreaterThan(150);
    expect(Object.keys(SERVICE_ROLE_USERS).length).toBe(found.size);
  });

  describe("guards the guard", () => {
    const uses = (source: string, id = "src/app/api/probe/route.ts") =>
      serviceRoleUses(id, source).uses.map((use) => use.kind);

    it("counts every way the client is reached", () => {
      expect(uses(`import { createServiceRoleClient } from "@/lib/supabase/server";\nexport const s = () => createServiceRoleClient();`)).toEqual(["value"]);
      expect(uses(`import { createServiceRoleClient as admin } from "@/lib/supabase/server";\nconst c = admin();`)).toEqual(["value"]);
      expect(uses(`import {\n  createClient,\n  createServiceRoleClient,\n} from "../../../lib/supabase/server";\ncreateServiceRoleClient();`)).toEqual(["value"]);
      expect(uses(`import * as sb from "@/lib/supabase/server";\nsb.createServiceRoleClient();`)).toEqual(["value"]);
      expect(uses(`const run = async () => { const { createServiceRoleClient } = await import("@/lib/supabase/server"); return createServiceRoleClient(); };`)).toEqual(["value"]);
      expect(uses(`const c = (await import("@/lib/supabase/server")).createServiceRoleClient();`)).toEqual(["value"]);
      expect(uses(`const key = process.env.SUPABASE_SERVICE_ROLE_KEY;`)).toEqual(["key"]);
      expect(uses(`const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];`)).toEqual(["key"]);
      expect(uses(`const { SUPABASE_SERVICE_ROLE_KEY: key } = process.env;`)).toEqual(["key"]);
      expect(uses(`import { createClient } from "@supabase/supabase-js";\ncreateClient(url, key);`)).toEqual(["raw"]);
      expect(uses(`export { createServiceRoleClient } from "@/lib/supabase/server";`)).toEqual(["reexport"]);
      expect(uses(`export * from "@/lib/supabase/server";`)).toEqual(["reexport"]);
      expect(uses(`import { createServiceRoleClient } from "@/lib/supabase/server";\nexport { createServiceRoleClient as admin };`).sort()).toEqual(["reexport", "value"]);
    });

    it("tells the type from the client", () => {
      expect(uses(`import type { createServiceRoleClient } from "@/lib/supabase/server";\ntype S = ReturnType<typeof createServiceRoleClient>;`)).toEqual(["type"]);
      expect(uses(`import { createServiceRoleClient } from "@/lib/supabase/server";\ntype S = ReturnType<typeof createServiceRoleClient>;`)).toEqual(["type"]);
      expect(uses(`import { createServiceRoleClient } from "@/lib/supabase/server";\ntype S = ReturnType<typeof createServiceRoleClient>;\nconst s: S = createServiceRoleClient();`)).toEqual(["value"]);
    });

    it("ignores comments, strings and look-alikes", () => {
      expect(uses(`// call createServiceRoleClient() only after a membership check\nexport const x = 1;`)).toEqual([]);
      expect(uses(`/** import { createServiceRoleClient } from "@/lib/supabase/server" */\nexport const x = 1;`)).toEqual([]);
      expect(uses(`const message = "never call createServiceRoleClient() or read SUPABASE_SERVICE_ROLE_KEY here";`)).toEqual([]);
      expect(uses(`const names = ["SUPABASE_SERVICE_ROLE_KEY"];`)).toEqual([]);
      expect(uses(`import { createClient } from "@/lib/supabase/server";\nconst s = await createClient();`)).toEqual([]);
      expect(uses(`import * as sb from "@/lib/supabase/server";\nconst s = await sb.createClient();`)).toEqual([]);
      expect(uses(`const { createClient } = await import("@/lib/supabase/server");`)).toEqual([]);
      expect(uses(`import type { SupabaseClient } from "@supabase/supabase-js";`)).toEqual([]);
      expect(uses(`import { createServiceRoleClient } from "@/lib/other/server";\ncreateServiceRoleClient();`)).toEqual([]);
      expect(uses(`import { createBrowserClient } from "@supabase/ssr";`, "src/lib/supabase/client.ts")).toEqual([]);
    });

    it("fails a new user, a client component and a component, with instructions", () => {
      // Only what each probe adds; a real violation elsewhere is the first test's to report.
      const baseline = new Set(violations(inventory()));
      const added = (sources: Record<string, string>) => violations(inventory(sources)).filter((problem) => !baseline.has(problem));
      const newRoute = "src/app/api/probe-new/route.ts";
      const problems = added({ [newRoute]: `import { createServiceRoleClient as db } from "@/lib/supabase/server";\nexport async function GET() { return Response.json(await db().from("projects").select("id")); }\n` });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(`${newRoute} uses the service-role client (import as db at line 1)`);
      expect(problems[0]).toContain("add \"src/app/api/probe-new/route.ts\" to SERVICE_ROLE_USERS");

      const clientFile = "src/app/(app)/probe/panel.tsx";
      const clientProblems = added({ [clientFile]: `"use client";\nimport { createServiceRoleClient } from "@/lib/supabase/server";\nexport function P() { createServiceRoleClient(); return null; }\n` });
      expect(clientProblems.some((problem) => problem.startsWith(`${clientFile} is a "use client" file`))).toBe(true);

      const component = "src/components/probe/loader.ts";
      const componentProblems = added({ [component]: `import type { createServiceRoleClient } from "@/lib/supabase/server";\nexport type S = ReturnType<typeof createServiceRoleClient>;\n` });
      expect(componentProblems.some((problem) => problem.startsWith(`${component} is under src/components`))).toBe(true);

      // The control: a new file with no service-role use, and a comment naming the factory, adds nothing.
      expect(added({ "src/app/api/probe-quiet/route.ts": `// do not call createServiceRoleClient here\n${SAFE_ROUTE}` })).toEqual([]);
    });
  });
});
