import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const apiRouteRoot = join(process.cwd(), "src/app/api");

const mutatingHandlerPattern = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/;
/**
 * Every way a route can get at the request body without going through a limit
 * helper — not only the three that existed when this was written.
 *
 * `json`, `text` and `arrayBuffer` were the whole list, and that was enough
 * until a lane needed to accept a 200 MiB upload. `request.body` is the one that
 * matters most: it is the STREAM, so a route reading it directly is exactly the
 * unbounded read this guard exists to forbid, and it was the one spelling the
 * pattern could not see. `formData`, `blob` and `bytes` were invisible too.
 *
 * `body` is matched as a property rather than a call, which is why it needs its
 * own alternative — `request.body.getReader()` has no parentheses after `body`.
 */
const rawBodyReaderPattern =
  /\b(?:request|req)\s*\.\s*(?:(?:json|text|arrayBuffer|formData|blob|bytes)\s*\(|body\b)/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      return routeFiles(fullPath);
    }

    return entry === "route.ts" ? [fullPath] : [];
  });
}

describe("API route body limit inventory", () => {
  it("does not leave mutating routes with raw request body readers", () => {
    const offenders = routeFiles(apiRouteRoot)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return mutatingHandlerPattern.test(source) && rawBodyReaderPattern.test(source);
      })
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

describe("the raw-body detector sees every spelling", () => {
  // Guard the guard. The pattern is the whole test — if it stops matching, the
  // assertion above passes by finding nothing, which is how `request.body` sat
  // unguarded while this file reported green.
  const matches = (source: string) => rawBodyReaderPattern.test(source);

  it("matches each way a route can reach the body directly", () => {
    expect(matches("const b = await request.json();")).toBe(true);
    expect(matches("await req.text()")).toBe(true);
    expect(matches("await request.arrayBuffer()")).toBe(true);
    expect(matches("await request.formData()")).toBe(true);
    expect(matches("await request.blob()")).toBe(true);
    expect(matches("await request.bytes()")).toBe(true);
    // The stream — no parentheses, and the one an unbounded upload would use.
    expect(matches("const reader = request.body.getReader();")).toBe(true);
    expect(matches("if (!request.body) return;")).toBe(true);
  });

  it("does not match the limit helpers a route is supposed to use", () => {
    expect(matches("const read = await readBytesWithLimit(request, BODY_LIMITS.kbDocumentRaw);")).toBe(false);
    expect(matches("await readBytesWithLimitStreaming(request, BODY_LIMITS.gtfsFeedRaw)")).toBe(false);
    expect(matches("await readJsonWithLimit(request, BODY_LIMITS.default)")).toBe(false);
    expect(matches("const body = parsed.body;")).toBe(false);
  });
});
