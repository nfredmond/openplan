import { createHash } from "node:crypto";
import { z } from "zod";
import { apiEndpointUrl } from "@/lib/assistant/provider-api-transport";
import { decryptIntegrationKey, encryptIntegrationKey } from "./key-crypto";

export class ProviderApiCredentialError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const endpointSchema = z.string().transform((value, context) => {
  try { return apiEndpointUrl(value).href; } catch {
    context.addIssue({ code: "custom", message: "Invalid API endpoint" });
    return z.NEVER;
  }
});
const modelSchema = z.string().min(1).max(160).regex(/^[^\s\u0000-\u001f\u007f]+$/);

// Parsing never contacts a provider. Network permission is rechecked by the
// transport when an authorized saved attempt is actually claimed.
export const providerApiConfigurationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  protocol: z.literal("openai_chat_completions"),
  endpoint: endpointSchema,
  modelIds: z.array(modelSchema).min(1).max(32).refine(ids => new Set(ids).size === ids.length),
  structuredOutput: z.literal(true),
  authMode: z.enum(["api_key", "none"]),
  timeoutSeconds: z.number().int().min(1).max(900),
}).strict();
export type ProviderApiConfiguration = z.infer<typeof providerApiConfigurationSchema>;

const identitySchema = z.object({ workspaceId: z.string().uuid(), revisionId: z.string().uuid() }).strict();
const keySchema = z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/);
const envelopeSchema = identitySchema.extend({
  version: z.literal(1), configurationHash: z.string().regex(/^[a-f0-9]{64}$/), apiKey: keySchema,
}).strict();
const storedSchema = identitySchema.extend({
  configuration: providerApiConfigurationSchema,
  configurationHash: z.string().regex(/^[a-f0-9]{64}$/),
  credentialCiphertext: z.string().min(1).max(32_000).nullable(),
}).strict();
export type StoredProviderApiRevision = z.infer<typeof storedSchema>;

function configurationHash(configuration: ProviderApiConfiguration): string {
  return createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
}

// Encrypt the identity alongside the key so copying ciphertext to another
// workspace, revision or destination fails even under the same operator secret.
export function prepareProviderApiRevision(args: {
  workspaceId: string; revisionId: string; configuration: unknown; apiKey: unknown;
}): StoredProviderApiRevision {
  try {
    const identity = identitySchema.parse({ workspaceId: args.workspaceId, revisionId: args.revisionId });
    const configuration = providerApiConfigurationSchema.parse(args.configuration);
    const hash = configurationHash(configuration);
    const apiKey = configuration.authMode === "none" ? z.null().parse(args.apiKey) : keySchema.parse(args.apiKey);
    const credentialCiphertext = apiKey === null ? null : encryptIntegrationKey(JSON.stringify({
      version: 1, ...identity, configurationHash: hash, apiKey,
    }));
    return { ...identity, configuration, configurationHash: hash, credentialCiphertext };
  } catch {
    throw new ProviderApiCredentialError("api_connection_not_stored");
  }
}

// A failed decrypt or changed identity is a refusal, never permission to use an
// environment key, a newer connection revision or the existing Anthropic mode.
export function openProviderApiRevisionCredential(raw: unknown): string | null {
  try {
    const stored = storedSchema.parse(raw);
    if (configurationHash(stored.configuration) !== stored.configurationHash) throw new Error();
    if (stored.configuration.authMode === "none") {
      if (stored.credentialCiphertext !== null) throw new Error();
      return null;
    }
    if (stored.credentialCiphertext === null) throw new Error();
    const plaintext = decryptIntegrationKey(stored.credentialCiphertext);
    if (plaintext === null) throw new Error();
    const envelope = envelopeSchema.parse(JSON.parse(plaintext));
    if (envelope.workspaceId !== stored.workspaceId || envelope.revisionId !== stored.revisionId ||
      envelope.configurationHash !== stored.configurationHash) throw new Error();
    return envelope.apiKey;
  } catch {
    throw new ProviderApiCredentialError("api_connection_credential_unavailable");
  }
}
