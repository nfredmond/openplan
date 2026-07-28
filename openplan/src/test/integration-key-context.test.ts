import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentIntegrationKeyWorkspaceId,
  loadWorkspaceIntegrationKeys,
  runWithWorkspaceIntegrationKeys,
  workspaceIntegrationKey,
} from "@/lib/integrations/context";
import { encryptIntegrationKey } from "@/lib/integrations/key-crypto";
import { censusApiKey } from "@/lib/data-sources/census-api-key";
import type { IntegrationProviderId } from "@/lib/integrations/providers";

afterEach(() => {
  vi.unstubAllEnvs();
});

function keys(entries: Array<[IntegrationProviderId, string]>) {
  return new Map<IntegrationProviderId, string>(entries);
}

describe("workspace integration context", () => {
  it("exposes keys inside the scope and nothing outside it", async () => {
    expect(workspaceIntegrationKey("census")).toBeNull();
    expect(currentIntegrationKeyWorkspaceId()).toBeNull();

    await runWithWorkspaceIntegrationKeys("ws-1", keys([["census", "ws-census-key"]]), async () => {
      expect(workspaceIntegrationKey("census")).toBe("ws-census-key");
      expect(workspaceIntegrationKey("anthropic")).toBeNull();
      expect(currentIntegrationKeyWorkspaceId()).toBe("ws-1");
    });

    expect(workspaceIntegrationKey("census")).toBeNull();
    expect(currentIntegrationKeyWorkspaceId()).toBeNull();
  });

  it("censusApiKey honors the workspace override, then the env", async () => {
    vi.stubEnv("CENSUS_API_KEY", "env-census-key");
    expect(censusApiKey()).toBe("env-census-key");

    await runWithWorkspaceIntegrationKeys("ws-1", keys([["census", "ws-census-key"]]), async () => {
      expect(censusApiKey()).toBe("ws-census-key");
    });

    // Back outside the scope, the env read is untouched.
    expect(censusApiKey()).toBe("env-census-key");

    // A scope WITHOUT a census key falls through to the env, not to null.
    await runWithWorkspaceIntegrationKeys("ws-1", keys([]), async () => {
      expect(censusApiKey()).toBe("env-census-key");
    });
  });
});

describe("loadWorkspaceIntegrationKeys", () => {
  function clientWithRows(rows: unknown, error: { message: string } | null = null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: rows, error }),
        }),
      }),
    };
  }

  it("decrypts stored rows and silently skips ones that no longer decrypt", async () => {
    vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "unit-test-operator-secret-0123456789");
    const rows = [
      { provider: "census", key_ciphertext: encryptIntegrationKey("ws-census-key") },
      { provider: "anthropic", key_ciphertext: "v1:not:really:ciphertext" },
      { provider: "census", key_ciphertext: 42 }, // malformed row shape
    ];

    const loaded = await loadWorkspaceIntegrationKeys(clientWithRows(rows), "ws-1");
    expect(loaded.get("census")).toBe("ws-census-key");
    expect(loaded.has("anthropic")).toBe(false);
  });

  it("returns an empty map on query error or empty workspace id", async () => {
    const errored = await loadWorkspaceIntegrationKeys(
      clientWithRows(null, { message: "boom" }),
      "ws-1"
    );
    expect(errored.size).toBe(0);

    const noWorkspace = await loadWorkspaceIntegrationKeys(clientWithRows([]), "");
    expect(noWorkspace.size).toBe(0);
  });
});
