import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkMonthlyRunCap,
  isRunCapExceeded,
  isRunCapLookupError,
  monthlyRunCapMessage,
  MONTHLY_RUN_CAP_ENV,
  resolveMonthlyRunCap,
  RUN_WEIGHTS,
} from "@/lib/config/run-cap";

/**
 * OpenPlan is free and open source with no paid tier. This guard exists because
 * the product contradicted that in code for a long time without anyone noticing:
 * `workspaces.plan` defaulted to 'free', which was not a case in the plan enum,
 * so every self-serve workspace normalized to "unknown" and inherited a 100-run
 * monthly cap that hard-429'd corridor analysis, report generation, model runs,
 * scenario comparison, and network ingest — with no way to pay for more, because
 * checkout was deliberately disabled.
 *
 * The subsystem is deleted. These assertions keep it deleted.
 */

const SRC = path.join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

function sourceFiles(): string[] {
  return walk(SRC).filter((file) => !file.startsWith(path.join(SRC, "test")));
}

describe("the paid-tier subsystem stays deleted", () => {
  it("has no billing module left to import", () => {
    const offenders = sourceFiles().filter((file) =>
      /@\/lib\/billing\/|@\/components\/billing\/|\/api\/billing\/(?!invoices)/.test(
        readFileSync(file, "utf8")
      )
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("has no plan, quota, or subscription gate in any source file", () => {
    const banned = [
      "checkMonthlyRunQuota",
      "normalizeWorkspacePlan",
      "entitlementsForPlan",
      "monthlyRunLimitForPlan",
      "isWorkspaceSubscriptionActive",
      "resolveWorkspaceEntitlements",
      "subscriptionGateMessage",
      "recordUsageEventBestEffort",
    ];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const symbol of banned) {
        if (source.includes(symbol)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${symbol}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never answers 402 Payment Required", () => {
    // A free product demanding payment is the sharpest possible version of the
    // contradiction; the six core routes each used to have exactly this.
    const offenders = sourceFiles().filter((file) =>
      /status:\s*402/.test(readFileSync(file, "utf8"))
    );
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it("has no pricing route, request-access funnel, or link to either", () => {
    // The whole commercial funnel was deleted: /pricing, /request-access, and
    // /contact/openplan-fit. /contact survives as a plain, non-commercial page.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      // Quoted/imported references only — a prose comment explaining why the
      // route was removed is not a reinstatement of it.
      for (const pattern of [
        /href="\/pricing/,
        /href="\/request-access/,
        /["'`]\/contact\/openplan-fit/,
        /from "[^"]*openplan-fit/,
      ]) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("sells nothing on any public page", () => {
    const publicDir = path.join(SRC, "app", "(public)");
    const offenders: string[] = [];
    for (const file of walk(publicDir)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of [/managed hosting/i, /service lanes?\b/i, /\bretainer\b/i, /subscription/i]) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${pattern}`);
        }
      }
    }
    expect(walk(publicDir).length).toBeGreaterThan(3);
    expect(offenders).toEqual([]);
  });

  it("guards the guard — the scan actually reaches the routes", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes(path.join("api", "analysis")))).toBe(true);
  });
});

describe("run cap — unlimited unless an operator says otherwise", () => {
  it("is unlimited when unset, blank, or malformed", () => {
    expect(resolveMonthlyRunCap({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    for (const value of ["", "   ", "abc", "0", "-5", "12.5", "NaN", "Infinity"]) {
      expect(resolveMonthlyRunCap({ [MONTHLY_RUN_CAP_ENV]: value } as unknown as NodeJS.ProcessEnv)).toBeNull();
    }
  });

  it("reads a positive integer cap", () => {
    expect(resolveMonthlyRunCap({ [MONTHLY_RUN_CAP_ENV]: "250" } as unknown as NodeJS.ProcessEnv)).toBe(250);
  });

  it("skips the counting query entirely when no cap is set", async () => {
    let queried = false;
    const client = {
      from() {
        queried = true;
        throw new Error("must not query");
      },
    };

    const result = await checkMonthlyRunCap(client as never, {
      workspaceId: "w1",
      tableName: "runs",
      env: {} as unknown as NodeJS.ProcessEnv,
    });

    expect(queried).toBe(false);
    expect(result).toMatchObject({ ok: true, capped: false, cap: null });
  });

  it("refuses past a configured cap and weights model runs 5x", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ gte: async () => ({ count: 8, error: null }) }),
        }),
      }),
    };
    const env = { [MONTHLY_RUN_CAP_ENV]: "10" } as unknown as NodeJS.ProcessEnv;

    // 8 used + weight 1 <= 10 → allowed.
    const light = await checkMonthlyRunCap(client as never, {
      workspaceId: "w1",
      tableName: "runs",
      env,
    });
    expect(light.ok).toBe(true);

    // 8 used + weight 5 > 10 → refused.
    const heavy = await checkMonthlyRunCap(client as never, {
      workspaceId: "w1",
      tableName: "model_runs",
      weight: RUN_WEIGHTS.MODEL_RUN_LAUNCH,
      env,
    });
    expect(isRunCapExceeded(heavy)).toBe(true);
  });

  it("surfaces a lookup failure as its own state, not as a refusal", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({ gte: async () => ({ count: null, error: { message: "boom", code: "42P01" } }) }),
        }),
      }),
    };
    const result = await checkMonthlyRunCap(client as never, {
      workspaceId: "w1",
      tableName: "runs",
      env: { [MONTHLY_RUN_CAP_ENV]: "10" } as unknown as NodeJS.ProcessEnv,
    });
    expect(isRunCapLookupError(result)).toBe(true);
    expect(isRunCapExceeded(result)).toBe(false);
  });

  it("names the operator and sells nothing", () => {
    const message = monthlyRunCapMessage(100, 100);
    expect(message).toMatch(/operates this deployment/i);
    expect(message).toMatch(/free and has no usage tiers/i);
    // The old text was "Monthly analysis run limit reached for the current plan".
    expect(message).not.toMatch(/\bplan\b|upgrade|subscription|billing|checkout|payment/i);
  });
});
