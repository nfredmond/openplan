import { describe, expect, it, vi } from "vitest";
import {
  buildCommandPlan,
  parseArgs,
  runBuyerDemoPreflight,
} from "../../scripts/ops/check-buyer-demo-preflight.mjs";

describe("buyer demo preflight script", () => {
  it("defaults to local-first read-only checks and skips live reads", () => {
    vi.stubEnv("OPENPLAN_BUYER_DEMO_PREFLIGHT_LIVE_READS", "");
    const args = parseArgs([]);
    const plan = buildCommandPlan(args);

    expect(args).toMatchObject({ help: false, liveReads: false });
    expect(plan).toEqual([
      {
        label: "Sales proof / current buyer packet claim boundaries",
        command: "npm",
        args: ["run", "test:sales-proof-claim-boundaries"],
      },
      {
        label: "Nevada County fixture buyer-safe guards",
        command: "npm",
        args: ["test", "--", "--run", "src/test/nevada-county-example-fixture.test.ts"],
      },
      {
        label: "Buyer demo talk-track boundary guard",
        command: "npm",
        args: ["test", "--", "--run", "src/test/buyer-demo-talk-track.test.ts"],
      },
      {
        label: "Pilot preflight posture, local/read-only only (live reads skipped)",
        command: "npm",
        args: ["run", "ops:check-pilot-preflight", "--", "--skip-health", "--skip-vercel"],
        allowSkippedLiveReadAttention: true,
      },
    ]);

    vi.unstubAllEnvs();
  });

  it("enables opt-in read-only live health and deployment reads", () => {
    expect(parseArgs(["--live-reads"])).toMatchObject({ liveReads: true });
    const plan = buildCommandPlan({ liveReads: true });
    expect(plan[3]).toMatchObject({
      label: "Pilot preflight posture with opt-in read-only live health/deployment reads",
      command: "npm",
      args: ["run", "ops:check-pilot-preflight", "--"],
      allowSkippedLiveReadAttention: false,
    });
    expect(plan[4]).toMatchObject({
      label: "Public demo preflight with examples/readiness checks",
      command: "npm",
      args: ["run", "ops:check-public-demo-preflight"],
    });
  });

  it("honors the live-read environment flag", () => {
    vi.stubEnv("OPENPLAN_BUYER_DEMO_PREFLIGHT_LIVE_READS", "1");
    expect(parseArgs([])).toMatchObject({ liveReads: true });
    vi.unstubAllEnvs();
  });

  it("fails closed on unknown arguments", () => {
    expect(() => parseArgs(["--write-evidence"])).toThrow("Unknown argument: --write-evidence");
  });

  it("runs steps in order and stops at the first failure", async () => {
    const calls: string[] = [];
    const code = await runBuyerDemoPreflight(
      { liveReads: false },
      {
        plan: [
          { label: "first", command: "npm", args: ["run", "first"] },
          { label: "second", command: "npm", args: ["run", "second"] },
          { label: "third", command: "npm", args: ["run", "third"] },
        ],
        runStep: async (step: { label: string }) => {
          calls.push(step.label);
          return step.label === "second" ? 1 : 0;
        },
        cwd: "/tmp/openplan-fixture",
      },
    );

    expect(code).toBe(1);
    expect(calls).toEqual(["first", "second"]);
  });

  it("returns success when all bundled checks pass", async () => {
    const code = await runBuyerDemoPreflight(
      { liveReads: false },
      {
        plan: [{ label: "only", command: "npm", args: ["run", "only"] }],
        runStep: async () => 0,
      },
    );

    expect(code).toBe(0);
  });
});
