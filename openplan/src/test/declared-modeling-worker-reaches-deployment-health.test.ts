import { describe, expect, it } from "vitest";

import { evaluateDeploymentHealth } from "@/lib/config/deployment-health";
import {
  isCountyOnrampWorkerConfigured,
  loadModelingWorkerFacts,
  parseModelingWorkerDeclaration,
  resolveModelingWorkerDeclaration,
} from "@/lib/config/deployment-health-facts";

/** `NodeJS.ProcessEnv` demands NODE_ENV; these readers only ever read strings. */
const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;

/**
 * The AequilibraE worker is a poller, so nothing can be probed and the only
 * thing knowable before the first run is what the operator has said. These
 * cover the reading of that declaration and the one guarantee that matters
 * around it: a deployment's own statement about itself must survive everything
 * else going wrong, and must reach the surface where an operator can correct it.
 */
describe("reading a deployment's modeling-worker declaration", () => {
  it("treats silence as nothing said — never as a deployment with no worker", () => {
    // The stake: every deployment that already runs a worker has never set this
    // variable. Reading unset as "absent" would refuse launches that work today,
    // from no evidence whatsoever.
    expect(resolveModelingWorkerDeclaration(env())).toBe("undeclared");
    expect(resolveModelingWorkerDeclaration(env({ OPENPLAN_MODELING_WORKER: "   " }))).toBe("undeclared");
  });

  it("accepts both canonical answers, and the spellings people actually type", () => {
    for (const raw of ["deployed", "DEPLOYED", " Running ", "true", "yes", "1", "on"]) {
      expect(parseModelingWorkerDeclaration(raw)).toBe("deployed");
    }
    for (const raw of ["absent", "ABSENT", " none ", "false", "no", "0", "off"]) {
      expect(parseModelingWorkerDeclaration(raw)).toBe("absent");
    }
  });

  it("reports a value it does not understand rather than guessing either answer", () => {
    // A guessed declaration is a trusted one, which makes it worse than none.
    expect(parseModelingWorkerDeclaration("depoyed")).toBe("unrecognized");
    expect(parseModelingWorkerDeclaration("maybe")).toBe("unrecognized");
  });

  it("is read from an unprefixed variable, so a changed answer needs no rebuild", () => {
    // A NEXT_PUBLIC_ name would be inlined at build time: an operator who
    // deployed a worker and updated the declaration would keep being refused
    // until they rebuilt — a fresh way for the product to be confidently wrong.
    expect(resolveModelingWorkerDeclaration(env({ OPENPLAN_MODELING_WORKER: "deployed" }))).toBe(
      "deployed"
    );
    expect(
      resolveModelingWorkerDeclaration(env({ NEXT_PUBLIC_OPENPLAN_MODELING_WORKER: "deployed" }))
    ).toBe("undeclared");
  });
});

describe("the declaration reaching the dashboard's deployment health", () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";

  function clientReturning(result: { data: unknown; error: { message: string } | null }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({ in: () => Promise.resolve(result) }),
        }),
      }),
    } as unknown as Parameters<typeof loadModelingWorkerFacts>[0];
  }

  it("carries what the deployment declares alongside what its runs show", async () => {
    const facts = await loadModelingWorkerFacts(
      clientReturning({ data: [], error: null }),
      workspaceId,
      Date.now(),
      env({ OPENPLAN_MODELING_WORKER: "absent" })
    );

    expect(facts).toEqual({ declaration: "absent", nonTerminalRunCount: 0, stalledRunCount: 0 });
  });

  it("keeps the declaration when the run query fails", async () => {
    // A database problem must not be allowed to say something about the
    // deployment's configuration. Losing it here would silently downgrade an
    // explicit "absent" to "nobody said", which is a different — and false —
    // statement, and would put the retrospective refusal back.
    const facts = await loadModelingWorkerFacts(
      clientReturning({ data: null, error: { message: "relation does not exist" } }),
      workspaceId,
      Date.now(),
      env({ OPENPLAN_MODELING_WORKER: "absent" })
    );

    expect(facts.declaration).toBe("absent");
    expect(facts.stalledRunCount).toBe(0);
  });

  it("keeps the declaration for a caller with no workspace at all", async () => {
    const facts = await loadModelingWorkerFacts(
      clientReturning({ data: [], error: null }),
      "",
      0,
      env({ OPENPLAN_MODELING_WORKER: "deployed" })
    );

    expect(facts.declaration).toBe("deployed");
  });

  it("shows the operator what the product believes, so they can correct it", async () => {
    const modelingWorker = await loadModelingWorkerFacts(
      clientReturning({ data: [], error: null }),
      workspaceId,
      Date.now(),
      env({ OPENPLAN_MODELING_WORKER: "nonsense" })
    );

    const health = evaluateDeploymentHealth({
      mapbox: { hasValidToken: true, hasInvalidToken: false },
      censusApiKeyPresent: true,
      anthropicApiKeyPresent: true,
      pdfRendering: { browserEngineAvailable: true },
      modelingWorker,
    });

    const check = health.problems.find((problem) => problem.key === "modeling-worker");
    expect(check?.status).toBe("warn");
    expect(check?.detail).toMatch(/does not understand/i);
    expect(check?.remedy).toMatch(/OPENPLAN_MODELING_WORKER/);
  });
});

/**
 * The county onramp worker already declares itself through configuration; what
 * was missing was any surface reading that declaration before a job was
 * prepared. This is the shared reader, and it must stay in step with
 * `dispatchCountyOnrampJob` — the URL alone decides there, because that is the
 * branch that returns `deliveryMode: "prepared"` without making any request.
 */
describe("reading the county onramp worker declaration", () => {
  it("counts a deployment with a worker URL as able to submit jobs", () => {
    expect(
      isCountyOnrampWorkerConfigured(env({ OPENPLAN_COUNTY_ONRAMP_WORKER_URL: "https://worker.example" }))
    ).toBe(true);
  });

  it("counts a deployment with no worker URL as preparing handoffs only", () => {
    expect(isCountyOnrampWorkerConfigured(env())).toBe(false);
    expect(isCountyOnrampWorkerConfigured(env({ OPENPLAN_COUNTY_ONRAMP_WORKER_URL: "  " }))).toBe(false);
  });

  it("does not require the token the dispatcher treats as optional", () => {
    // If this diverged from the dispatcher, the launch control would promise
    // something the dispatcher does not do — in either direction.
    expect(
      isCountyOnrampWorkerConfigured(
        env({
          OPENPLAN_COUNTY_ONRAMP_WORKER_URL: "https://worker.example",
          OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN: "",
        })
      )
    ).toBe(true);
  });
});
