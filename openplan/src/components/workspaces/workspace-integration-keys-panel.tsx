"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Guided setup for the external services OpenPlan calls — one row per
 * registered provider, rendered entirely from the API payload
 * (`/api/workspaces/integration-keys`, backed by the registry in
 * src/lib/integrations/providers.ts) so adding a provider needs no UI change.
 *
 * Honesty rules inherited from the subsystem:
 *   - A key is stored only after the server probes it live. A probe refusal
 *     (422) is shown verbatim and nothing is saved — the panel never claims a
 *     key works when the provider just said otherwise.
 *   - When the deployment cannot encrypt (no OPENPLAN_INTEGRATION_KEY_SECRET),
 *     the paste input is withheld and the panel says exactly why, instead of
 *     offering a save that would fail.
 *   - Providers whose keys cannot take effect at runtime (build-time browser
 *     tokens) get no input at all — only env instructions and a live check of
 *     the key this deployment is actually using.
 */

type StoredKeyMeta = {
  keyLast4: string;
  updatedAt: string | null;
  /**
   * Whether the stored ciphertext still decrypts under the deployment's
   * CURRENT secret. False after an OPENPLAN_INTEGRATION_KEY_SECRET rotation —
   * the row exists but requests are falling back to the deployment env key,
   * and the panel must say so instead of claiming workspace-key billing.
   */
  decryptable?: boolean;
};

type ProviderStatus = {
  id: string;
  label: string;
  purpose: string;
  keySignupUrl: string;
  envVar: string;
  workspaceConfigurable: boolean;
  workspaceConfigurableNote?: string;
  envKeyPresent: boolean;
  storedKey: StoredKeyMeta | null;
};

type RowMessage = {
  tone: "notice" | "error";
  text: string;
};

type WorkspaceIntegrationKeysPanelProps = {
  workspaceId: string;
  /** Only owners and admins may manage keys; the API enforces this too. */
  canManage: boolean;
};

