/**
 * Every path that exports an RTP must export the SAME document.
 *
 * There are two, and they were built years apart: the direct export route
 * behind the "Export HTML/PDF" links a planner clicks (six call sites across
 * the cycle page, the document page and the report detail), and the
 * report-generate route that produces a board packet. The packet route passed
 * TEN options and the export route passed three, so anything wired to the
 * packet appeared in board packets and nowhere else — and nobody noticed,
 * because an absent option enabled every section and every section builder
 * answered an absence with an empty string. Two people comparing the two
 * documents were looking at different plans.
 *
 * WHAT CHANGED, AND WHY THIS GUARD CHANGED WITH IT. The first version of this
 * file scanned each ROUTE for the option names it passed. That was the right
 * check while each route assembled its own options bag — and it is the wrong
 * check now, because assembling an options bag in a route is exactly what is
 * forbidden. `buildRtpCycleExportInput` (`@/lib/rtp/export-input`) is the only
 * producer of a complete `RtpExportOptions`, and the routes consume its
 * `document` whole. So this guard asserts the SHAPE that makes divergence
 * impossible rather than the symptom it used to produce:
 *
 *   1. there is still more than one export path (or everything below is vacuous);
 *   2. no export path assembles the options bag itself;
 *   3. every export path gets its document from the shared builder;
 *   4. the shared builder populates EVERY field of `RtpExportOptions` — the
 *      runtime backstop for the type-level guarantee, which someone could
 *      otherwise switch off by widening the field back to optional;
 *   5. the projections carrying the plan's money live in the shared module, and
 *      no route re-declares one (the export route's own copy was missing
 *      `project_id` for exactly this reason);
 *   6. the documents may differ, but a difference is RENDERED, not silent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildRtpExportHtml, normalizeRtpLinkedProjects, type RtpExportOptions } from "@/lib/rtp/export";
import { buildPortfolioFundingSnapshot } from "@/lib/projects/funding";
import { buildRtpPublicReviewSummary } from "@/lib/rtp/catalog";
import { summarizeRtpFundingProfileScanReadiness } from "@/lib/rtp/export-input";

const APP_ROOT = process.cwd();
const SHARED_BUILDER_PATH = "src/lib/rtp/export-input.ts";
const RENDERER_PATH = "src/lib/rtp/export.ts";

function gitGrepFiles(pattern: string): string[] {
  // ripgrep-free: git grep is available everywhere the suite runs, and this
  // enumerates callers rather than trusting a hand-written list. `git grep`
  // exits 1 when nothing matches, which `execFileSync` throws on — an empty
  // list is a legitimate answer for the forbidden-name search below.
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-l", pattern, "--", "src/app"], {
      cwd: APP_ROOT,
      encoding: "utf8",
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
  }
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !path.includes("/test/"));
}

/**
 * Every route that renders an RTP document — enumerated from the SEALED
 * renderer, which is now the only way a route can turn one into HTML.
 */
function callerFiles(): string[] {
  return gitGrepFiles("renderRtpExportDocumentHtml");
}

function read(path: string): string {
  return readFileSync(join(APP_ROOT, path), "utf8");
}

/** The `{ … }` body that starts at `openIndex`, balanced, braces excluded. */
function balancedBlock(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new Error(`unbalanced block at ${openIndex}`);
}

/**
 * Top-level `key:` names in a `{ … }` body, ignoring nested objects, comments
 * and strings. Indentation is deliberately NOT used — a reformat must not be
 * able to make this guard stop seeing a field.
 */
function topLevelKeys(body: string, options?: { shorthand?: boolean }): string[] {
  const keys: string[] = [];
  let depth = 0;
  let index = 0;
  while (index < body.length) {
    const char = body[index];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (char === "/" && body[index + 1] === "/") {
      index = body.indexOf("\n", index);
      if (index === -1) break;
    } else if (char === "/" && body[index + 1] === "*") {
      index = body.indexOf("*/", index) + 2;
      continue;
    } else if (char === '"' || char === "'" || char === "`") {
      index += 1;
      while (index < body.length && body[index] !== char) {
        if (body[index] === "\\") index += 1;
        index += 1;
      }
    } else if (depth === 0 && /[A-Za-z_]/.test(char)) {
      const rest = body.slice(index);
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/.exec(rest);
      if (match) {
        keys.push(match[1]);
        index += match[0].length;
        continue;
      }
      // `sectionKeys,` — an object literal's shorthand property is still a
      // supplied field, and reading only `key:` form made this guard miss one.
      // It must START a property, or the tail of `a.b.kind,` reads as one:
      // that mis-parse was real and this line is why it is not.
      const previous = body.slice(0, index).trimEnd().slice(-1);
      const startsProperty = previous === "" || previous === ",";
      const shorthand = options?.shorthand && startsProperty
        ? /^([A-Za-z_][A-Za-z0-9_]*)\s*(?=[,}])/.exec(rest)
        : null;
      if (shorthand) {
        keys.push(shorthand[1]);
        index += shorthand[0].length;
        continue;
      }
      while (index < body.length && /[A-Za-z0-9_]/.test(body[index])) index += 1;
      continue;
    }
    index += 1;
  }
  return keys;
}

