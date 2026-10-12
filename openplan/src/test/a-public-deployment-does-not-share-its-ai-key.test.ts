// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: () => { throw new Error("Synthetic unavailable service"); } }));

import { anthropicApiKey, anthropicKeySource, hasAnthropicAccess } from "@/lib/integrations/anthropic-access";
import { runWithWorkspaceIntegrationKeys } from "@/lib/integrations/context";
import { deploymentEnvKey } from "@/lib/integrations/deployment-env";
import { integrationProvider } from "@/lib/integrations/providers";
import { sharedAnthropicApiKey, sharedAnthropicKeyWithheld } from "@/lib/integrations/shared-ai-key";
import { openTranslationCredential } from "@/lib/integrations/translation-credentials";
import { prepareWorkspaceTranslationCredential } from "@/lib/integrations/workspace-keys";

/*
 * The hosted installation has open public signup. If its operator ever sets
 * ANTHROPIC_API_KEY, every stranger's workspace, and every public engagement
 * portal, would bill that key without notice. A production build therefore
 * shares the deployment key only when OPENPLAN_SHARED_AI_KEY=allow is set.
 * Each case flips one binding (build mode, flag, workspace key) so a path that
 * ignores the guard fails here.
 */

const DEPLOYMENT_KEY = "SYNTHETIC-DEPLOYMENT-KEY";

beforeEach(() => {
  vi.stubEnv("OPENPLAN_INTEGRATION_KEY_SECRET", "SYNTHETIC-SHARED-KEY-SECRET-0123456789");
  vi.stubEnv("ANTHROPIC_API_KEY", DEPLOYMENT_KEY);
  vi.stubEnv("OPENPLAN_SHARED_AI_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

function emptyWorkspaceKeyRead() {
  const eq = vi.fn();
  eq.mockReturnValueOnce({ eq }).mockResolvedValueOnce({ data: [], error: null });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from } as unknown as NonNullable<Parameters<typeof prepareWorkspaceTranslationCredential>[0]["client"]>;
}

function translationScope() {
  return { workspaceId: randomUUID(), requestId: randomUUID(), credentialId: randomUUID(), modelId: "synthetic-model" };
}

describe("the deployment Anthropic key rule", () => {
  it.each([
    ["development", "", DEPLOYMENT_KEY],
    ["test", "", DEPLOYMENT_KEY],
    ["production", "", null],
    ["production", "yes", null],
    ["production", "ALLOW", null],
    ["production", "allow", DEPLOYMENT_KEY],
    ["production", " allow ", DEPLOYMENT_KEY],
  ])("NODE_ENV=%s with OPENPLAN_SHARED_AI_KEY=%j shares %j", (nodeEnv, flag, expected) => {
    const env = { NODE_ENV: nodeEnv, ANTHROPIC_API_KEY: DEPLOYMENT_KEY, OPENPLAN_SHARED_AI_KEY: flag };
    expect(sharedAnthropicApiKey(env)).toBe(expected);
    expect(sharedAnthropicKeyWithheld(env)).toBe(expected === null);
  });

  it("has nothing to share or withhold when no deployment key is set", () => {
    const env = { NODE_ENV: "production", ANTHROPIC_API_KEY: "  ", OPENPLAN_SHARED_AI_KEY: "allow" };
    expect(sharedAnthropicApiKey(env)).toBeNull();
    expect(sharedAnthropicKeyWithheld(env)).toBe(false);
  });
});

describe("every Anthropic reader follows the rule in a production build", () => {
  it("withholds the deployment key from a keyless workspace unless the operator allows it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(anthropicApiKey()).toBeNull();
    expect(hasAnthropicAccess()).toBe(false);
    expect(anthropicKeySource()).toBeNull();
    expect(deploymentEnvKey(integrationProvider("anthropic")!)).toBeNull();

    vi.stubEnv("OPENPLAN_SHARED_AI_KEY", "allow");
    expect(anthropicApiKey()).toBe(DEPLOYMENT_KEY);
    expect(anthropicKeySource()).toBe("env");
    expect(deploymentEnvKey(integrationProvider("anthropic")!)).toBe(DEPLOYMENT_KEY);
  });

  it("still uses a workspace's own key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const keys = new Map([["anthropic", "SYNTHETIC-WORKSPACE-KEY"]] as const);
    await runWithWorkspaceIntegrationKeys(randomUUID(), keys, () => {
      expect(anthropicApiKey()).toBe("SYNTHETIC-WORKSPACE-KEY");
      expect(anthropicKeySource()).toBe("workspace");
    });
  });

  it("leaves other providers' deployment keys alone", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CENSUS_API_KEY", "SYNTHETIC-CENSUS-KEY");
    expect(deploymentEnvKey(integrationProvider("census")!)).toBe("SYNTHETIC-CENSUS-KEY");
  });

  it("refuses public-portal translation for a keyless workspace instead of billing the deployment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(
      prepareWorkspaceTranslationCredential({ ...translationScope(), client: emptyWorkspaceKeyRead() })
    ).rejects.toThrow("translation_credential_unavailable");

    vi.stubEnv("OPENPLAN_SHARED_AI_KEY", "allow");
    const stored = await prepareWorkspaceTranslationCredential({ ...translationScope(), client: emptyWorkspaceKeyRead() });
    expect(stored.source).toBe("env");
    expect(openTranslationCredential(stored)).toBe(DEPLOYMENT_KEY);
  });
});
