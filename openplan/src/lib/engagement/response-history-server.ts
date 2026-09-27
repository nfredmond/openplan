import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { closeLoopEntrySchema } from "./close-loop";
import { responseHistoryMetadataSchema, type ResponseHistoryEntry } from "./response-history";

const snapshotSchema = z.object({
  campaignId: z.string().uuid(),
  count: z.number().int().nonnegative(),
  entries: responseHistoryMetadataSchema.extend({ record_text: z.string() }).array(),
});

/** Preserve exact stored text for evidence links while verifying the entire history before returning any row. */
export function readResponseHistorySnapshot(raw: unknown, campaignId: string) {
  const snapshot = snapshotSchema.parse(raw);
  if (snapshot.campaignId !== campaignId || snapshot.count !== snapshot.entries.length) throw new Error("Incomplete history");
  const ids = new Set<string>();
  const revisions = new Map<string, number>();
  const removed = new Set<string>();
  const rows = snapshot.entries.map(({ record_text, ...entry }) => {
    if (entry.campaign_id !== campaignId || ids.has(entry.id)
      || entry.revision !== (revisions.get(entry.response_id) ?? 0) + 1
      || removed.has(entry.response_id)) throw new Error("Invalid history sequence");
    if (createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256) throw new Error("History checksum mismatch");
    const record = closeLoopEntrySchema.parse(JSON.parse(record_text));
    if (record.id !== entry.response_id || record.campaign_id !== campaignId) throw new Error("Invalid retained response scope");
    if (entry.revision === 1 ? !["created", "legacy_baseline"].includes(entry.event) : ["created", "legacy_baseline"].includes(entry.event)) throw new Error("Invalid history baseline");
    ids.add(entry.id);
    revisions.set(entry.response_id, entry.revision);
    if (entry.event === "removed") removed.add(entry.response_id);
    return { ...entry, record };
  });
  return { rows, records: snapshot.entries };
}

/** Existing staff history responses retain their parsed-row contract and private failure behavior. */
export async function loadResponseHistory(client: Pick<SupabaseClient, "rpc">, campaignId: string): Promise<{
  rows: ResponseHistoryEntry[]; error: { message: string } | null;
}> {
  try {
    const result = await client.rpc("read_engagement_response_history", { p_campaign: campaignId });
    if (result.error) throw new Error("History read failed");
    return { rows: readResponseHistorySnapshot(result.data, campaignId).rows, error: null };
  } catch {
    return { rows: [], error: { message: "Response history could not be read and verified completely. Try again." } };
  }
}
