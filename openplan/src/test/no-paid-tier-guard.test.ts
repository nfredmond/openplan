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
import { harnessTextFiles, locateHarnessDir } from "./qa-harness-location-helpers";

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
const HARNESS_DIR = locateHarnessDir();

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

describe("the app declares no payment dependency", () => {
  /**
   * The code that USED Stripe was deleted on 2026-07-24; the `stripe` npm
   * dependency was not, and stayed declared in this package.json for months
   * afterwards with nothing importing it anywhere — not in `src`, not in the QA
   * harness, not in `scripts`. Found by a reachability sweep on 2026-08-03.
   *
   * Why a dead dependency is worth failing the build over. It ships a payment
   * SDK inside a product that takes no payments, which is a supply-chain surface
   * maintained for nothing and a standing invitation to "just import it" the
   * next time someone reaches for a paywall. The guards below scan SOURCE for
   * billing symbols and the QA HARNESS for its own package.json — neither ever
   * looked at the app's own dependency list, so the one artifact that still
   * named Stripe was the one nothing checked.
   */
  const PAYMENT_PACKAGES = [/^stripe$/, /^@stripe\//, /^braintree/, /^paypal/, /^@paddle\//, /^lemonsqueezy/];

  function declaredDependencies(): string[] {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
  }

  it("names no payment processor in its dependencies", () => {
    const offenders = declaredDependencies().filter((name) =>
      PAYMENT_PACKAGES.some((pattern) => pattern.test(name))
    );
    expect(
      offenders,
      "OpenPlan is free and takes no payments — a payment SDK here is dead weight and an invitation"
    ).toEqual([]);
  });

  it("guards the guard — it reads a real, populated manifest", () => {
    // Without this, the assertion above passes just as happily against an
    // unreadable path or an empty object, which is how a scan-based guard
    // silently stops guarding.
    const declared = declaredDependencies();
    expect(declared.length).toBeGreaterThan(20);
    expect(declared).toContain("next");
  });
});

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

  it("renders no user-visible plan or tier label", () => {
    // The Wave-4 lane deleted the "Workspace plan:", "Workspace tier:", and
    // "Plan tier" renders (assistant context, report HTML, data-hub operator
    // panel, project posture header) — surfaces that presented the dead
    // `workspaces.plan` column to users as if tiers existed. A free product
    // with no tiers must not label workspaces with one; these literals keep
    // that class of copy from regressing.
    const banned = ["Workspace plan:", "Workspace tier:", "Plan tier"];
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const literal of banned) {
        if (source.includes(literal)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${literal}`);
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

  it("has no link to the deleted /pricing or /request-access page routes", () => {
    // The whole commercial funnel was deleted: /pricing, /request-access, and
    // /contact/openplan-fit. /contact survives as a plain, non-commercial page.
    //
    // Match the ROUTE AS A QUOTED STRING — `"/request-access"`, `'/pricing'` —
    // regardless of which attribute or key precedes it. The earlier version keyed
    // on a literal `href="` and so sailed past `primaryHref="…"` (capital H),
    // `primaryHref = "…"` (spaces), and `href: "…"` (object form) — which is
    // exactly how ~17 dead links shipped green. A quote immediately before the
    // path also spares the STILL-LIVE `/api/request-access` endpoint (there the
    // char before `/request-access` is `i`, not a quote) and any prose mention.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const pattern of [
        /["'`]\/pricing(?:[/?#"'`]|$)/m,
        /["'`]\/request-access(?:[/?#"'`]|$)/m,
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

  it("guards the link guard — it would catch a primaryHref-style dead link", () => {
    // The regression that motivated the fix above used `primaryHref="…"`, not
    // `href="…"`. Prove the pattern now catches every attribute/key shape while
    // still sparing the live /api/request-access endpoint.
    const pat = /["'`]\/request-access(?:[/?#"'`]|$)/m;
    expect(pat.test('primaryHref="/request-access"')).toBe(true);
    expect(pat.test('primaryHref = "/request-access"')).toBe(true);
    expect(pat.test('href: "/request-access"')).toBe(true);
    expect(pat.test('fetch("/api/request-access")')).toBe(false);
    expect(pat.test("// the request-access flow was removed")).toBe(false);
  });

  /**
   * WIDENED, twice over, because this guard passed green while the copy it
   * exists to forbid was shipping.
   *
   * 1. It walked only `src/app/(public)`. The browser-tab title of EVERY page
   *    and the social-preview title of EVERY shared link come from
   *    `src/app/layout.tsx` — the root layout, outside that directory — and it
   *    read "OpenPlan | Open-source planning software with managed services".
   *    `src/components/top-nav.tsx` said the same and was equally unscanned.
   * 2. Its phrase list had `managed hosting` but not `managed services`, which
   *    is the phrase that was actually in the product.
   *
   * The scan now covers every surface a visitor can read, and the phrase list
   * covers the ways the same claim gets written.
   */
  it("sells nothing on any visitor-facing surface", () => {
    const surfaces = [
      path.join(SRC, "app", "(public)"),
      path.join(SRC, "app", "(embed)"),
      path.join(SRC, "app", "(auth)"),
      path.join(SRC, "components"),
    ];

    const files = [
      path.join(SRC, "app", "layout.tsx"),
      ...surfaces.flatMap((dir) => walk(dir)),
    ];

    // Claims about buying something, wherever a visitor could read them.
    // `service[- ]lane` catches the hyphenated spelling that outlived the
    // spaced one on /examples for a full release; `buyer` and `paid help`
    // shipped there the same way. "supervised" alone is NOT banned — the
    // assistant's human-in-the-loop action triage uses it legitimately —
    // only the sales-era pairings are.
    const COMMERCIAL_CLAIMS = [
      // `managed[- ]` catches the hyphenated "managed-services" spelling, which
      // outlived the spaced one on the public top-nav until 2026-08-03.
      /managed[- ]hosting/i,
      /managed[- ]services?\b/i,
      /service[- ]lanes?\b/i,
      /\bretainer\b/i,
      /\bbuyers?\b/i,
      /\bpaid help\b/i,
      /supervised (?:early access|access|request|conversations?|first workflow)/i,
    ];

    // "subscription" is deliberately NOT in the list above: the engagement
    // module lets a resident subscribe to campaign updates by email, which is a
    // participation feature and not a purchase. Only a PAID subscription is
    // forbidden, so the pattern requires the commercial qualifier.
    const PAID_SUBSCRIPTION = /\b(?:paid|billing|billed|plan|pricing|premium|upgrade)\b[^.\n]{0,40}\bsubscription/i;

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of [...COMMERCIAL_CLAIMS, PAID_SUBSCRIPTION]) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);

    // Prove the narrowed subscription pattern still catches the real thing, and
    // still spares the engagement feature.
    expect(PAID_SUBSCRIPTION.test("Manage your billing subscription")).toBe(true);
    expect(PAID_SUBSCRIPTION.test("Upgrade to a paid subscription")).toBe(true);
    expect(PAID_SUBSCRIPTION.test("Subscribe to updates about this subscription form")).toBe(false);
    expect(PAID_SUBSCRIPTION.test("engagement_subscriptions")).toBe(false);
  });

  it("guards the guard — the widened scan reaches the surfaces that shipped the claim", () => {
    const files = [
      path.join(SRC, "app", "layout.tsx"),
      ...walk(path.join(SRC, "app", "(public)")),
      ...walk(path.join(SRC, "components")),
    ];

    expect(files.length).toBeGreaterThan(50);
    // The two files whose copy this guard missed for an entire release.
    expect(files.some((f) => f.endsWith(path.join("app", "layout.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join("components", "top-nav.tsx")))).toBe(true);
  });

  it("guards the guard — the scan actually reaches the routes", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes(path.join("api", "analysis")))).toBe(true);
  });
});

/**
 * The same prohibition, applied to the QA harness.
 *
 * Everything above scans `openplan/src`. The harness is a sibling package, so
 * for months after the paid tier was deleted `qa-harness/openplan-prod-qa-cleanup.js`
 * still read a Stripe secret key, called `api.stripe.com/v1/checkout/sessions`,
 * selected the retired plan/subscription columns, and DELETEd `billing_events` —
 * while the root README asserted "There is no Stripe or billing integration in
 * the codebase" and a guard enforced only that the sentence was still PRESENT.
 *
 * Three independent things hid it, and fixing any one alone would have caught
 * nothing:
 *   1. the scan root never left `openplan/src`;
 *   2. the extension filter was `/\.tsx?$/`, and the harness is all CommonJS;
 *   3. every banned pattern was TypeScript-import syntax or a camelCase symbol,
 *      while the residue was a URL, a snake_case table name, and a PostgREST
 *      `select=` string.
 */
describe("the paid tier stays deleted in the QA harness too", () => {
  /**
   * Spelled as the harness would spell them: URLs, env var names, table names,
   * PostgREST column lists, and the retired tier labels.
   */
  const BANNED_IN_HARNESS: Array<{ pattern: RegExp; why: string }> = [
    { pattern: /api\.stripe\.com/, why: "calls the Stripe API" },
    { pattern: /\bSTRIPE_SECRET_KEY\b/, why: "reads a Stripe secret key" },
    { pattern: /\bstripe[._-]?(?:key|token|session|customer|price|product)\b/i, why: "handles a Stripe object" },
    { pattern: /\bcheckout[._-]?session/i, why: "handles a checkout session" },
    { pattern: /\bbilling_events\b/, why: "reads or writes the retired billing_events table" },
    { pattern: /\bsubscription_(?:plan|status|current_period_end)\b/, why: "reads a retired subscription column" },
    { pattern: /\bstripe_(?:customer|subscription)_id\b/, why: "reads a retired Stripe column" },
    { pattern: /\b(?:Starter|Professional)\b\s*\|/, why: "asserts on a retired paid plan tier label" },
  ];

  /**
   * Grant-reimbursement and client invoicing are NOT billing for OpenPlan — the
   * agency invoices its funder or its clients. CLAUDE.md protects these by name,
   * so any pattern above that matched them would be the bug.
   */
  const PROTECTED_INVOICING = [
    "billingBasis",
    "billing_basis",
    "billing_invoice_records",
    "Open billing triage",
    "billing_invoice_id",
  ];

  it("has no Stripe, checkout, or retired-tier code anywhere in the harness", () => {
    const offenders: string[] = [];
    for (const file of harnessTextFiles()) {
      const source = readFileSync(file, "utf8");
      for (const { pattern, why } of BANNED_IN_HARNESS) {
        if (pattern.test(source)) {
          offenders.push(`${path.relative(path.dirname(HARNESS_DIR), file)} → ${why} (${pattern})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("spares LAPM grant-reimbursement and client invoicing, which are not billing for OpenPlan", () => {
    for (const protectedToken of PROTECTED_INVOICING) {
      const tripped = BANNED_IN_HARNESS.filter(({ pattern }) => pattern.test(protectedToken));
      expect(tripped.map(({ pattern }) => `${protectedToken} → ${pattern}`)).toEqual([]);
    }
  });

  it("guards the guard — the patterns catch the residue that actually shipped", () => {
    // Verbatim lines from the pre-fix openplan-prod-qa-cleanup.js. If a future
    // rewrite of these patterns stops matching these, it is not a guard.
    const KNOWN_RESIDUE = [
      "const stripeKey = env.OPENPLAN_STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY;",
      "await jsonFetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {",
      "restSelect('workspaces', 'id,name,slug,plan,subscription_plan,subscription_status,created_at',",
      "['billing_events', 'workspace_id', workspaceIds],",
      "await page.getByText(/Starter|Professional|billing|subscription/i).first()",
    ];

    for (const line of KNOWN_RESIDUE) {
      const matched = BANNED_IN_HARNESS.some(({ pattern }) => pattern.test(line));
      expect(matched, `no pattern catches: ${line}`).toBe(true);
    }
  });

  it("guards the guard — the scan reaches the whole harness, not a filtered slice of it", () => {
    const files = harnessTextFiles();
    const relative = files.map((file) => path.relative(HARNESS_DIR, file));

    // The harness had 20 top-level scripts when this guard was written.
    expect(files.length).toBeGreaterThanOrEqual(18);
    // Non-.js files must be in scope: a retired script's npm entry point and a
    // stale claim in the docs are both worth failing on.
    expect(relative).toContain("package.json");
    expect(relative).toContain("README.md");
    // Nested helpers must be in scope — the flat readdir used elsewhere misses these.
    expect(relative.some((file) => file.startsWith(`fixtures${path.sep}`))).toBe(true);
    // And the vendored dependency tree must NOT be.
    expect(relative.every((file) => !file.includes("node_modules"))).toBe(true);
  });

  it("guards the guard — the harness is located, never silently missed", () => {
    expect(() => locateHarnessDir()).not.toThrow();
    expect(path.basename(HARNESS_DIR)).toBe("qa-harness");
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