export function WorkspaceIntegrationKeysPanel({
  workspaceId,
  canManage,
}: WorkspaceIntegrationKeysPanelProps) {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, RowMessage | null>>({});

  const setMessage = useCallback((providerId: string, message: RowMessage | null) => {
    setMessages((current) => ({ ...current, [providerId]: message }));
  }, []);

  const load = useCallback(async () => {
    if (!canManage || !workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/workspaces/integration-keys?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to load integration keys");
      setProviders(Array.isArray(body.providers) ? (body.providers as ProviderStatus[]) : []);
      setStorageAvailable(body.storageAvailable === true);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load integration keys");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveKey(provider: ProviderStatus, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const key = (keyInputs[provider.id] ?? "").trim();
    if (!key) return;
    setWorking(provider.id);
    setMessage(provider.id, null);
    try {
      const res = await fetch("/api/workspaces/integration-keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, provider: provider.id, key }),
      });
      const body = await res.json().catch(() => ({}));
      // A 422 means the live probe refused the key and the server did NOT
      // store it; the server's refusal copy is shown verbatim.
      if (!res.ok) throw new Error(body.error ?? "Could not save the key");
      const stored = (body.storedKey ?? null) as StoredKeyMeta | null;
      setProviders((current) =>
        current.map((row) => (row.id === provider.id ? { ...row, storedKey: stored } : row)),
      );
      setKeyInputs((current) => ({ ...current, [provider.id]: "" }));
      setMessage(provider.id, {
        tone: "notice",
        text: typeof body.detail === "string" ? body.detail : "Key verified and saved.",
      });
    } catch (saveError) {
      setMessage(provider.id, {
        tone: "error",
        text: saveError instanceof Error ? saveError.message : "Could not save the key",
      });
    } finally {
      setWorking(null);
    }
  }

  async function removeKey(provider: ProviderStatus) {
    const fallback = provider.envKeyPresent
      ? `OpenPlan will fall back to this deployment's ${provider.envVar}.`
      : `This deployment has no ${provider.envVar} either, so these features become unavailable or degraded.`;
    if (!window.confirm(`Remove the workspace ${provider.label} key? ${fallback}`)) return;
    setWorking(provider.id);
    setMessage(provider.id, null);
    try {
      const res = await fetch("/api/workspaces/integration-keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, provider: provider.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not remove the key");
      setProviders((current) =>
        current.map((row) => (row.id === provider.id ? { ...row, storedKey: null } : row)),
      );
      setMessage(provider.id, { tone: "notice", text: `Workspace key removed. ${fallback}` });
    } catch (removeError) {
      setMessage(provider.id, {
        tone: "error",
        text: removeError instanceof Error ? removeError.message : "Could not remove the key",
      });
    } finally {
      setWorking(null);
    }
  }

  async function validateDeploymentKey(provider: ProviderStatus) {
    setWorking(provider.id);
    setMessage(provider.id, null);
    try {
      const res = await fetch("/api/workspaces/integration-keys/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId, provider: provider.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not check the key");
      const sourceLabel =
        body.source === "workspace"
          ? "workspace key"
          : body.source === "env"
            ? "deployment env key"
            : "no key configured";
      const detail =
        typeof body.detail === "string"
          ? body.detail
          : body.ok
            ? "The key works."
            : "The key check failed.";
      setMessage(provider.id, {
        tone: body.ok ? "notice" : "error",
        text: `${detail} (${sourceLabel})`,
      });
    } catch (validateError) {
      setMessage(provider.id, {
        tone: "error",
        text: validateError instanceof Error ? validateError.message : "Could not check the key",
      });
    } finally {
      setWorking(null);
    }
  }

  if (!canManage) return null;

  const configuredCount = providers.filter(
    (provider) => provider.storedKey !== null || provider.envKeyPresent,
  ).length;

  function statusLine(provider: ProviderStatus) {
    if (provider.storedKey) {
      // Rotation honesty: the row exists but no longer decrypts under the
      // deployment's current secret, so the workspace key is NOT in effect.
      if (provider.storedKey.decryptable === false) {
        return (
          <div className="mt-2 text-sm text-amber-800 dark:text-amber-200" role="status">
            <p>
              <span className="font-medium">
                Stored workspace key ••••{provider.storedKey.keyLast4} can no longer be read
              </span>{" "}
              — this deployment&apos;s{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                OPENPLAN_INTEGRATION_KEY_SECRET
              </code>{" "}
              has changed since it was saved.
            </p>
            <p className="mt-1">
              {provider.envKeyPresent ? (
                <>
                  Requests are using this deployment&apos;s{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{provider.envVar}</code>{" "}
                  instead. Re-enter the workspace key below to restore it.
                </>
              ) : (
                <>
                  This deployment has no{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">{provider.envVar}</code>{" "}
                  either, so these features are unavailable or degraded until the key is re-entered
                  below.
                </>
              )}
            </p>
          </div>
        );
      }
      const saved = provider.storedKey.updatedAt
        ? ` · saved ${new Date(provider.storedKey.updatedAt).toLocaleDateString()}`
        : "";
      return (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            Workspace key ••••{provider.storedKey.keyLast4}
          </span>
          {saved}
        </p>
      );
    }
    if (provider.envKeyPresent) {
      return (
        <p className="mt-2 text-sm text-muted-foreground">
          Using this deployment&apos;s{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{provider.envVar}</code>
        </p>
      );
    }
    return (
      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
        Not configured — {provider.label} features will be unavailable or degraded.
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-border/70 p-5" aria-label="Integration keys">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Integration keys</h2>
        <p className="text-xs text-muted-foreground">
          {loading || providers.length === 0
            ? ""
            : `${configuredCount} of ${providers.length} configured`}
        </p>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        The external services OpenPlan calls. Each runs on this deployment&apos;s environment key
        or, where supported, on a key this workspace brings itself.
      </p>

      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading integration keys…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : providers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No integration providers are registered for this deployment.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {providers.map((provider) => {
            const message = messages[provider.id] ?? null;
            return (
              <li key={provider.id} className="py-4 first:pt-2 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-foreground">{provider.label}</h3>
                  <a
                    href={provider.keySignupUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Where to get a key
                  </a>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">{provider.purpose}</p>

                {statusLine(provider)}

                {/* Your-key-your-spend disclosure: with a stored workspace key,
                    the workspace's own provider account carries the AI usage —
                    staff features AND the public engagement portal (visitor
                    translation runs on the same key). Suppressed when the key
                    no longer decrypts, because then it is not what's billed. */}
                {provider.id === "anthropic" &&
                provider.storedKey &&
                provider.storedKey.decryptable !== false ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    AI usage from this workspace — including its public engagement portal — bills
                    this workspace&apos;s own Anthropic account.
                  </p>
                ) : null}

                {provider.workspaceConfigurable ? (
                  storageAvailable ? (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-2"
                      onSubmit={(e) => void saveKey(provider, e)}
                    >
                      <div className="min-w-56 flex-1 space-y-1">
                        <label
                          htmlFor={`integration-key-${provider.id}`}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {provider.storedKey ? "Replace workspace key" : "Workspace key"}
                        </label>
                        <Input
                          id={`integration-key-${provider.id}`}
                          type="password"
                          autoComplete="off"
                          placeholder="Paste an API key"
                          value={keyInputs[provider.id] ?? ""}
                          onChange={(e) =>
                            setKeyInputs((current) => ({
                              ...current,
                              [provider.id]: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={working !== null || !(keyInputs[provider.id] ?? "").trim()}
                      >
                        {working === provider.id ? "Validating…" : "Validate & save"}
                      </Button>
                      {provider.storedKey ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={working !== null}
                          onClick={() => void removeKey(provider)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </form>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Per-workspace keys are unavailable on this deployment: its operator has not
                      set{" "}
                      <code className="rounded bg-muted px-1 py-0.5">
                        OPENPLAN_INTEGRATION_KEY_SECRET
                      </code>
                      . Until that is configured, set{" "}
                      <code className="rounded bg-muted px-1 py-0.5">{provider.envVar}</code> as a
                      deployment environment variable instead.
                    </p>
                  )
                ) : (
                  <div className="mt-2">
                    {provider.workspaceConfigurableNote ? (
                      <p className="text-xs text-muted-foreground">
                        {provider.workspaceConfigurableNote}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Deployment environment variable:{" "}
                      <code className="rounded bg-muted px-1 py-0.5">{provider.envVar}</code>
                    </p>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={working !== null}
                        onClick={() => void validateDeploymentKey(provider)}
                      >
                        {working === provider.id ? "Checking…" : "Validate deployment key"}
                      </Button>
                    </div>
                  </div>
                )}

                {message ? (
                  message.tone === "error" ? (
                    <p className="mt-2 text-sm text-destructive" role="alert">
                      {message.text}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">{message.text}</p>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
