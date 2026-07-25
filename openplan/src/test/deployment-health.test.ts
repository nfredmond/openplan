import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateDeploymentHealth,
  type DeploymentHealthFacts,
} from "@/lib/config/deployment-health";

function facts(overrides: Partial<DeploymentHealthFacts> = {}): DeploymentHealthFacts {
  return {
    mapbox: { hasValidToken: true, hasInvalidToken: false },
    censusApiKeyPresent: true,
    anthropicApiKeyPresent: true,
    pdfRendering: { browserEngineAvailable: true },
    modelingWorker: { nonTerminalRunCount: 0, stalledRunCount: 0 },
    ...overrides,
  };
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
    const check = evaluateDeploymentHealth(facts()).checks.find(
      (c) => c.key === "modeling-worker"
    )!;
    expect(check.status).toBe("pass");
    // A poller with no heartbeat cannot be probed; saying "a worker is running"
    // here would be an assertion with no evidence behind it.
    expect(check.detail).toMatch(/cannot be observed/i);
  });

  it("passes while runs are progressing", () => {
    const check = evaluateDeploymentHealth(
      facts({ modelingWorker: { nonTerminalRunCount: 2, stalledRunCount: 0 } })
    ).checks.find((c) => c.key === "modeling-worker")!;
    expect(check.status).toBe("pass");
    expect(check.detail).toMatch(/2 model runs are in flight/i);
  });

  it("fails when runs have stopped progressing, and points at the worker", () => {
    const check = evaluateDeploymentHealth(
      facts({ modelingWorker: { nonTerminalRunCount: 3, stalledRunCount: 1 } })
    ).checks.find((c) => c.key === "modeling-worker")!;
    expect(check.status).toBe("fail");
    expect(check.detail).toMatch(/1 model run has stopped making progress/i);
    expect(check.remedy).toMatch(/DEPLOY\.md/);
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
              combinations.push(
                facts({
                  mapbox: { hasValidToken, hasInvalidToken },
                  censusApiKeyPresent,
                  anthropicApiKeyPresent,
                  modelingWorker: { nonTerminalRunCount: 2, stalledRunCount },
                })
              );
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
