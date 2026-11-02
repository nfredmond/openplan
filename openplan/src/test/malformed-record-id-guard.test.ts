import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * A MALFORMED RECORD ID IS NOT FOUND, NOT A FAILED READ.
 *
 * `/projects/new` used to render the project page's "could not be read" notice
 * quoting Postgres: `invalid input syntax for type uuid: "new"`. The page was
 * right to treat any error other than PGRST116 as a failed read; the defect was
 * handing a string that cannot be a uuid to `.eq("id", …)` at all. A string that
 * is not a uuid names no record, so a page answers `notFound()` and a route
 * answers its family's malformed-id status (400 or 404) BEFORE it queries.
 *
 * This guard lists every page and route handler under `src/app` with a
 * `[somethingId]` segment and requires, for each such param, one recognized
 * check in that file: `isUuid(param)` from `@/lib/uuid`, a zod uuid schema
 * applied to the route params, or a call to a shared access helper whose FIRST
 * statement is the uuid check (proved below against the helper's own source).
 * A file that never reads its params (a 410 tombstone) is exempt by name, and
 * the exemption is withdrawn the moment it starts reading them.
 *
 * Segments that are not named `…Id` are not uuids by assumption; each is listed
 * in `NOT_UUID_SEGMENTS` with the column type that makes it so. A new non-Id
 * segment fails until someone records what it is.
 *
 * Routes are held per HANDLER: each exported GET/POST/PUT/PATCH/DELETE must
 * check, or hand its params to file-local code that checks without reading the
 * raw param itself.
 *
 * BLIND CATEGORY: it recognizes only the spellings in `directChecks`,
 * `schemaChecks` and `DELEGATES`; it does not follow a param through any other
 * helper; and for routes it does not prove the check runs before the first
 * query (pages are held to that order). Layouts are out of scope: today they
 * only build metadata from the param and never query with it.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "page.tsx" || entry === "route.ts" ? [full] : [];
  });
}

