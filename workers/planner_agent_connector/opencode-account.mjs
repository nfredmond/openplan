export class OpenCodeAccountError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// The native auth list substitutes display names for provider IDs, and its
// model list works without credentials. Neither establishes an account mode.
// Project only the exact native auth record; never return keys or raw metadata.
// A connected result means locally configured, not tested provider access.
export function openCodeAccountSummary(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OpenCodeAccountError("native_account_unreadable");
  if (!Object.hasOwn(raw, "openai")) return { status: "needs_login", authMode: null, planType: null };
  const account = raw.openai;
  if (!account || typeof account !== "object" || Array.isArray(account)) throw new OpenCodeAccountError("native_account_unreadable");
  if (account.type !== "api") return { status: "unsupported_auth_mode", authMode: null, planType: null };
  if (typeof account.key !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(account.key)) throw new OpenCodeAccountError("native_account_unreadable");
  if (account.metadata !== undefined && (!account.metadata || typeof account.metadata !== "object" ||
    Array.isArray(account.metadata) || Object.values(account.metadata).some(value => typeof value !== "string"))) {
    throw new OpenCodeAccountError("native_account_unreadable");
  }
  return { status: "connected", authMode: "opencode_api", planType: null };
}

// Parse only the pinned native `models openai` plain output. Do not infer
// provider access or a default model from catalog order or model names.
export function openCodeModelCatalog(stdout) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 100_000) throw new OpenCodeAccountError("native_models_unreadable");
  const lines = stdout.trim().split(/\r?\n/);
  if (!stdout.trim() || lines.length > 1000) throw new OpenCodeAccountError("native_models_unreadable");
  const models = [], seen = new Set();
  for (const line of lines) {
    const match = /^openai\/([a-zA-Z0-9][a-zA-Z0-9._:-]{0,139})$/.exec(line);
    if (!match || seen.has(match[1])) throw new OpenCodeAccountError("native_models_unreadable");
    seen.add(match[1]);
    models.push({ id: match[1], label: match[1], isDefault: false });
  }
  return models;
}
