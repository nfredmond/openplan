import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDeploymentHealth,
  type DeploymentHealthFacts,
} from "@/lib/config/deployment-health";

/**
 * A fully configured deployment. The worker declaration is part of "fully
 * configured" now: a deployment that has not said whether it runs a modeling
 * worker cannot answer a planner before their first run is queued and reaped,
 * which is a real gap the panel reports.
 */
function facts(overrides: Partial<DeploymentHealthFacts> = {}): DeploymentHealthFacts {
  return {
    mapbox: { hasValidToken: true, hasInvalidToken: false },
    censusApiKeyPresent: true,
    anthropicApiKeyPresent: true,
    pdfRendering: { browserEngineAvailable: true },
    modelingWorker: {
      declaration: "deployed",
      nonTerminalRunCount: 0,
      stalledRunCount: 0,
      pushDispatch: NO_PUSH_ENDPOINT,
    },
    ...overrides,
  };
}

/**
 * The default everywhere below: a deployment that pushes nowhere, which is what
 * every deployment configured before the push path existed looks like. Named so
 * that a test which is ABOUT the push endpoint is visibly opting in.
 */
const NO_PUSH_ENDPOINT = { configured: false, configurationProblem: null };

function modelingWorkerCheck(overrides: Partial<DeploymentHealthFacts["modelingWorker"]> = {}) {
  return evaluateDeploymentHealth(
    facts({
      modelingWorker: {
        declaration: "undeclared",
        nonTerminalRunCount: 0,
        stalledRunCount: 0,
        pushDispatch: NO_PUSH_ENDPOINT,
        ...overrides,
      },
    })
  ).checks.find((check) => check.key === "modeling-worker")!;
}

describe("deployment health — PDF rendering tier", () => {
  it("passes silently when a browser engine is available", () => {
    const check = evaluateDeploymentHealth(facts()).checks.find((c) => c.key === "pdf-rendering");
    expect(check?.status).toBe("pass");
    expect(check?.remedy).toBeNull();
  });

  /**
   * warn, not fail: a COMPLETE pdf still comes out either way — only the
   * typesetting differs. The module's own line between the two statuses is
   * whether a named capability stops working, and here none does.
   */
  it("warns — never blocks — when no browser engine is available", () => {
    const health = evaluateDeploymentHealth(facts({ pdfRendering: { browserEngineAvailable: false } }));
    const check = health.checks.find((c) => c.key === "pdf-rendering");

    expect(check?.status).toBe("warn");
    expect(health.status).toBe("degraded");
    // The detail must not let an operator think the export is abridged.
    expect(check?.detail).toMatch(/Every section is present and nothing is shortened/);
    expect(check?.remedy).toMatch(/CHROME_EXECUTABLE_PATH/);
    // Managed platforms need no action; say so rather than sending them looking.
    expect(check?.remedy).toMatch(/Vercel or AWS Lambda/);
  });

  it("states a consequence, never a bare variable name, in the detail", () => {
    const check = evaluateDeploymentHealth(
      facts({ pdfRendering: { browserEngineAvailable: false } })
    ).checks.find((c) => c.key === "pdf-rendering");
    expect(check?.detail).not.toMatch(/CHROME_EXECUTABLE_PATH/);
  });
});

