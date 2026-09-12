import { z } from "zod";

// Browser-readable metadata only. Credential storage and endpoint permission
// checks stay on the server; this schema never imports the network transport.
const configuration = z.object({
  label: z.string(), protocol: z.literal("openai_chat_completions"), endpoint: z.string(),
  modelIds: z.array(z.string()), structuredOutput: z.literal(true),
  authMode: z.enum(["api_key", "none"]), timeoutSeconds: z.number(),
});
export const providerApiRevisionMetadata = z.object({
  id: z.string().uuid(), connection_id: z.string().uuid(), workspace_id: z.string().uuid(),
  previous_revision_id: z.string().uuid().nullable(), configuration,
  configuration_hash: z.string(), configured_by: z.string().uuid(), created_at: z.string(),
});
export const providerApiConnectionMetadata = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), current_revision_id: z.string().uuid().nullable(),
  created_by: z.string().uuid(), created_at: z.string(), revoked_at: z.string().nullable(),
});
export const providerApiListedConnection = providerApiConnectionMetadata.extend({
  current_revision: providerApiRevisionMetadata.nullable(),
});
const page = z.object({ total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() });
export const providerApiConnectionPage = page.extend({ connections: z.array(providerApiListedConnection) });
export const providerApiRevisionPage = page.extend({ revisions: z.array(providerApiRevisionMetadata) });
export const providerApiSavedRevision = z.object({
  created: z.boolean(), connection: providerApiConnectionMetadata, revision: providerApiRevisionMetadata,
});
export type ApiListedConnection = z.infer<typeof providerApiListedConnection>;
export type ApiRevisionMetadata = z.infer<typeof providerApiRevisionMetadata>;
