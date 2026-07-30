import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ACTION_REGISTRY } from "@/lib/runtime/action-registry";
import type { AssistantQuickLinkExecuteAction } from "@/lib/assistant/catalog";

/**
 * WHERE DOES A REGISTERED ACTION ACTUALLY WRITE?
 *
 * Two separate guards need this answer — one asks whether that route can promote
 * a claim tier, the other whether it verifies its own approval — and they must
 * not be allowed to disagree about which route an action targets. So it is
 * resolved once, from SOURCE rather than from a hand-written map, and an action
 * repointed at a different endpoint is re-checked against the endpoint it calls
 * now instead of the one someone remembered to write down.
 *
 * Every effect in the registry is a browser `fetch` at a relative path, so the
 * path is a string literal in the effect body — except for the two that delegate
 * to `@/lib/reports/client`, which is followed one hop.
 */

const REPO_ROOT = process.cwd();
const API_ROOT = path.join(REPO_ROOT, "src/app/api");

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

/** Every `/api/...` path literal in a chunk of source, with `${…}` collapsed to a wildcard. */
function extractApiPaths(source: string): string[] {
  return [...source.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)].map((match) =>
    match[1].replace(/\$\{[^}]*\}/g, "*")
  );
}

/** Exported async function bodies in a module, keyed by name. */
function extractFunctionBodies(source: string): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const match of source.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
    const start = match.index ?? 0;
    const after = start + match[0].length;
    const next = source.slice(after).search(/\nexport\s/);
    bodies.set(match[1], source.slice(start, next === -1 ? undefined : after + next));
  }
  return bodies;
}

const REPORTS_CLIENT_BODIES = extractFunctionBodies(readSource("src/lib/reports/client.ts"));
const ACTION_REGISTRY_SOURCE = readSource("src/lib/runtime/action-registry.ts");

export function resolveActionApiPaths(kind: AssistantQuickLinkExecuteAction["kind"]): string[] {
  const direct = extractApiPaths(ACTION_REGISTRY[kind].effect.toString());
  if (direct.length > 0) return direct;

  // The effect holds no literal, so it delegates. Find which helper by reading
  // the ActionRecord constant's own source.
  const constantMatch = ACTION_REGISTRY_SOURCE.match(
    new RegExp(`ActionRecord<"${kind}">\\s*=\\s*\\{[\\s\\S]*?\\n\\};`)
  );
  const constantSource = constantMatch?.[0] ?? "";
  const paths: string[] = [];
  for (const [name, body] of REPORTS_CLIENT_BODIES) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(constantSource)) paths.push(...extractApiPaths(body));
  }
  return paths;
}

function listRouteFiles(): Array<{ file: string; segments: string[] }> {
  const results: Array<{ file: string; segments: string[] }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts") {
        const relative = path.relative(API_ROOT, dir);
        results.push({ file: full, segments: relative === "" ? [] : relative.split(path.sep) });
      }
    }
  };
  walk(API_ROOT);
  return results;
}

const ROUTE_FILES = listRouteFiles();

/** The `route.ts` serving a URL path, matching `[param]` segments against wildcards. */
export function resolveRouteFile(apiPath: string): string | null {
  const wanted = apiPath.replace(/^\/api\//, "").split("/").filter(Boolean);
  for (const route of ROUTE_FILES) {
    if (route.segments.length !== wanted.length) continue;
    const matches = route.segments.every(
      (segment, index) => segment.startsWith("[") || segment === wanted[index] || wanted[index] === "*"
    );
    if (matches) return route.file;
  }
  return null;
}