/** Repo-relative path from the package root, forward slashes on every platform. */
function fileId(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

/** Non-Id dynamic segments, and why each is not a uuid. */
const NOT_UUID_SEGMENTS: Record<string, string> = {
  shareToken:
    "share tokens are text columns (engagement_campaigns.share_token, rtp_cycles/measure_funds.public_share_token, land_use_plan_review_releases.share_token); the portal also accepts a printable slug",
  token: "workspace invitation tokens are matched by token_hash (text), never cast to uuid",
  fileName: "a map-package file name, validated by its own filename pattern",
};

/**
 * Shared helpers that perform the uuid check for their caller. Each entry is
 * accepted only because `proof` matches the helper's own source: the helper's
 * first statement refuses a malformed id before any query.
 */
type Delegate = { name: string; file: string; params: readonly string[]; call: (param: string) => RegExp; proof: RegExp };

const firstStatementChecks = (fn: string, arg: string) =>
  new RegExp(
    String.raw`function\s+${fn}\s*\([^)]*\b${arg}\b[^)]*\)[^{]*\{\s*if\s*\(\s*!(?:isUuid\(\s*${arg}\s*\)|z\.string\(\)\.uuid\(\)\.safeParse\(\s*${arg}\s*\)\.success)\s*\)`,
  );
const callsWith = (fn: string) => (param: string) => new RegExp(String.raw`\b${fn}\([^;]*?\b${param}\b`);

const DELEGATES: readonly Delegate[] = [
  {
    name: "authorizeWorkProgram",
    file: "src/lib/programs/work-program/server.ts",
    params: ["programId"],
    call: callsWith("authorizeWorkProgram"),
    proof: firstStatementChecks("authorizeWorkProgram", "programId"),
  },
  {
    name: "authorizeBcaProject",
    file: "src/lib/bca/workbench/access.ts",
    params: ["projectId"],
    call: callsWith("authorizeBcaProject"),
    proof: firstStatementChecks("authorizeBcaProject", "projectId"),
  },
  {
    name: "contractAccess",
    file: "src/lib/invoicing/contracts/server.ts",
    params: ["engagementId"],
    call: callsWith("contractAccess"),
    proof: firstStatementChecks("contractAccess", "engagementId"),
  },
  {
    name: "contractCalculationRequest",
    file: "src/lib/invoicing/contracts/jobs-server.ts",
    params: ["engagementId"],
    call: callsWith("contractCalculationRequest"),
    proof: firstStatementChecks("contractCalculationRequest", "engagementId"),
  },
  {
    name: "mapPackageIdSchema",
    file: "src/lib/map-packages/server.ts",
    params: ["packageId"],
    call: () => /\bmapPackageIdSchema\.(?:safeParse|parse)\(/,
    proof: /export const mapPackageIdSchema = z\.object\(\{ packageId: z\.string\(\)\.uuid\(\) \}\)/,
  },
  {
    name: "recoveryIdentitySchema",
    file: "src/lib/models/recovery-decision.ts",
    params: ["modelId", "modelRunId"],
    call: (param) => new RegExp(String.raw`\b${param}\s*:\s*recoveryIdentitySchema\b`),
    proof: /export const recoveryIdentitySchema = z\.string\(\)\.uuid\(\)/,
  },
  {
    name: "responseWriteRoute",
    file: "src/lib/engagement/response-write-route.ts",
    params: ["campaignId", "entryId"],
    call: () => /\bresponseWriteRoute\(/,
    proof: /const campaignParams = z\.object\(\{ campaignId: z\.string\(\)\.uuid\(\) \}\);\s*const entryParams = campaignParams\.extend\(\{ entryId: z\.string\(\)\.uuid\(\) \}\);/,
  },
];

/** Files that never read their params. Withdrawn automatically once they do. */
const EXEMPT: Record<string, string> = {
  "src/app/api/aerial/missions/[missionId]/export/route.ts": "410 tombstone for the retired perimeter export; never reads the mission id",
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/route.ts": "410 tombstone for the retired synthesis generator; never reads the campaign id",
  "src/app/api/engagement/campaigns/[campaignId]/translations/route.ts": "410 tombstone for the retired translation editor; never reads the campaign id",
};

/** Evidence that a zod object schema is applied to the route params, not only to a body. */
const PARSES_PARAMS =
  /[pP]arse\(\s*(?:await\s+)?(?:context\.|ctx\.|props\.)?(?:route|resolved|raw)?[pP]arams\b|[pP]arse\(\s*\{/;

/** Checks that refuse a malformed `param` wherever they appear. */
function directChecks(param: string): RegExp[] {
  return [
    new RegExp(String.raw`\bisUuid\(\s*(?:[\w$]+\.)?${param}\s*\)`),
    new RegExp(String.raw`z\.(?:string\(\)\.)?uuid\(\)\.safeParse\(\s*${param}\s*\)`),
  ];
}

/**
 * Object-schema entries (`param: z.string().uuid()`, or `param: id` with
 * `const id = z.string().uuid()`). They refuse only where the schema is applied
 * to the route params, so a handler must also match `PARSES_PARAMS`.
 */
function schemaChecks(param: string, source: string): RegExp[] {
  const uuidIdents = [...source.matchAll(/(?:\bconst|,)\s*([A-Za-z_$][\w$]*)\s*=\s*z\.(?:string\(\)\.)?uuid\(\)/g)].map((m) => m[1]);
  return [
    new RegExp(String.raw`\b${param}\s*:\s*z\.(?:string\(\)\.)?uuid\(`),
    ...uuidIdents.map((ident) => new RegExp(String.raw`\b${param}\s*:\s*${ident.replace(/\$/g, "\\$")}\b`)),
  ];
}

/** A page refuses with notFound(), in one of these two spellings. */
function pageRefusal(param: string): RegExp {
  return new RegExp(
    String.raw`if\s*\(\s*!(?:isUuid\(\s*${param}\s*\)|z\.string\(\)\.uuid\(\)\.safeParse\(\s*${param}\s*\)\.success)\s*\)\s*notFound\(\)`,
  );
}

/** The first database or loader touch in a page's default export. */
const FIRST_READ = /\bcreate(?:ServiceRole)?Client\s*\(|\.from\(|\.rpc\(|\bawait\s+load[A-Z]\w*\(|\bcontractAccess\(/;

type Target = { id: string; kind: "page" | "route"; params: string[]; source: string };

function inventory(): Target[] {
  return walk(APP_DIR)
    .sort()
    .map((file) => {
      const id = fileId(file);
      const params = [...id.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map((m) => m[1]);
      return {
        id,
        kind: id.endsWith("/page.tsx") ? ("page" as const) : ("route" as const),
        params,
        source: stripSourceComments(readFileSync(file, "utf8")),
      };
    })
    .filter((target) => target.params.length > 0);
}

function uuidParams(target: Target): string[] {
  return target.params.filter((param) => param.endsWith("Id"));
}

/** A direct check or a recognized delegate call of `param` in `text`. */
function checks(param: string, text: string): boolean {
  if (directChecks(param).some((check) => check.test(text))) return true;
  return DELEGATES.some((delegate) => delegate.params.includes(param) && delegate.call(param).test(text));
}

/** A uuid object-schema entry for `param` in `schemaText`, applied to params in `parseText`. */
function schemaApplied(target: Target, param: string, schemaText: string, parseText: string): boolean {
  return PARSES_PARAMS.test(parseText) && schemaChecks(param, target.source).some((check) => check.test(schemaText));
}

const HANDLER = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE)\s*[:=]/g;

/** The code before the first handler, and each handler's own text up to the next one. */
function handlerSegments(source: string): { preamble: string; handlers: string[] } {
  const starts = [...source.matchAll(HANDLER)].map((match) => match.index ?? 0);
  if (starts.length === 0) return { preamble: source, handlers: [] };
  return {
    preamble: source.slice(0, starts[0]),
    handlers: starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length)),
  };
}

/**
 * Pages: the file checks. Routes: EVERY handler checks, either itself or by
 * handing its context to file-local code that does (a handler that never names
 * the param, with a check in the preamble). A GET that checks no longer covers
 * an unchecked POST in the same file.
 */
function recognized(target: Target, param: string): boolean {
  if (target.kind === "page") return checks(param, target.source) || schemaApplied(target, param, target.source, target.source);
  const { preamble, handlers } = handlerSegments(target.source);
  if (handlers.length === 0) return checks(param, target.source) || schemaApplied(target, param, target.source, target.source);
  return handlers.every((handler) => {
    if (checks(param, handler)) return true;
    if (schemaApplied(target, param, preamble + handler, handler)) return true;
    // A handler that never reads its params needs no check.
    if (!/\bparams\b/.test(handler) && !/\bcontext\b/.test(handler)) return true;
    // A handler that hands its params to file-local code that checks, and never
    // reads the raw param itself.
    const readsRaw = new RegExp(
      String.raw`\{[^}]*\b${param}\b[^}]*\}\s*=\s*await\s+(?:context\.|ctx\.)?params\b|(?:\(\s*await\s+(?:context\.|ctx\.)?params\s*\)|\bparams)\.${param}\b`,
    ).test(handler);
    return !readsRaw && (checks(param, preamble) || schemaApplied(target, param, preamble, preamble));
  });
}

describe("a malformed record id is not found, not a failed read", () => {
  it("covers the dynamic pages and routes it claims to", () => {
    const targets = inventory().filter((target) => uuidParams(target).length > 0);
    const ids = targets.map((target) => target.id);
    // A walk that silently found nothing would pass every assertion below.
    expect(targets.filter((target) => target.kind === "page").length).toBeGreaterThanOrEqual(24);
    expect(targets.filter((target) => target.kind === "route").length).toBeGreaterThanOrEqual(200);
    expect(ids).toContain("src/app/(app)/projects/[projectId]/page.tsx");
    expect(ids).toContain("src/app/api/network-packages/[packageId]/versions/route.ts");
  });

  it("records what every non-Id segment is", () => {
    const unknown = [
      ...new Set(
        inventory()
          .flatMap((target) => target.params)
          .filter((param) => !param.endsWith("Id") && !(param in NOT_UUID_SEGMENTS)),
      ),
    ];
    expect(unknown).toEqual([]);
  });

  it("checks every uuid param before it can reach a query", () => {
    const offenders = inventory()
      .filter((target) => !(target.id in EXEMPT))
      .flatMap((target) => uuidParams(target).filter((param) => !recognized(target, param)).map((param) => `${target.id} [${param}]`));
    expect(offenders).toEqual([]);
  });

  it("answers notFound() on a page, before the page's first read", () => {
    const offenders: string[] = [];
    for (const target of inventory().filter((candidate) => candidate.kind === "page")) {
      const start = target.source.search(/export\s+default\s+(?:async\s+)?function/);
      const body = start >= 0 ? target.source.slice(start) : target.source;
      for (const param of uuidParams(target)) {
        const refusal = pageRefusal(param).exec(body);
        if (!refusal) {
          offenders.push(`${target.id} [${param}] does not call notFound() for a malformed id`);
          continue;
        }
        const firstRead = FIRST_READ.exec(body);
        if (firstRead && firstRead.index < refusal.index) {
          offenders.push(`${target.id} [${param}] reads (${firstRead[0]}) before it checks the id`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognizes only helpers whose first statement is the uuid check", () => {
    const unproven = DELEGATES.filter((delegate) => {
      const source = stripSourceComments(readFileSync(path.join(process.cwd(), delegate.file), "utf8"));
      return !delegate.proof.test(source);
    }).map((delegate) => `${delegate.name} in ${delegate.file}`);
    expect(unproven).toEqual([]);
  });

  it("keeps the exemptions honest", () => {
    const targets = new Map(inventory().map((target) => [target.id, target]));
    const stale = Object.keys(EXEMPT).filter((id) => {
      const target = targets.get(id);
      return !target || /\bparams\b/.test(target.source);
    });
    expect(stale).toEqual([]);
  });
});