function optionFieldNames(): string[] {
  const source = read(RENDERER_PATH);
  const declaration = "export type RtpExportOptions = {";
  const start = source.indexOf(declaration);
  expect(start, `${RENDERER_PATH} no longer declares RtpExportOptions`).toBeGreaterThan(-1);
  return topLevelKeys(balancedBlock(source, start + declaration.length - 1));
}

function sharedBuilderOptionKeys(): string[] {
  const source = read(SHARED_BUILDER_PATH);
  const marker = "      options: {";
  const start = source.indexOf(marker);
  expect(start, `${SHARED_BUILDER_PATH} no longer builds an options bag`).toBeGreaterThan(-1);
  return topLevelKeys(balancedBlock(source, start + marker.length - 1), { shorthand: true });
}

describe("both RTP export paths render the same document from one builder", () => {
  it("finds more than one export path, or this guard is guarding nothing", () => {
    // If someone consolidates to a single path this assertion should be
    // revisited deliberately — but a silent drop to one caller would otherwise
    // make every assertion below vacuously true.
    expect(callerFiles().length).toBeGreaterThan(1);
  });

  it("lets no export path assemble the options bag itself", () => {
    // A route that passes an object literal is a route deciding what its own
    // document contains — which is how the two drifted apart. The only legal
    // argument is an identifier holding `buildRtpCycleExportInput`'s document.
    for (const file of callerFiles()) {
      const source = read(file);
      for (const match of source.matchAll(/renderRtpExportDocumentHtml\(\s*([\s\S]{0,2})/g)) {
        expect(
          match[1].trimStart().startsWith("{"),
          `${file} passes an inline object to renderRtpExportDocumentHtml, so it decides its own document contents instead of taking them from buildRtpCycleExportInput`
        ).toBe(false);
      }
    }
  });

  /**
   * THE SEAL, AND WHY THE GUARANTEE ABOVE NEEDED ONE.
   *
   * "Neither route may construct an options bag" was a true intention and a
   * false statement. Proven by mutation: replacing `const exportInput =
   * built.document;` in the export route with
   *
   *   const exportInput = { ...built.document, options: { ...built.document.options, commentResponse: null } };
   *
   * compiled and left the entire suite green — a route could still delete a
   * section of a board document one line after the shared builder decided it.
   *
   * The structural fix is the `#private`-field envelope in `export-input.ts`:
   * outside that module the payload cannot be reached, a spread yields `{}`
   * that TypeScript refuses, and the renderer throws on it at runtime. These
   * two assertions hold the rest — a route must not reach the raw renderer, and
   * must not try to copy the sealed document on the way to the sealed one.
   */
  it("keeps the raw renderer out of every route, so the sealed document is the only input", () => {
    expect(
      gitGrepFiles("buildRtpExportHtml"),
      "a route imports buildRtpExportHtml directly; the raw renderer accepts a PARTIAL options bag, which is exactly how the two documents drifted apart"
    ).toEqual([]);
  });

  it("lets no route spread, re-key or reassign the document the shared builder sealed", () => {
    for (const file of callerFiles()) {
      const source = read(file);
      // `...built.document`, `...x.document` — a copy is the shape an override
      // takes, and it must not appear even in a form the compiler now rejects:
      // this failure names the rule, where a type error names a symbol.
      expect(
        /\.\.\.\s*[A-Za-z_$][\w$]*\s*\.\s*document\b/.test(source),
        `${file} spreads the sealed export document, which is how a route overrides an option the shared builder decided`
      ).toBe(false);
      expect(
        /\bdocument\s*\.\s*options\b/.test(source),
        `${file} reaches into the sealed document's options bag`
      ).toBe(false);
    }
  });

  it("gets every exported document from the shared builder", () => {
    for (const file of callerFiles()) {
      const source = read(file);
      expect(
        /buildRtpCycleExportInput\s*\(/.test(source),
        `${file} renders an RTP document without calling buildRtpCycleExportInput`
      ).toBe(true);
      expect(
        source.includes("@/lib/rtp/export-input"),
        `${file} does not import from @/lib/rtp/export-input`
      ).toBe(true);
    }
  });

  it("populates EVERY option the renderer declares, from the one place that builds them", () => {
    // The type already fails the build if a field is added and not supplied —
    // but only while every field stays required. Widening one back to optional
    // is a one-character change that would restore the original defect
    // silently, so the field list is also checked here, derived from the
    // declaration rather than written down.
    const declared = optionFieldNames();
    const supplied = sharedBuilderOptionKeys();

    expect(declared.length).toBeGreaterThan(5);
    for (const field of declared) {
      expect(
        supplied.includes(field),
        `buildRtpCycleExportInput does not supply \`${field}\`, so whichever document is missing it renders that section's absence instead of its content`
      ).toBe(true);
    }
    // And the reverse: a key supplied here that the renderer never declared is
    // a field somebody renamed on one side only.
    for (const field of supplied) {
      expect(
        declared.includes(field),
        `buildRtpCycleExportInput supplies \`${field}\`, which RtpExportOptions does not declare`
      ).toBe(true);
    }
  });

  it("keeps every option required, so a new one cannot be added to one document only", () => {
    const source = read(RENDERER_PATH);
    const declaration = "export type RtpExportOptions = {";
    const body = balancedBlock(source, source.indexOf(declaration) + declaration.length - 1);
    // `field?:` at the top level would let the shared builder omit it and both
    // routes type-check, which is the original defect exactly.
    let depth = 0;
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      if (char === "{" || char === "(" || char === "[") depth += 1;
      else if (char === "}" || char === ")" || char === "]") depth -= 1;
      else if (depth === 0 && char === "?" && body[index + 1] === ":") {
        const before = body.slice(0, index).split("\n").pop() ?? "";
        expect(
          false,
          `RtpExportOptions declares an OPTIONAL field (${before.trim()}?), so the shared builder could omit it and one document would silently lose that section`
        ).toBe(true);
      }
    }
  });

  it("declares the money projections once, and lets no route re-declare one", () => {
    const shared = read(SHARED_BUILDER_PATH);
    // Reads the PROJECTION CONSTANT, not the file. A plain
    // `source.includes("project_id")` stays green while the projection is
    // broken, because `profile.project_id` elsewhere in the same module
    // contains the same characters — proven by mutation, which is the only
    // reason this parses the string literal.
    function projection(name: string): string {
      const match = new RegExp(`${name}\\s*=\\s*\n?\\s*"([^"]*)"`).exec(shared);
      expect(match, `${SHARED_BUILDER_PATH} no longer declares ${name}`).not.toBeNull();
      return match![1];
    }

    const linkColumns = projection("RTP_EXPORT_LINKED_PROJECT_COLUMNS");
    for (const column of ["project_id", "estimated_cost", "cost_basis_year", "horizon_band_id"]) {
      expect(
        linkColumns.includes(column),
        `RTP_EXPORT_LINKED_PROJECT_COLUMNS no longer selects ${column}; the project lists would export every project as "no cost recorded"`
      ).toBe(true);
    }
    const cycleColumns = projection("RTP_EXPORT_CYCLE_COLUMNS");
    for (const column of ["annual_inflation_rate", "financial_basis_year"]) {
      expect(
        cycleColumns.includes(column),
        `RTP_EXPORT_CYCLE_COLUMNS no longer selects ${column}; the fiscal finding would report constant dollars while the plan records an inflation assumption`
      ).toBe(true);
    }

    // Scans `.select("…")` literals only. A plain substring search passes while
    // a projection is broken, because `link.estimated_cost` elsewhere in the
    // same file contains the same characters — found by mutation, which is the
    // only reason this reads the select strings.
    for (const file of callerFiles()) {
      const projections = [...read(file).matchAll(/\.select\(\s*"([^"]*)"/g)].map((match) => match[1]);
      for (const projection of projections) {
        expect(
          projection.includes("estimated_cost") || projection.includes("horizon_band_id"),
          `${file} declares its own RTP link projection ("${projection}") instead of using the shared one, which is how the export route's copy came to be missing project_id`
        ).toBe(false);
      }
    }
  });
});

describe("a difference between the two RTP documents is rendered, never silent", () => {
  const subject = {
    cycle: {
      id: "cycle-1",
      workspace_id: "workspace-1",
      title: "2027 Regional Transportation Plan",
      status: "public_review",
      geography_label: "Example County",
      horizon_start_year: 2027,
      horizon_end_year: 2050,
      adoption_target_date: null,
      public_review_open_at: null,
      public_review_close_at: null,
      summary: null,
      updated_at: "2026-04-24T00:00:00.000Z",
    },
    chapters: [],
    linkedProjects: normalizeRtpLinkedProjects([]),
    campaigns: [],
    priorityCriteria: [],
  };

  function render(options: Partial<RtpExportOptions>): string {
    return buildRtpExportHtml({ ...subject, options });
  }

  it("says a whole-plan export is one", () => {
    const html = render({ composition: "whole_plan", sectionKeys: [] });
    expect(html).toContain("How this document was composed:");
    expect(html).toContain("whole-plan export");
  });

  it("names the sections a report-composed packet leaves out", () => {
    const html = render({
      composition: "report_sections",
      sectionKeys: ["cycle_overview", "financial_element"],
    });
    // Not just "here is what is included" — a reader cannot see an omission in
    // a list of inclusions, and an omitted section is the difference that
    // matters between a packet and a whole-plan export.
    expect(html).toContain("are excluded from this document");
    expect(html).toContain("Comment Response");
  });

  /**
   * BOTH POLARITIES, AND THE SECOND ONE IS THE POINT.
   *
   * Each of these three tests asserted only that the absence sentence APPEARS
   * when the data is absent. All three passed with the absence paragraph made
   * UNCONDITIONAL — proven by mutation, suite green each time — so a board
   * document that carried real modeling evidence, a real funding basis and a
   * real public-review posture AND declared all three absent was a green
   * result. Asserting the sentence is GONE when the data is there is what makes
   * these tests about the condition rather than about the string.
   */
  it("states the absence of modeling evidence, and stops saying so once evidence is there", () => {
    const absent = render({ composition: "whole_plan", modelingEvidence: [] });
    expect(absent).toContain("Assignment modeling claim posture");
    expect(absent).toContain("makes no assignment-model claim");

    const present = render({
      composition: "whole_plan",
      modelingEvidence: [
        {
          countyRunId: "run-1",
          runName: "Example County screening run",
          geographyLabel: "Example County",
          stage: "assignment",
          updatedAt: "2026-04-05T00:00:00.000Z",
          evidence: null,
        },
      ],
    });
    expect(present).toContain("Assignment modeling claim posture");
    expect(present).toContain("Example County screening run");
    expect(present).not.toContain("makes no assignment-model claim");
  });

  it("states the absence of a funding basis, and stops saying so once a basis is there", () => {
    const absent = render({
      composition: "whole_plan",
      fundingSnapshot: null,
      fundingProfileScans: [],
      fundingSourceContextReadiness: null,
    });
    expect(absent).toContain("Funding source context");
    expect(absent).toContain("No portfolio funding snapshot was captured.");
    expect(absent).toContain("No funding source-context readiness was captured");

    // Built by the real builders, never described: a hand-written snapshot
    // proves the assertion and not the feature.
    const present = render({
      composition: "whole_plan",
      fundingSnapshot: buildPortfolioFundingSnapshot({
        projects: [
          {
            projectUpdatedAt: "2026-04-01T00:00:00.000Z",
            profile: {
              project_id: "project-1",
              funding_need_amount: 12000000,
              local_match_need_amount: 1200000,
              updated_at: "2026-04-03T00:00:00.000Z",
            },
            awards: [],
            opportunities: [],
            invoices: [],
          },
        ],
        capturedAt: "2026-04-24T00:00:00.000Z",
      }),
      fundingProfileScans: [],
      fundingSourceContextReadiness: summarizeRtpFundingProfileScanReadiness([], {
        modelingEvidenceCount: 0,
        engagementReadyForHandoffCount: 0,
        enabledSectionCount: 1,
      }),
    });
    expect(present).toContain("Funding source context");
    expect(present).not.toContain("No portfolio funding snapshot was captured.");
    expect(present).not.toContain("No funding source-context readiness was captured");
  });

  it("states the absence of a public-review posture, and stops saying so once one is supplied", () => {
    const absent = render({ composition: "whole_plan", publicReviewSummary: null });
    expect(absent).toContain("No public-review posture was supplied");

    const present = render({
      composition: "whole_plan",
      publicReviewSummary: buildRtpPublicReviewSummary({
        status: "public_review",
        publicReviewOpenAt: "2026-09-01T00:00:00.000Z",
        publicReviewCloseAt: "2026-10-15T00:00:00.000Z",
        cycleLevelCampaignCount: 1,
        chapterCampaignCount: 0,
        packets: { examined: false },
        pendingCommentCount: 0,
        approvedCommentCount: 1,
        readyCommentCount: 1,
      }),
    });
    expect(present).not.toContain("No public-review posture was supplied");
    expect(present).toContain("cycle targets");
  });
});
