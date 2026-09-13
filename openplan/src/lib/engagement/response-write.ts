import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeLoopEntrySchema } from "./close-loop";

const responseFields = {
  themeTitle: z.string().trim().min(1).max(200),
  youSaid: z.string().trim().max(5000),
  weDid: z.string().trim().max(5000),
  categoryId: z.string().uuid().nullable(),
  sourceItemIds: z.array(z.string().uuid()).max(300),
  aiAssisted: z.boolean(),
  status: z.enum(["draft", "published"]),
  sortOrder: z.number().int().min(0).max(10000),
};
const intent = {
  requestId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(2000),
};

export const createResponseSchema = z.object(responseFields).partial().extend({
  requestId: intent.requestId,
  themeTitle: responseFields.themeTitle,
}).strict();
export const updateResponseSchema = z.object(responseFields).partial().extend(intent).strict()
  .refine(body => Object.keys(responseFields).some(key => key in body), "No response fields to update");
export const removeResponseSchema = z.object(intent).strict();

export type ResponseWriteIntent =
  | { operation: "create"; body: z.infer<typeof createResponseSchema> }
  | { operation: "update"; entryId: string; body: z.infer<typeof updateResponseSchema> }
  | { operation: "remove"; entryId: string; body: z.infer<typeof removeResponseSchema> };

export const responseWriteResultSchema = z.object({
  entry: closeLoopEntrySchema,
  entryId: z.string().uuid(),
  requestId: z.string().uuid(),
  removed: z.boolean(),
  replayed: z.boolean(),
  becamePublished: z.boolean(),
});
export type ResponseWriteResult = z.infer<typeof responseWriteResultSchema>;
export type ResponseWriteFailure = {
  kind: "conflict" | "missing" | "forbidden" | "invalid" | "unavailable";
  status: number;
  message: string;
};

const fieldColumns = {
  themeTitle: "theme_title", youSaid: "you_said", weDid: "we_did", categoryId: "category_id",
  sourceItemIds: "source_item_ids", aiAssisted: "ai_assisted", status: "status", sortOrder: "sort_order",
} as const;

/** Send the exact validated intent to the transaction; never manufacture a retry identity or version. */
export async function writeResponse(client: Pick<SupabaseClient, "rpc">, campaignId: string, intent: ResponseWriteIntent): Promise<
  { result: ResponseWriteResult; error: null } | { result: null; error: ResponseWriteFailure }
> {
  const changes: Record<string, unknown> = {};
  if (intent.operation !== "remove") {
    for (const key of Object.keys(fieldColumns) as (keyof typeof fieldColumns)[]) {
      if (intent.body[key] !== undefined) changes[fieldColumns[key]] = intent.body[key];
    }
  }
  try {
    const response = await client.rpc("write_engagement_response", {
      p_campaign: campaignId, p_request: intent.body.requestId, p_operation: intent.operation,
      p_response: intent.operation === "create" ? null : intent.entryId,
      p_expected_updated_at: intent.operation === "create" ? null : intent.body.expectedUpdatedAt,
      p_reason: intent.operation === "create" ? null : intent.body.reason,
      p_changes: changes,
    });
    if (response.error) return { result: null, error: responseWriteFailure(response.error.code, response.error.message) };
    const result = responseWriteResultSchema.parse(response.data);
    if (result.requestId !== intent.body.requestId || result.entryId !== result.entry.id
      || result.entry.campaign_id !== campaignId
      || (intent.operation !== "create" && result.entryId !== intent.entryId)
      || result.removed !== (intent.operation === "remove")
      || (result.becamePublished && (result.removed || result.entry.status !== "published"))) {
      throw new Error("Response receipt does not match the request");
    }
    return { result, error: null };
  } catch {
    return { result: null, error: responseWriteFailure() };
  }
}

/** Database conflicts are terminal for this edit intent; transport failures keep the same pending request. */
function responseWriteFailure(code?: string, message?: string): ResponseWriteFailure {
  if (code === "40001" || code === "23505") return {
    kind: "conflict", status: 409, message: "This response or request has changed. Review the current saved copy before making another change.",
  };
  if (code === "P0002") return { kind: "missing", status: 404, message: "This response no longer exists. Its retained history is still available." };
  if (code === "42501") return { kind: "forbidden", status: 403, message: "You no longer have permission to change this campaign's responses." };
  if (code === "22023" || code === "22P02" || (code === "P0001"
    && message === "Review and publish linked contributions before publishing the staff response")) return {
    kind: "invalid", status: 400, message: "The response could not be saved. Review its fields and linked contributions before trying again.",
  };
  return { kind: "unavailable", status: 503, message: "OpenPlan could not confirm this save. Keep your words and retry the same request." };
}
