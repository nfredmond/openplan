import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const count = z.number().int().nonnegative().safe();
const countsSchema = z.object({
  queued: count.optional(), attempting: count.optional(), accepted: count.optional(),
  skipped: count.optional(), failed: count.optional(), uncertain: count.optional(), cancelled: count.optional(),
}).strict();

export const responseBroadcastSchema = z.object({
  campaignId: z.string().uuid(),
  requestId: z.string().uuid(),
  state: z.enum(["queued", "prepared", "cancelled", "no_share_token"]),
  preparedCount: count.nullable(),
  counts: countsSchema,
}).strict().refine(report => {
  const total = Object.values(report.counts).reduce((sum, value) => sum + (value ?? 0), 0);
  return report.state === "prepared"
    ? report.preparedCount !== null && total === report.preparedCount
    : report.preparedCount === null && total === 0;
}, "Broadcast counts do not match preparation state");
export type ResponseBroadcast = z.infer<typeof responseBroadcastSchema>;
export type ResponseBroadcastRead =
  | { report: ResponseBroadcast | null; error: null }
  | { report: null; error: { kind: "forbidden" | "unavailable"; message: string; status: number } };

/** Read private aggregate outcomes. An unreadable or incomplete report never means zero recipients. */
export async function loadResponseBroadcast(
  client: Pick<SupabaseClient, "rpc">, campaignId: string, requestId: string,
): Promise<ResponseBroadcastRead> {
  try {
    const response = await client.rpc("read_engagement_response_broadcast", {
      p_campaign: campaignId, p_request: requestId,
    });
    if (response.error?.code === "42501") return {
      report: null, error: { kind: "forbidden", status: 403, message: "Staff access is required to read subscriber update status." },
    };
    if (response.error) throw new Error("Broadcast read failed");
    if (response.data === null) return { report: null, error: null };
    const report = responseBroadcastSchema.parse(response.data);
    if (report.campaignId !== campaignId || report.requestId !== requestId) throw new Error("Broadcast scope mismatch");
    return { report, error: null };
  } catch {
    return {
      report: null,
      error: { kind: "unavailable", status: 503, message: "Subscriber update status could not be read. This does not mean no emails were sent." },
    };
  }
}