describe("deployment health — overall posture", () => {
  it("is ready and silent when everything is configured", () => {
    const health = evaluateDeploymentHealth(facts());
    expect(health.status).toBe("ready");
    expect(health.problems).toEqual([]);
    expect(health.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("is degraded — not blocked — when only optional capabilities are off", () => {
    const health = evaluateDeploymentHealth(
      facts({ censusApiKeyPresent: false, anthropicApiKeyPresent: false })
    );
    expect(health.status).toBe("degraded");
    expect(health.problems).toHaveLength(2);
    expect(health.problems.every((check) => check.status === "warn")).toBe(true);
  });

  it("is blocked when a core surface cannot function, and ranks failures first", () => {
    const health = evaluateDeploymentHealth(
      facts({
        mapbox: { hasValidToken: false, hasInvalidToken: false },
        censusApiKeyPresent: false,
      })
    );
    expect(health.status).toBe("blocked");
    expect(health.problems[0]!.status).toBe("fail");
    expect(health.problems[0]!.key).toBe("mapbox");
  });
});

describe("deployment health — Mapbox", () => {
  it("names the paste mistake instead of reporting a present token as missing", () => {
    const invalid = evaluateDeploymentHealth(
      facts({ mapbox: { hasValidToken: false, hasInvalidToken: true } })
    ).checks.find((check) => check.key === "mapbox")!;
    const missing = evaluateDeploymentHealth(
      facts({ mapbox: { hasValidToken: false, hasInvalidToken: false } })
    ).checks.find((check) => check.key === "mapbox")!;

    expect(invalid.status).toBe("fail");
    expect(invalid.detail).toMatch(/not a public token/i);
    expect(invalid.remedy).toMatch(/pk\./);
    // The two must not read the same — an operator who already set a token and
    // is told it is "missing" goes looking for work they have already done.
    expect(invalid.detail).not.toBe(missing.detail);
    expect(missing.detail).toMatch(/no mapbox token/i);
  });

  it("accepts the legacy variable name as a working configuration", () => {
    // Both names are honored by resolvePublicMapboxToken, so a deployment on
    // the legacy name is healthy — the facts collector has already resolved it.
    const check = evaluateDeploymentHealth(
      facts({ mapbox: { hasValidToken: true, hasInvalidToken: true } })
    ).checks.find((c) => c.key === "mapbox")!;
    expect(check.status).toBe("pass");
  });
});

describe("deployment health — Census key", () => {
  it("says empty means unconfigured, which is the whole point", () => {
    const check = evaluateDeploymentHealth(facts({ censusApiKeyPresent: false })).checks.find(
      (c) => c.key === "census"
    )!;

    expect(check.status).toBe("warn");
    // The specific confusion being prevented: a planner reading an empty equity
    // layer as "my county has no data".
    expect(check.detail).toMatch(/return no data rather than an error/i);
    expect(check.detail).toMatch(/equity/i);
    expect(check.remedy).toMatch(/free/i);
  });
});

describe("deployment health — modeling worker", () => {
  it("claims nothing when no run is in flight", () => {
    const check = modelingWorkerCheck({ declaration: "deployed" });
    expect(check.status).toBe("pass");
    // This pure configuration check cannot turn a declaration into an
    // observation. The separate heartbeat loader supplies current health.
    expect(check.detail).toMatch(/declares/i);
    expect(check.detail).toMatch(/heartbeat observations are reported separately/i);
  });

  it("passes while runs are progressing", () => {
    const check = modelingWorkerCheck({ declaration: "deployed", nonTerminalRunCount: 2 });
    expect(check.status).toBe("pass");
    expect(check.detail).toMatch(/2 model runs are in flight/i);
  });

  it("fails when runs have stopped progressing, and points at the worker", () => {
    const check = modelingWorkerCheck({ nonTerminalRunCount: 3, stalledRunCount: 1 });
    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/1 model run has stopped making progress/i);
    expect(check.remedy).toMatch(/DEPLOY\.md/);
  });
});

/**
 * The declaration exists because inference is retrospective: a missing worker
 * could only be inferred from a run that had ALREADY been queued and reaped, so
 * every fresh deployment paid for the discovery with a wasted run. These assert
 * what the dashboard is allowed to say about a declaration — which is never
 * that OpenPlan checked it.
 */
describe("deployment health — what a modeling-worker declaration may claim", () => {
  it("reports an undeclared deployment as a gap, naming what the first run costs", () => {
    const check = modelingWorkerCheck({ declaration: "undeclared" });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/nothing declares/i);
    // The consequence a planner pays, not a variable name (rule 2 of the module).
    expect(check.detail).toMatch(/first worker-backed run/i);
    expect(check.detail).not.toMatch(/OPENPLAN_MODELING_WORKER/);
    // The remedy is where an operator instruction belongs, and it must offer
    // BOTH answers — "absent" is a legitimate configuration, not a lesser tier.
    expect(check.remedy).toMatch(/OPENPLAN_MODELING_WORKER/);
    expect(check.remedy).toMatch(/"deployed"/);
    expect(check.remedy).toMatch(/"absent"/);
    expect(check.detail).not.toMatch(/poller with no heartbeat/i);
  });

  it("does not turn young runs into proof that something is executing them, undeclared either", () => {
    // The same limit the "absent" branch already respects, asserted on the
    // branch that had no test at all. `nonTerminalRunCount` counts runs that
    // are queued or running and have not yet gone stale — which is exactly what
    // a deployment with NO worker looks like for the first fifteen minutes. The
    // panel had been reading that silence as "something is executing them right
    // now", a confident claim drawn from the absence of a symptom, and an
    // operator acting on it would declare a worker they do not run.
    const check = modelingWorkerCheck({ declaration: "undeclared", nonTerminalRunCount: 2 });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/2 model runs are queued or running/i);
    expect(check.detail).not.toMatch(/something is executing/i);
    expect(check.detail).not.toMatch(/progressing,/i);
    // It still has to name the gap the declaration would close.
    expect(check.detail).toMatch(/nothing declares/i);
    expect(check.remedy).toMatch(/OPENPLAN_MODELING_WORKER/);
  });

  it("treats a declared absence as an honest configuration, never a limitation to buy out of", () => {
    const check = modelingWorkerCheck({ declaration: "absent" });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/declares that it runs no AequilibraE worker/i);
    // The whole point of the declaration: refused at the button, not reaped.
    expect(check.detail).toMatch(/refused at the launch button/i);
    expect(`${check.detail} ${check.remedy}`).not.toMatch(
      /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
    );
  });

  it("reports a value it does not understand instead of guessing an answer from it", () => {
    const check = modelingWorkerCheck({ declaration: "unrecognized" });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/does not understand/i);
    expect(check.detail).toMatch(/being ignored/i);
    // Guessing either way would be worse than not knowing, because a guessed
    // declaration is a trusted one.
    expect(check.detail).toMatch(/Nothing is being guessed/i);
  });

  it("reports the run history contradicting a declared worker, and calls it a contradiction", () => {
    const check = modelingWorkerCheck({
      declaration: "deployed",
      nonTerminalRunCount: 2,
      stalledRunCount: 2,
    });

    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/disagree/i);
    // Evidence outranks the declaration, but the declaration is not deleted —
    // an operator can only fix what they are shown.
    expect(check.detail).toMatch(/declares that an AequilibraE worker runs against it/i);
    expect(check.remedy).toMatch(/DEPLOY\.md/);
  });

  it("reports a declared absence that runs MAY be contradicting, without claiming they do", () => {
    const check = modelingWorkerCheck({ declaration: "absent", nonTerminalRunCount: 2 });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/out of date/i);
    expect(check.remedy).toMatch(/"deployed"/);
    // A queued run that nothing has picked up is non-terminal and not yet stale
    // — exactly what this count sees on a deployment with no worker at all. So
    // the absence of a symptom may not be reported as proof of execution, and
    // the remedy may not talk an operator into declaring a worker they lack.
    expect(check.detail).not.toMatch(/something is executing/i);
    expect(check.detail).toMatch(/not evidence that a worker exists/i);
    expect(check.remedy).not.toMatch(/demonstrably can/i);
  });

  it("never says OpenPlan checked, probed or verified a worker", () => {
    const declarations = ["deployed", "absent", "undeclared", "unrecognized"] as const;
    for (const declaration of declarations) {
      for (const stalledRunCount of [0, 2]) {
        // A configured push endpoint is the closest thing to a live signal in
        // this lane, which is exactly why it must not be allowed to graduate
        // into "OpenPlan verified the worker". A configured URL is a fact about
        // an environment file; the worker behind it may be dead.
        for (const configured of [false, true]) {
          const check = modelingWorkerCheck({
            declaration,
            nonTerminalRunCount: 2,
            stalledRunCount,
            pushDispatch: { configured, configurationProblem: null },
          });
          const rendered = `${check.detail} ${check.remedy ?? ""}`;
          expect(rendered).not.toMatch(/OpenPlan (has )?(checked|verified|confirmed|probed)/i);
          expect(rendered).not.toMatch(/worker is (running|alive|up)\b/i);
        }
      }
    }
  });
});

