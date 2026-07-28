import { afterEach, describe, expect, it, vi } from "vitest";

import {
  anthropicApiKey,
  anthropicKeySource,
  anthropicModel,
  hasAnthropicAccess,
} from "@/lib/integrations/anthropic-access";
import { runWithWorkspaceIntegrationKeys } from "@/lib/integrations/context";
import { decryptIntegrationKey } from "@/lib/integrations/key-crypto";
import { storeWorkspaceIntegrationKey } from "@/lib/integrations/workspace-keys";
import type { IntegrationProviderId } from "@/lib/integrations/providers";

const createAnthropicMock = vi.hoisted(() => vi.fn());

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  createAnthropicMock.mockReset();
});

function keys(entries: Array<[IntegrationProviderId, string]>) {
  return new Map<IntegrationProviderId, string>(entries);
}

/**
 * The headline Wave 2 behavior: a workspace's OWN Anthropic key counts as AI
 * access and is the key actually handed to the SDK — with the deployment env
 * untouched, absent, or different.
 */
describe("anthropic access via workspace keys", () => {
  it("counts a workspace key as access when the deployment env has none", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(hasAnthropicAccess()).toBe(false);
    expect(anthropicKeySource()).toBeNull();

    await runWithWorkspaceIntegrationKeys("ws-1", keys([["anthropic", "sk-workspace-key"]]), async () => {
      expect(hasAnthropicAccess()).toBe(true);
      expect(anthropicApiKey()).toBe("sk-workspace-key");
      expect(anthropicKeySource()).toBe("workspace");
    });

    expect(hasAnthropicAccess()).toBe(false);
  });

  it("constructs the model with the workspace key, overriding the env key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment-env-key");
    const modelFactory = vi.fn().mockReturnValue({ modelId: "claude-test" });
    createAnthropicMock.mockReturnValue(modelFactory);

    await runWithWorkspaceIntegrationKeys("ws-1", keys([["anthropic", "sk-workspace-key"]]), async () => {
      anthropicModel("claude-test");
    });

    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-workspace-key" });
    expect(modelFactory).toHaveBeenCalledWith("claude-test");
  });

  it("falls back to the deployment env key outside any workspace scope", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-deployment-env-key");
    const modelFactory = vi.fn().mockReturnValue({ modelId: "claude-test" });
    createAnthropicMock.mockReturnValue(modelFactory);

    expect(anthropicKeySource()).toBe("env");
    anthropicModel("claude-test");

    expect(createAnthropicMock).toHaveBeenCalledWith({ apiKey: "sk-deployment-env-key" });
  });

  it("treats a whitespace-only env key as absent", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "   ");
    expect(hasAnthropicAccess()).toBe(false);
    expect(() => anthropicModel("claude-test")).toThrow(/No Anthropic API key/);
  });
});

/**
 * Encrypt-at-rest is a stored fact, not a mock's promise: what the upsert
 * writes must be real v1 ciphertext that round-trips, never the plaintext.
 */
describe("storeWorkspaceIntegrationKey encrypts at rest", () => {
  it("upserts ciphertext (not plaintext) that decrypts back, with last4 only", async () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "an-operator-secret-of-plenty-of-length");

    let upserted: Record<string, unknown> | null = null;
    const client = {
      from: () => ({
        upsert: (row: Record<string, unknown>) => {
          upserted = row;
          return {
            select: () => ({
              single: async () => ({
                data: {
                  provider: row.provider,
                  key_last4: row.key_last4,
                  configured_by: row.configured_by,
                  updated_at: row.updated_at,
                },
                error: null,
              }),
            }),
          };
        },
      }),
    };

    const stored = await storeWorkspaceIntegrationKey({
      workspaceId: "ws-1",
      provider: "anthropic",
      plaintextKey: "sk-live-example-1234",
      configuredBy: "user-1",
      client: client as never,
    });

    expect(upserted).not.toBeNull();
    const row = upserted as unknown as Record<string, unknown>;
    expect(String(row.key_ciphertext)).not.toContain("sk-live-example-1234");
    expect(String(row.key_ciphertext).startsWith("v")).toBe(true);
    expect(decryptIntegrationKey(String(row.key_ciphertext))).toBe("sk-live-example-1234");
    expect(row.key_last4).toBe("1234");
    expect(stored.keyLast4).toBe("1234");
  });
});
