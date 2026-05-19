import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const apiRouteRoot = join(process.cwd(), "src/app/api");

const mutatingHandlerPattern = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/;
const rawBodyReaderPattern = /\b(?:request|req)\s*\.\s*(?:json|text|arrayBuffer)\s*\(/;

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
