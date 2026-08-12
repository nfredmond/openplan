import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_DOCUMENTED_ELSEWHERE } from "./helpers/operator-env-vars";

/**
 * The operator docs' mechanical cross-references are checkable, so they are
 * checked. This is the narrowed 2026-07-30 doctrine: never guard a CLAIM by
 * scanning a document, but for a command name, a file path, an env var, or a
 * link, the document IS the artifact — there is no live surface to check
 * instead. Evidence this class ships: the README once documented
 * `npm exec supabase start` (npm eats the flag) as the second command a new
 * person types, and SELF_HOSTING documented OPENPLAN_INTEGRATION_KEY_SECRET
 * while .env.example omitted it. A manual sweep passed on 2026-08-04; this
 * guard is what makes that sweep repeatable.
 */

const REPO_ROOT = path.join(process.cwd(), "..");
const APP_ROOT = process.cwd();

const OPERATOR_DOCS = [
  path.join(REPO_ROOT, "README.md"),
  path.join(APP_ROOT, "docs", "FIRST_DEPLOYMENT.md"),
  path.join(APP_ROOT, "docs", "SELF_HOSTING.md"),
  // (2026-08-11) The plan-reading walkthrough. It is the first doc written for
  // the PLANNER rather than for whoever installs the software, and it earns a
  // place here for the same reason the other three are here: it names an OCR
  // worker directory, four env vars and a sibling doc, and every one of those
  // is a mechanical reference that can rot.
  path.join(APP_ROOT, "docs", "READING_AN_ADOPTED_PLAN.md"),
];

/** App env-var namespaces — generic ALL_CAPS words in prose are not env vars. */
const ENV_NAMESPACE = /^(OPENPLAN_|NEXT_PUBLIC_|SUPABASE_|RESEND_|CRON_|LODES_|ANTHROPIC_|CENSUS_|CHROME_)[A-Z0-9_]*$/;

/**
 * Env vars the docs may name that deliberately do NOT belong in .env.example,
 * each with its reason. Staleness-checked.
 */

function backtickTokens(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

function docName(file: string): string {
  return path.relative(REPO_ROOT, file);
}

describe("operator docs: mechanical cross-references resolve", () => {
  const docs = OPERATOR_DOCS.map((file) => ({ file, text: readFileSync(file, "utf8") }));

  it("every `npm run <script>` names a script that exists", () => {
    const appScripts = Object.keys(
      JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).scripts ?? {}
    );
    const harnessPackage = path.join(REPO_ROOT, "qa-harness", "package.json");
    const harnessScripts = existsSync(harnessPackage)
      ? Object.keys(JSON.parse(readFileSync(harnessPackage, "utf8")).scripts ?? {})
      : [];
    const known = new Set([...appScripts, ...harnessScripts]);

    const missing: string[] = [];
    for (const { file, text } of docs) {
      for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
        if (!known.has(match[1])) missing.push(`${docName(file)}: npm run ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every backticked repo path with a directory separator resolves", () => {
    const unresolved: string[] = [];
    for (const { file, text } of docs) {
      for (const token of backtickTokens(text)) {
        if (!token.includes("/")) continue;
        if (/[<>*{}$\s]|:\/\/|…/.test(token)) continue; // placeholder, URL, or template
        if (!/\.(md|ts|tsx|mjs|js|py|sql|toml|json|yml|yaml|css|example)$/.test(token)) continue;
        const candidates = [
          path.join(REPO_ROOT, token),
          path.join(APP_ROOT, token),
          path.join(path.dirname(file), token),
        ];
        if (!candidates.some((candidate) => existsSync(candidate))) {
          unresolved.push(`${docName(file)}: \`${token}\``);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("every app env var the docs name appears in .env.example (or is excused by name)", () => {
    const envExample = readFileSync(path.join(APP_ROOT, ".env.example"), "utf8");
    const excused = new Set(ENV_DOCUMENTED_ELSEWHERE.map((entry) => entry.name));
    const missing = new Set<string>();

    for (const { file, text } of docs) {
      for (const token of backtickTokens(text)) {
        // Expand brace groups like OPENPLAN_ENGAGEMENT_{SYNTHESIS,TRANSLATION}_MODEL.
        const braceMatch = /^([A-Z0-9_]*)\{([A-Z0-9_,]+)\}([A-Z0-9_]*)$/.exec(token);
        const names = braceMatch
          ? braceMatch[2].split(",").map((part) => `${braceMatch[1]}${part}${braceMatch[3]}`)
          : token.split(/[\s/]+/);
        for (const name of names) {
          if (!ENV_NAMESPACE.test(name)) continue;
          if (name.endsWith("_")) continue; // prefix families like OPENPLAN_AERIAL_PROCESSING_*
          if (excused.has(name)) continue;
          if (!envExample.includes(name)) missing.add(`${docName(file)}: ${name}`);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("every relative markdown link resolves", () => {
    const broken: string[] = [];
    for (const { file, text } of docs) {
      for (const match of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        const target = match[1];
        if (/^(https?:|mailto:)/.test(target)) continue;
        const candidates = [path.join(path.dirname(file), target), path.join(REPO_ROOT, target)];
        if (!candidates.some((candidate) => existsSync(candidate))) {
          broken.push(`${docName(file)}: (${target})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("the PR template's constraint pointer leads to real definitions", () => {
    // The template's checklist referenced README.md and CONTRIBUTING.md while
    // neither documented any of the constraints it names — box-ticking with
    // no definition (2026-08-03 review). The pointer now targets
    // CONTRIBUTING.md's "Product constraints" section; this pins that the
    // section exists and defines what the checklist asks about.
    const template = readFileSync(path.join(REPO_ROOT, ".github", "PULL_REQUEST_TEMPLATE.md"), "utf8");
    expect(template).toContain("CONTRIBUTING.md");
    const contributing = readFileSync(path.join(REPO_ROOT, "CONTRIBUTING.md"), "utf8");
    expect(contributing).toContain("## Product constraints");
    for (const term of ["hardcoded", "additive", "free and open source", "Self-service"]) {
      expect(contributing, `CONTRIBUTING.md must define "${term}"`).toContain(term);
    }
  });

  it("every excused env var is still absent from .env.example (ratchet)", () => {
    const envExample = readFileSync(path.join(APP_ROOT, ".env.example"), "utf8");
    const stale = ENV_DOCUMENTED_ELSEWHERE.filter((entry) => envExample.includes(entry.name)).map(
      (entry) => entry.name
    );
    expect(stale).toEqual([]);
  });
});