/**
 * A remedy that names only one shape of worker is an incomplete answer wearing
 * a complete answer's clothes. Every remedy in this check used to end at "deploy
 * the AequilibraE worker" — a long-lived polling process — which an operator on
 * a platform that scales to zero cannot do at all. These pin the second option
 * into the copy, and pin what a configured push endpoint may and may not claim.
 */
describe("deployment health — a remedy names every way to give this deployment compute", () => {
  it("offers the push endpoint, not just 'deploy a poller', in every non-passing remedy", () => {
    const nonPassing = [
      modelingWorkerCheck({ declaration: "undeclared" }),
      modelingWorkerCheck({ declaration: "absent" }),
      modelingWorkerCheck({ declaration: "unrecognized" }),
      modelingWorkerCheck({ declaration: "undeclared", nonTerminalRunCount: 2 }),
      modelingWorkerCheck({ declaration: "undeclared", nonTerminalRunCount: 2, stalledRunCount: 2 }),
    ];

    for (const check of nonPassing) {
      expect(check.status).not.toBe("pass");
      // Both lanes, named, in the remedy where operator instructions belong.
      expect(check.remedy).toMatch(/OPENPLAN_MODELING_WORKER_URL/);
      expect(check.remedy).toMatch(/OPENPLAN_MODELING_WORKER_TOKEN/);
      expect(check.remedy).toMatch(/poll/i);
      // Still free, still not a tier.
      expect(`${check.detail} ${check.remedy}`).not.toMatch(
        /upgrade|subscription|billing|pricing|paid tier|plan tier|contact sales/i
      );
    }
  });

  it("stops reporting an undeclared deployment as a gap once it can push, without claiming the worker is up", () => {
    const check = modelingWorkerCheck({
      declaration: "undeclared",
      pushDispatch: { configured: true, configurationProblem: null },
    });

    // The warning it replaces exists because a planner had to wait out a wasted
    // run before anything could tell them. A push endpoint answers at launch,
    // so that specific cost is gone and the check no longer reports it.
    expect(check.status).toBe("pass");
    expect(check.detail).toMatch(/answered at launch/i);
    // But acceptance is not completion, and it must say so.
    expect(check.detail).toMatch(/Acceptance is not completion/i);
    expect(check.detail).not.toMatch(/failed by the reaper before anything can warn/i);
  });

  it("reports a half-configured push endpoint instead of calling it 'no push endpoint'", () => {
    const problem = "OPENPLAN_MODELING_WORKER_URL is set but OPENPLAN_MODELING_WORKER_TOKEN is not.";
    const check = modelingWorkerCheck({
      declaration: "undeclared",
      pushDispatch: { configured: false, configurationProblem: problem },
    });

    expect(check.status).toBe("warn");
    // The consequence in the detail, the variable names in the remedy — an
    // operator who thinks they configured this must not be told nothing is set.
    expect(check.detail).toMatch(/partly configured/i);
    expect(check.detail).toMatch(/nothing is pushed/i);
    expect(check.remedy).toContain(problem);
  });

  it("reports a declared absence that contradicts a configured push endpoint as a contradiction", () => {
    const check = modelingWorkerCheck({
      declaration: "absent",
      pushDispatch: { configured: true, configurationProblem: null },
    });

    expect(check.status).toBe("warn");
    expect(check.detail).toMatch(/disagree/i);
    // Neither operator statement may be silently preferred over the other, and
    // the cost of leaving it wrong is named: planners refused runs that work.
    expect(check.detail).toMatch(/refused at the button/i);
    expect(check.remedy).toMatch(/OPENPLAN_MODELING_WORKER/);
  });
});

