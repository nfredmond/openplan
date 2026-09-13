import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { retainedTranslationSchema, translationHistoryMetadataSchema, type TranslationHistoryEntry } from "./translation-history";

const snapshotSchema = z.object({
  campaignId: z.string().uuid(),
  count: z.number().int().nonnegative(),
  entries: translationHistoryMetadataSchema.extend({ record_text: z.string() }).array(),
});

/** Verify the exact stored bytes and complete sequence before returning private copies. */
export async function loadTranslationHistory(client: Pick<SupabaseClient, "rpc">, campaignId: string, workspaceId: string): Promise<{
  rows: TranslationHistoryEntry[]; error: { message: string } | null;
}> {
  try {
    const result = await client.rpc("read_engagement_translation_history", { p_campaign: campaignId });
    if (result.error) throw new Error("History read failed");
    const snapshot = snapshotSchema.parse(result.data);
    if (snapshot.campaignId !== campaignId || snapshot.count !== snapshot.entries.length) throw new Error("Incomplete history");
    const ids = new Set<string>();
    const latest = new Map<string, TranslationHistoryEntry>();
    const rows = snapshot.entries.map(({ record_text, ...entry }) => {
      const previous = latest.get(entry.translation_id);
      if (entry.campaign_id !== campaignId || ids.has(entry.id)
        || entry.revision !== (previous?.revision ?? 0) + 1
        || previous?.event === "removed") throw new Error("Invalid history sequence");
      if (createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256) throw new Error("History checksum mismatch");
      const record = retainedTranslationSchema.parse(JSON.parse(record_text));
      if (record.id !== entry.translation_id || record.campaign_id !== campaignId || record.workspace_id !== workspaceId) throw new Error("Invalid retained translation scope");
      if (entry.revision === 1 ? !["created", "legacy_baseline"].includes(entry.event) : ["created", "legacy_baseline"].includes(entry.event)) throw new Error("Invalid history baseline");
      if (entry.event === "legacy_baseline" && entry.actor_id !== null) throw new Error("Invented baseline actor");
      if (previous && ["entity_type", "entity_id", "field", "locale"].some(key => {
        const field = key as "entity_type" | "entity_id" | "field" | "locale";
        return previous.record[field] !== record[field];
      })) throw new Error("Translation address changed");
      const row = { ...entry, record };
      ids.add(entry.id);
      latest.set(entry.translation_id, row);
      return row;
    });
    return { rows, error: null };
  } catch {
    return { rows: [], error: { message: "Translation history could not be read and verified completely. Try again." } };
  }
}
