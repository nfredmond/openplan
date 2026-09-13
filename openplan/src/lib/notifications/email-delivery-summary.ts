import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const count = z.number().int().nonnegative().safe();
export const emailDeliveryRecordSchema = z.object({
  ok: z.literal(true), campaignId: z.string().uuid(), total: count,
  counts: z.object({ queued: count, sent: count, skipped: count, failed: count,
    attempting: count, uncertain: count, cancelled: count }).strict(),
  broadcasts: z.object({ queued: count, prepared: count, cancelled: count, noShareToken: count }).strict(),
  transports: z.array(z.enum(["none", "resend", "other"])),
  lastRecordedAt: z.iso.datetime({ offset: true }).nullable(),
  lastFailure: z.object({ at: z.iso.datetime({ offset: true }), message: z.literal(
    "A delivery failure was recorded. This does not establish whether the message reached an inbox."
  ) }).strict().nullable(),
}).strict().refine(record => Object.values(record.counts).reduce((sum, value) => sum + value, 0) === record.total,
  "Message counts must cover the complete delivery record");

export type EmailDeliverySummary = z.infer<typeof emailDeliveryRecordSchema> | { ok: false; message: string };

/** Read aggregate outcomes under the caller's current membership, never a privileged recipient projection. */
export async function loadCampaignEmailDeliverySummary(
  client: Pick<SupabaseClient, "rpc">, campaignId: string,
): Promise<EmailDeliverySummary> {
  try {
    const { data, error } = await client.rpc("read_engagement_email_delivery_summary", { p_campaign: campaignId });
    if (error) throw new Error("Delivery summary unavailable");
    const record = emailDeliveryRecordSchema.parse(data);
    if (record.campaignId !== campaignId) throw new Error("Delivery summary scope mismatch");
    return record;
  } catch {
    return { ok: false, message: "The complete email delivery record could not be read. No delivery outcome can be inferred." };
  }
}