describe("deployment health — never leaks a secret", () => {
  it("has no way to receive a token value in the first place", () => {
    // The structural guarantee: the facts type carries booleans only, so no
    // rendered string can contain a key even by mistake. If someone widens
    // `DeploymentHealthFacts` to take a token string, this fails to compile
    // before it can fail in production.
    const withSecrets = facts() as unknown as Record<string, unknown>;
    expect(typeof withSecrets.censusApiKeyPresent).toBe("boolean");
    expect(typeof withSecrets.anthropicApiKeyPresent).toBe("boolean");
    expect(Object.values(facts().mapbox).every((value) => typeof value === "boolean")).toBe(true);
  });

  it("emits no token-shaped text in any check, in any configuration", () => {
    const combinations: DeploymentHealthFacts[] = [];
    for (const hasValidToken of [true, false]) {
      for (const hasInvalidToken of [true, false]) {
        for (const censusApiKeyPresent of [true, false]) {
          for (const anthropicApiKeyPresent of [true, false]) {
            for (const stalledRunCount of [0, 2]) {
              for (const declaration of ["deployed", "absent", "undeclared", "unrecognized"] as const) {
                // Both push states, because the push branches print a URL
                // variable NAME and must never be able to print a value.
                for (const pushDispatch of [
                  NO_PUSH_ENDPOINT,
                  { configured: true, configurationProblem: null },
                  { configured: false, configurationProblem: "a worker URL is set with no token" },
                ]) {
                  combinations.push(
                    facts({
                      mapbox: { hasValidToken, hasInvalidToken },
                      censusApiKeyPresent,
                      anthropicApiKeyPresent,
                      modelingWorker: { declaration, nonTerminalRunCount: 2, stalledRunCount, pushDispatch },
                    })
                  );
                }
              }
            }
          }
        }
      }
    }

    for (const combination of combinations) {
      const rendered = evaluateDeploymentHealth(combination)
        .checks.map((check) => `${check.detail} ${check.remedy ?? ""}`)
        .join(" ");
      // A real public token is `pk.` followed by base64; a secret is `sk.`.
      // The remedy text explains the prefixes, so match on an actual token
      // shape rather than the bare prefix.
      expect(rendered).not.toMatch(/\b[ps]k\.[A-Za-z0-9_-]{10,}/);
      expect(rendered).not.toMatch(/sk-ant-/);
    }
  });
});

/**
 * Convention guard. Two map components read only the newer Mapbox variable
 * while every other one accepted either, so a deployment configured with the
 * legacy name rendered some maps and left others blank with no explanation.
 * That is precisely the silent, partial configuration this whole pass exists to
 * remove — so the convention is enforced rather than remembered.
 */
describe("Mapbox token reads go through the shared resolver", () => {
  const SRC = path.join(process.cwd(), "src");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === "test" ? [] : walk(full);
      }
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("has no component reading the Mapbox environment directly", () => {
    const readers = walk(SRC).filter((file) =>
      /process\.env\.NEXT_PUBLIC_MAPBOX/.test(readFileSync(file, "utf8"))
    );

    // Guard the guard: a scan that finds nothing would pass for the wrong
    // reason and silently stop protecting anything.
    expect(readers.length).toBeGreaterThan(5);

    const offenders = readers.filter(
      // The only legitimate reads are the arguments handed to the resolver.
      (file) => !/resolvePublicMapboxToken\(/.test(readFileSync(file, "utf8"))
    );

    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });
});
