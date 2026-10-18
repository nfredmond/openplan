import { z } from "zod";
import { parseOptionalMoney, type ExactMoneyAmount } from "@/lib/money/optional-amount";
import {
  buildEngagementBilledPosition,
  type EngagementBilledSummary,
  type InvoicingEngagementLike,
} from "./receivables";

export type EngagementSummaryScope = {
  workspaceId: string;
  engagementId?: string;
  excludeInvoiceId?: string;
};
export type EngagementSummaryClient = {
  rpc: (name: "engagement_billed_summaries_v1", args: {
    p_workspace_id: string; p_engagement_id: string | null; p_exclude_invoice_id: string | null;
  }) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};
type SourceError = { code?: string; message: string };
export type EngagementSummaryRead = {
  state: "complete" | "pending" | "unavailable";
  summaries: ReadonlyMap<string, EngagementBilledSummary>;
  error?: SourceError;
};

const bucket = z.object({ amount: z.string().nullable(), missing: z.string().regex(/^\d+$/), invalid: z.string().regex(/^\d+$/) });
const row = z.object({
  engagement_id: z.string().min(1), not_to_exceed_amount: z.string().nullable(), billed: bucket, draft: bucket,
});
const envelope = z.object({
  version: z.literal(1), workspace_id: z.string(), engagement_id: z.string().nullable(), exclude_invoice_id: z.string().nullable(),
}).and(z.discriminatedUnion("complete", [
  z.object({ complete: z.literal(true), data: z.array(row), error: z.null() }),
  z.object({ complete: z.literal(false), data: z.unknown(), error: z.object({ code: z.string().optional(), message: z.string() }) }),
]));

/** A missing named public RPC is pending. Dependency or permission failures are not. */
function missingRpc(error: SourceError): boolean {
  const name = '(?:public|"public")\\.(?:engagement_billed_summaries_v1|"engagement_billed_summaries_v1")';
  return error.code === "42883"
    ? new RegExp(`^function ${name}\\(uuid, uuid, uuid\\) does not exist$`).test(error.message)
    : error.code === "PGRST202" && new RegExp(`^Could not find the function ${name}(?:\\(p_engagement_id, p_exclude_invoice_id, p_workspace_id\\)| with parameters p_engagement_id, p_exclude_invoice_id, p_workspace_id)? in the schema cache$`).test(error.message);
}

function failed(error: SourceError): EngagementSummaryRead {
  return { state: missingRpc(error) ? "pending" : "unavailable", summaries: new Map(), error };
}

/** Aggregate NUMERIC text has no per-row ceiling and never passes through Number. */
function amount(value: z.infer<typeof bucket>): { amount: ExactMoneyAmount | null; unavailable?: "missing" | "invalid" } {
  if (BigInt(value.missing) > BigInt(0)) return { amount: null, unavailable: "missing" };
  if (BigInt(value.invalid) > BigInt(0)) return { amount: null, unavailable: "invalid" };
  if (value.amount === null) return { amount: null, unavailable: "missing" };
  try {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value.amount)) throw new Error("Invalid aggregate amount");
    return { amount: parseOptionalMoney(value.amount) };
  } catch {
    return { amount: null, unavailable: "invalid" };
  }
}

/** No fallback to a capped register. The RPC's scope echo binds every response. */
export async function loadEngagementBilledSummaries(client: EngagementSummaryClient, scope: EngagementSummaryScope): Promise<EngagementSummaryRead> {
  try {
    const result = await client.rpc("engagement_billed_summaries_v1", {
      p_workspace_id: scope.workspaceId, p_engagement_id: scope.engagementId ?? null, p_exclude_invoice_id: scope.excludeInvoiceId ?? null,
    });
    if (result.error) return failed({ message: result.error.message ?? "Engagement summary source failed.", ...(result.error.code === undefined ? {} : { code: result.error.code }) });
    const parsed = envelope.safeParse(result.data);
    if (!parsed.success || parsed.data.workspace_id !== scope.workspaceId || parsed.data.engagement_id !== (scope.engagementId ?? null) ||
      parsed.data.exclude_invoice_id !== (scope.excludeInvoiceId ?? null)) {
      return failed({ message: "Engagement summary snapshot is incomplete, invalid or outside the requested scope." });
    }
    if (!parsed.data.complete) return { state: "unavailable", summaries: new Map(), error: parsed.data.error };
    const summaries = new Map<string, EngagementBilledSummary>();
    for (const entry of parsed.data.data) {
      if (summaries.has(entry.engagement_id) || (scope.engagementId !== undefined && entry.engagement_id !== scope.engagementId)) {
        return failed({ message: "Engagement summary snapshot contains duplicate or foreign identities." });
      }
      const billed = amount(entry.billed);
      const draft = amount(entry.draft);
      const summary = buildEngagementBilledPosition({ not_to_exceed_amount: entry.not_to_exceed_amount }, billed.amount, draft.amount, {
        ...(billed.unavailable ? { billedToDate: billed.unavailable } : {}),
        ...(draft.unavailable ? { draftedUnbilled: draft.unavailable } : {}),
      });
      summaries.set(entry.engagement_id, { ...summary, source: { state: "complete" } });
    }
    if (scope.engagementId !== undefined && !summaries.has(scope.engagementId)) return failed({ message: "Requested engagement summary is absent from the snapshot." });
    return { state: "complete", summaries };
  } catch (error) {
    const parsed = z.object({ message: z.string(), code: z.string().optional() }).safeParse(error);
    return failed(parsed.success ? parsed.data : { message: "Engagement summary snapshot could not be read." });
  }
}

/** Missing source is unknown money, even when the visible invoice register is empty. */
export function engagementSummaryFor(read: EngagementSummaryRead, engagement: InvoicingEngagementLike): EngagementBilledSummary {
  const summary = engagement.id ? read.summaries.get(engagement.id) : undefined;
  if (read.state === "complete" && summary) return summary;
  return { ...buildEngagementBilledPosition(engagement, null, null), source: {
    state: read.state === "pending" ? "pending" : "unavailable",
    error: read.error ?? { message: "Engagement summary is absent from the complete snapshot." },
  } };
}
