// Only launch construction is replaced. The provider, session and JSON frames run.
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("../../../workers/planner_agent_connector/codex-launch.mjs", () => ({
  codexLaunch: async () => ({ command: process.execPath,
    args: [resolve(process.cwd(), "../workers/planner_agent_connector/test/usage-limit-frames.mjs")],
    options: { stdio: ["pipe", "pipe", "pipe"], env: {} } }),
  codexThreadParams: (value: unknown) => value, codexTurnParams: (value: unknown) => value,
}));
import { runCodexProjectTurn } from "../../../workers/planner_agent_connector/codex-provider.mjs";

it("real Codex adapter reads this attempt's snapshot before its sole turn and returns a safe structured limit", async () => {
  await expect(runCodexProjectTurn({ model: "synthetic", expectedAuthMode: "chatgpt", instructions: "Synthetic", prompt: "Synthetic", outputSchema: {} }))
    .rejects.toMatchObject({ code: "native_usage_limit", usageLimit: { code: "usageLimitExceeded", resetAtUnixSeconds: 1800000600,
      resetSource: "account_rate_limits", nativeThreadId: "synthetic-thread", nativeTurnId: "synthetic-turn" } });
});
