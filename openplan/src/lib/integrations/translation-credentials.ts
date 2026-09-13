import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptIntegrationKey, encryptIntegrationKey } from "./key-crypto";

const id = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.object({ workspaceId: id, requestId: id, credentialId: id }).strict();
const configuration = z.object({
  provider: z.literal("anthropic"),
  modelId: z.string().min(1).max(160).regex(/^[^\s\u0000-\u001f\u007f]+$/),
  recipeVersion: z.literal(1),
}).strict();
const key = z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/);
const credentialSource = z.enum(["workspace", "env"]);
const envelope = identity.extend({
  version: z.literal(1), configurationHash: hash, source: credentialSource, apiKey: key,
}).strict();
export const translationCredentialSchema = identity.extend({
  configuration, configurationHash: hash, source: credentialSource,
  credentialCiphertext: z.string().min(1).max(32000),
}).strict();
export type TranslationCredential = z.infer<typeof translationCredentialSchema>;

export class TranslationCredentialError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function configurationHash(value: z.infer<typeof configuration>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// Prepare only after resolving an authorized workspace's selected key. The
// encrypted envelope belongs to one request and recipe, not the current ambient
// integration context. Persist it privately with that request, never in a public
// receipt. A worker must still recheck scope and claim/reserve the attempt.
export function prepareTranslationCredential(args: {
  workspaceId: string; requestId: string; credentialId: string;
  modelId: string; source: "workspace" | "env"; apiKey: string;
}): TranslationCredential {
  try {
    const scope = identity.parse({ workspaceId: args.workspaceId, requestId: args.requestId, credentialId: args.credentialId });
    const config = configuration.parse({ provider: "anthropic", modelId: args.modelId, recipeVersion: 1 });
    const source = credentialSource.parse(args.source);
    const configHash = configurationHash(config);
    const credentialCiphertext = encryptIntegrationKey(JSON.stringify({
      version: 1, ...scope, configurationHash: configHash, source, apiKey: key.parse(args.apiKey),
    }));
    return { ...scope, configuration: config, configurationHash: configHash, source, credentialCiphertext };
  } catch { throw new TranslationCredentialError("translation_credential_not_stored"); }
}

// Decryption failure or replacement of an identity/configuration is a refusal.
// Never resolve an environment key or a newer workspace key here.
export function openTranslationCredential(raw: unknown): string {
  try {
    const stored = translationCredentialSchema.parse(raw);
    if (configurationHash(stored.configuration) !== stored.configurationHash) throw new Error();
    const plaintext = decryptIntegrationKey(stored.credentialCiphertext);
    if (plaintext === null) throw new Error();
    const value = envelope.parse(JSON.parse(plaintext));
    if (value.workspaceId !== stored.workspaceId || value.requestId !== stored.requestId ||
      value.credentialId !== stored.credentialId || value.configurationHash !== stored.configurationHash ||
      value.source !== stored.source) throw new Error();
    return value.apiKey;
  } catch { throw new TranslationCredentialError("translation_credential_unavailable"); }
}
