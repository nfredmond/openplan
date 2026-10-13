import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CONTRACT_IMAGERY_TYPES,
  PROCESSING_PRESET_IDS,
  processingRequestSchema,
} from "@/lib/aerial/processing-contract";

const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const RPC_TIMEOUT_MS = 10_000;
const identitySchema = z.string().min(1).max(256).refine((value) => value === value.trim());
const scopeSchema = z.object({ installationId: identitySchema, targetId: identitySchema }).strict();

export const originalApplicationJobSchema = z.object({
  id: z.string().uuid(),
  request_id: z.string().min(8).max(128),
  workspace_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  mission_id: z.string().uuid(),
  created_by: z.string().uuid(),
  preset_id: z.enum(PROCESSING_PRESET_IDS),
  imagery_type: z.enum(CONTRACT_IMAGERY_TYPES),
}).strict();

export type OriginalApplicationJob = z.infer<typeof originalApplicationJobSchema>;
export type DispatchCustodyScope = { installationId: string; targetId: string };

interface DispatchCustodyClient {
  rpc(name: string, parameters: Record<string, string>): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  };
}

const receiptSchema = z.object({
  format: z.literal("openplan.odm-application-dispatch.v1"),
  installationId: identitySchema,
  targetId: identitySchema,
  applicationJob: originalApplicationJobSchema,
  payloadText: z.string(),
  payloadBytes: z.number().int().min(1).max(MAX_PAYLOAD_BYTES),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
  engineTransportPermission: z.literal(false),
}).strict();

// Enabling custody requires an installed candidate migration and stable local
// identities. An absent flag preserves the existing external worker contract.
export function resolveDispatchCustodyScope(
  environment: Record<string, string | undefined> = process.env,
): DispatchCustodyScope | null {
  const flag = environment.OPENPLAN_AERIAL_DISPATCH_CUSTODY?.trim();
  if (!flag || flag === "0") return null;
  if (flag !== "1") throw new Error("Aerial dispatch custody setting is invalid");
  const scope = scopeSchema.safeParse({
    installationId: environment.OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID?.trim(),
    targetId: environment.OPENPLAN_AERIAL_DISPATCH_TARGET_ID?.trim(),
  });
  if (!scope.success) throw new Error("Aerial dispatch custody identities are required");
  return scope.data;
}

// Check semantic scope separately from the original wire bytes. Parsing never
// replaces the text sent to storage or the worker, including its whitespace.
function validatePayload(payloadText: string, job: OriginalApplicationJob): void {
  const bytes = Buffer.byteLength(payloadText, "utf8");
  if (bytes < 1 || bytes > MAX_PAYLOAD_BYTES) throw new Error("Original aerial dispatch byte limit differs");
  let decoded: unknown;
  try { decoded = JSON.parse(payloadText); }
  catch { throw new Error("Original aerial dispatch contract differs"); }
  const request = processingRequestSchema.safeParse(decoded);
  if (!request.success) throw new Error("Original aerial dispatch contract differs");
  const value = request.data;
  if (value.requestId !== job.request_id || value.externalRef.system !== "openplan"
    || value.externalRef.workspaceId !== job.workspace_id || value.externalRef.missionId !== job.mission_id
    || (value.externalRef.projectId ?? null) !== job.project_id
    || (value.presetId ?? "balanced") !== job.preset_id || value.imagery.type !== job.imagery_type) {
    throw new Error("Original aerial dispatch job scope differs");
  }
}

function validateReceipt(data: unknown, scope: DispatchCustodyScope, job: OriginalApplicationJob, payloadText: string) {
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success) throw new Error("Original aerial dispatch receipt differs");
  const receipt = parsed.data;
  if (receipt.installationId !== scope.installationId || receipt.targetId !== scope.targetId
    || Object.keys(job).some((key) => receipt.applicationJob[key as keyof OriginalApplicationJob] !== job[key as keyof OriginalApplicationJob])) {
    throw new Error("Original aerial dispatch receipt scope differs");
  }
  if (receipt.payloadText !== payloadText || receipt.payloadBytes !== Buffer.byteLength(payloadText, "utf8")
    || receipt.payloadSha256 !== createHash("sha256").update(payloadText, "utf8").digest("hex")) {
    throw new Error("Original aerial dispatch receipt bytes differ");
  }
  return receipt;
}

// The service RPC locks current parents and stores one immutable original. A
// missing or uncertain reply refuses dispatch; it does not infer custody.
export async function recordOriginalDispatch(
  client: DispatchCustodyClient, scope: DispatchCustodyScope,
  expectedJob: OriginalApplicationJob, payloadText: string,
) {
  const job = originalApplicationJobSchema.parse(expectedJob);
  scope = scopeSchema.parse(scope);
  validatePayload(payloadText, job);
  const { data, error } = await Promise.resolve().then(() => client.rpc("record_aerial_original_dispatch", {
    p_job: job.id, p_actor: job.created_by,
    p_installation: scope.installationId, p_target: scope.targetId, p_payload_text: payloadText,
  }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))).catch(() => ({ data: null, error: true }));
  if (error) throw new Error("Original aerial dispatch custody is unavailable");
  return validateReceipt(data, scope, job, payloadText);
}

// A current read can refuse revoked scope without changing the original. The
// result remains an observation, not an engine command grant or lease.
export async function readOriginalDispatch(
  client: DispatchCustodyClient, scope: DispatchCustodyScope,
  expectedJob: OriginalApplicationJob, payloadText: string,
) {
  const job = originalApplicationJobSchema.parse(expectedJob);
  scope = scopeSchema.parse(scope);
  validatePayload(payloadText, job);
  const { data, error } = await Promise.resolve().then(() => client.rpc("read_aerial_original_dispatch", {
    p_request: job.request_id, p_installation: scope.installationId, p_target: scope.targetId,
  }).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))).catch(() => ({ data: null, error: true }));
  if (error) throw new Error("Original aerial dispatch custody is unavailable");
  const observed = receiptSchema.extend({
    authorizedNow: z.boolean(), authorityObservedAt: z.string().datetime({ offset: true }),
  }).safeParse(data);
  if (!observed.success) throw new Error("Original aerial dispatch observation differs");
  const { authorizedNow, authorityObservedAt, ...original } = observed.data;
  const receipt = validateReceipt(original, scope, job, payloadText);
  return { ...receipt, authorizedNow, authorityObservedAt };
}
