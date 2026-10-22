// Only launch construction is replaced. The provider, session and JSON frames run.
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ bucketMode: "default" }));
vi.mock("../../../workers/planner_agent_connector/codex-launch.mjs", () => ({
  codexLaunch: async () => ({ command: process.execPath,
    args: [resolve(process.cwd(), "../workers/planner_agent_connector/test/usage-limit-frames.mjs"), "usageLimitExceeded", fixture.bucketMode],
    options: { stdio: ["pipe", "pipe", "pipe"], env: {} } }),
  codexThreadParams: (value: unknown) => value, codexTurnParams: (value: unknown) => value,
}));
import { runCodexProjectTurn } from "../../../workers/planner_agent_connector/codex-provider.mjs";

it.each(["default", "later-other-known", "later-other-unknown", "initial-multi-known", "initial-multi-unknown"])("real Codex adapter leaves an unbound failure reset unknown for %s", async bucketMode => {
  fixture.bucketMode = bucketMode;
  await expect(runCodexProjectTurn({ model: "synthetic", expectedAuthMode: "chatgpt", instructions: "Synthetic", prompt: "Synthetic", outputSchema: {} }))
    .rejects.toMatchObject({ code: "native_usage_limit", usageLimit: { code: "usageLimitExceeded", resetAtUnixSeconds: null,
      resetSource: null, nativeThreadId: "synthetic-thread", nativeTurnId: "synthetic-turn" } });
});
