import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripSourceComments } from "@/test/helpers/source-text";

/*
  PLANNER PAGES CARRY NO BUILD NOTES.

  Nathaniel, October 10, 2026: "There are also some weird notes in there that
  shouldn't even be public facing." Regional Plan ended with "Next slice: What
  comes next", a roadmap for the code; five pages told planners to "apply the
  Lane C migration"; the RTP cycle page said "No chapter shell yet". The
  overhaul removed them (docs/reviews/2026-10-10-ui-overhaul/PLAN.md, section
  6, rule 5). This keeps them out.

  It reads every string the app's pages and components can render, not only
  JSX text nodes: props, ternaries and template literals carry most of the
  words, and the older vocabulary guard sees text nodes only. Comments are
  stripped first, because a comment is where a build note belongs.

  OPERATOR VOCABULARY (October 13, 2026). The two-month review found the same
  defect in other words: a code roadmap ending in a "CARTO workflow lane" under
  every Corridor Analysis result, a "queue lane" console on the RTP index,
  "Open control lane" links on the project page, and about twenty sentences
  that told a planner to apply a migration or set an environment variable
  (docs/reviews/2026-10-12-two-month-review/reports/code-frontend.md, findings
  1 and 2). Those words are allowed in one place: the operator's disclosure.
  So the second set of rules reads the text a planner sees BEFORE opening
  anything, which means everything outside:

    - an `<OperatorDetail>` or `<details>` element's children,
    - a `<SetupPendingNotice>` element's children (its operator half),
    - a string given to an `operatorDetail` property or prop, or assigned to
      a variable whose name ends in `OperatorDetail`,
    - a string handed to `console.*`.

  Blind categories, stated so a green run is not read as "the copy is clean":
  notes phrased in words not on these lists; a phrase split across a template
  interpolation (`${"next"} slice`); operator copy passed through a variable
  and rendered outside a disclosure (the string is read where it is written,
  not where it renders); `src/lib` strings other than the files listed below;
  API route files for the operator rules (about 340 of them, whose error bodies
  reach a planner only through a caller that chooses to show them; the shared
  helpers most routes use to write those bodies are scanned instead); and
  exported documents.
*/
const ROOTS = ["src/app", "src/components"].map((dir) => path.join(process.cwd(), dir));

/**
 * `src/lib` files whose strings reach the screen. Listed, not globbed: `src/lib`
 * is mostly projections, enum values and log lines, and a guard drowning in
 * those gets silenced rather than read.
 */
const RENDERED_LIB_FILES = [
  "src/lib/http/read-outcome.ts",
  // The workspace command queue: its titles and details are the dashboard's and
  // the Grants page's "what to do next" lines.
  "src/lib/operations/workspace-summary.ts",
  "src/lib/rtp/export-input.ts",
  "src/lib/ui/setup-pending.ts",
].map((file) => path.join(process.cwd(), file));

const BUILD_NOTES: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\b(?:next|this|first|later) slice\b/i, why: "a delivery slice is how the code was built, not the planner's work" },
  { pattern: /\bwhy this slice\b/i, why: "a delivery slice is how the code was built" },
  { pattern: /\bLane [A-Z]\b/, why: "the name of an internal work stream" },
  { pattern: /\bautomation theater\b/i, why: "a design note to other developers" },
  { pattern: /\b(?:cycle|chapter|record) shell\b/i, why: "scaffolding vocabulary from the build" },
  { pattern: /\bNext (?:domain|output)\b/, why: "the roadmap panel removed on October 10, 2026" },
  { pattern: /\bno longer just\b/i, why: "a changelog line about the build, not the planner's work" },
  { pattern: /\bNext layer buildout\b/i, why: "the Corridor Analysis code roadmap removed on October 13, 2026" },
];

/**
 * A lane on a road is the profession's word ("bike lane", "lane miles").
 * Those phrases are removed before the system-sense rule looks.
 */
const ROADWAY_LANES =
  /\b(?:bike|bicycle|bus|travel|turn(?:ing)?|traffic|through|general[- ]purpose|HOV|HOT|express|managed|transit|carpool|truck|passing|auxiliary|climbing|shared|parking|center|left|right|one|two|three|four|six|added|vehicle)[- ]lanes?\b|\blanes?[- ]miles?\b|\blane (?:width|count|closure)s?\b|\bnumber of lanes\b/gi;

type OperatorRule = { name: string; finds: (text: string) => boolean; why: string };

const OPERATOR_VOCABULARY: ReadonlyArray<OperatorRule> = [
  {
    name: "lane",
    finds: (text) => /\blanes?\b/i.test(text.replace(ROADWAY_LANES, " ")),
    why: "how the page or the work was built; a planner reads a lane as part of a road. Name the thing the link opens",
  },
  {
    name: "custody",
    finds: (text) => /\bcustody\b/i.test(text),
    why: "storage plumbing; say what was saved and what it can and cannot support",
  },
  {
    name: "receipt",
    finds: (text) =>
      /\b(?:command|server|queue|scheduling|decision|change|hold|submittal|history|execution) receipts?\b/i.test(text),
    why: "a system acknowledgement, not a receipt a planner files",
  },
  {
    name: "operator-facing",
    finds: (text) => /\boperator[- ]facing\b/i.test(text),
    why: "says who the text was written for instead of saying the thing",
  },
  {
    name: "migration",
    finds: (text) => /\bmigrations?\b/i.test(text),
    why: "a planner cannot apply a migration; use SetupPendingNotice and put the migration in its OperatorDetail",
  },
  {
    name: "environment variable",
    finds: (text) => /\b(?:OPENPLAN|NEXT_PUBLIC)_[A-Z0-9_]{2,}\b/.test(text),
    why: "a planner cannot set a server variable; use MapUnavailableNotice or SetupPendingNotice",
  },
  {
    name: "SHA-256",
    finds: (text) => /\bSHA-?256\b/i.test(text),
    why: "a file hash is evidence for an auditor; label it inside OperatorDetail",
  },
];

/**
 * Where a rule's word is the right word in front of the reader. Kept short;
 * each entry needs a reason a reviewer would accept.
 */
const OPERATOR_VOCABULARY_ALLOWED: ReadonlyArray<{ file: string; rule: string; why: string }> = [
  {
    file: "src/components/workspaces/workspace-integration-keys-panel.tsx",
    rule: "environment variable",
    why: "Workspace setup's provider-key panel is read by the administrator configuring keys; the server setting it names is the fix they hand on",
  },
  {
    file: "src/components/dashboard/build-identity-line.tsx",
    rule: "environment variable",
    why: "the build line exists to name the running build; when it cannot, the setting that would let it is the only fact worth showing (a-deployment-can-name-itself)",
  },
  // Not yet reworded, each owned elsewhere. Remove the entry when the file is.
  {
    file: "src/components/data-hub/managed-gtfs-imports.tsx",
    rule: "receipt",
    why: "the transit import panel belongs to the active GTFS lane (COORDINATION.md); its command receipts are that lane's to reword",
  },
  {
    file: "src/components/engagement/synthesis-queue-panel.tsx",
    rule: "receipt",
    why: "the engagement synthesis panels get their own words pass (two-month review, finding 7)",
  },
  {
    file: "src/components/engagement/synthesis-queue-panel.tsx",
    rule: "custody",
    why: "the engagement synthesis panels get their own words pass (two-month review, finding 7)",
  },
];

/** Public marketing copy that legitimately describes the product's roadmap. */
const ALLOWED_FILES = new Set(["src/app/(public)/examples/page.tsx"]);

const STRING_SOURCE = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`";
const STRING_LITERAL = new RegExp(STRING_SOURCE, "g");
const JSX_TEXT = new RegExp(">([^<>{}]{3,})<", "gs");

/** Things a sentence on screen does not contain and an expression does. */
const LOOKS_LIKE_CODE = /!==|===|&&|\|\||\?\?|=>|\.\w+\(|;\s*$|\b(?:const|let|return|function|import)\b/;

/** Elements whose children are addressed to whoever runs the installation. */
const DISCLOSURE_TAGS = ["OperatorDetail", "SetupPendingNotice", "details"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

function renderableText(source: string): string[] {
  const code = stripSourceComments(source);
  return [...(code.match(STRING_LITERAL) ?? []), ...[...code.matchAll(JSX_TEXT)].map((match) => match[1])];
}

/**
 * Source with the operator's half removed. The opening tag of a disclosure is
 * kept, because its attributes (a `consequence`, a `summary`) are read by the
 * planner; its children are dropped. The opening tag may contain `=>` but not a
 * bare `>`, and a self-closing tag has no children to drop.
 */
function withoutOperatorCopy(code: string): string {
  let out = code;
  for (const tag of DISCLOSURE_TAGS) {
    out = out.replace(new RegExp(`(<${tag}\\b(?:=>|[^>=]|=(?!>))*(?<!/)>)[\\s\\S]*?</${tag}>`, "g"), "$1");
  }
  out = out.replace(/\b(?:const|let)\s+\w*[oO]peratorDetail\b[^;]*;/g, " ");
  out = out.replace(new RegExp(String.raw`\w*[oO]peratorDetail\??\s*[:=]\s*\{?\s*(?:${STRING_SOURCE})`, "g"), " ");
  out = out.replace(new RegExp(String.raw`console\.\w+\(\s*(?:${STRING_SOURCE})`, "g"), " ");
  return out;
}

/** What a planner reads before opening anything: sentences, not identifiers. */
function plannerText(source: string): string[] {
  const code = withoutOperatorCopy(stripSourceComments(source));
  const strings = (code.match(STRING_LITERAL) ?? [])
    // An interpolation stands in as one token, so `SHA-256 ${hash}` is still a
    // label. The token is not a letter: with "x", `lane${plural}` read as
    // "lanex", and "1 project funding lane has" reached the dashboard unseen.
    .map((literal) => literal.slice(1, -1).replace(/\$\{[^}]*\}/g, "#"))
    .filter((text) => /\S\s+\S/.test(text));
  const jsx = [...code.matchAll(JSX_TEXT)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((text) => text && !LOOKS_LIKE_CODE.test(text));
  return [...strings, ...jsx];
}

function operatorVocabularyIn(source: string): Array<{ rule: string; text: string }> {
  const found: Array<{ rule: string; text: string }> = [];
  for (const text of plannerText(source)) {
    for (const rule of OPERATOR_VOCABULARY) {
      if (rule.finds(text)) found.push({ rule: rule.name, text });
    }
  }
  return found;
}

const relative = (file: string) => path.relative(process.cwd(), file);

const files = [...ROOTS.flatMap(sourceFiles), ...RENDERED_LIB_FILES].filter(
  (file) => !ALLOWED_FILES.has(relative(file)) && !file.includes(`${path.sep}test${path.sep}`)
);

const plannerFiles = files.filter((file) => !relative(file).startsWith(path.join("src", "app", "api") + path.sep));

describe("planner pages carry no build notes", () => {
  it("reads a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(500);
    for (const lib of RENDERED_LIB_FILES) expect(files).toContain(lib);
  });

  it("finds no build note in any string a page can render", () => {
    const findings: string[] = [];
    for (const file of files) {
      for (const text of renderableText(readFileSync(file, "utf8"))) {
        for (const note of BUILD_NOTES) {
          if (note.pattern.test(text)) {
            findings.push(`${relative(file)}: "${text.trim().slice(0, 100)}" (${note.why})`);
          }
        }
      }
    }
    expect(findings).toEqual([]);
  });

  it("puts operator vocabulary only where the operator reads it", () => {
    const findings: string[] = [];
    for (const file of plannerFiles) {
      for (const { rule, text } of operatorVocabularyIn(readFileSync(file, "utf8"))) {
        if (OPERATOR_VOCABULARY_ALLOWED.some((allowed) => allowed.file === relative(file) && allowed.rule === rule)) {
          continue;
        }
        const why = OPERATOR_VOCABULARY.find((entry) => entry.name === rule)?.why;
        findings.push(`${relative(file)}: [${rule}] "${text.replace(/\s+/g, " ").trim().slice(0, 100)}" (${why})`);
      }
    }
    expect(findings).toEqual([]);
  });

  it("keeps every allowance pointed at a file that still needs it", () => {
    for (const allowed of OPERATOR_VOCABULARY_ALLOWED) {
      const source = readFileSync(path.join(process.cwd(), allowed.file), "utf8");
      expect(
        operatorVocabularyIn(source).some((found) => found.rule === allowed.rule),
        `${allowed.file} no longer uses ${allowed.rule}; delete its allowance`
      ).toBe(true);
    }
  });

  /*
    SEEDED CONTROLS. Each new rule must catch the sentence that leaked, in the
    form it leaked, and must let the same fact through once it sits in the
    operator's disclosure. Without these, every rule above could pass by
    matching nothing.
  */
  it("catches each leaked phrase in front of a planner", () => {
    const leaked: Array<[string, string]> = [
      ["lane", `<p>Open control lane</p>`],
      ["lane", `const label = "Primary queue lane";`],
      // The plural sat in an interpolation right after the word (workspace-summary.ts, October 2026).
      ["lane", "const detail = `${n} project funding lane${n === 1 ? \" has\" : \"s have\"} no funding target.`;"],
      ["custody", `<p>Loading decision custody…</p>`],
      ["receipt", `const note = "No server queue receipt was found for this allowance.";`],
      ["operator-facing", `const d = "Operator-facing summary of the current run.";`],
      ["migration", `<div className="module-alert">Apply the latest migrations and reload.</div>`],
      ["migration", `const hint = "Apply the latest Supabase migrations, then try again.";`],
      ["environment variable", `<p>Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public token.</p>`],
      ["environment variable", `const m = "Check OPENPLAN_PUBLIC_BASEMAPS and rebuild.";`],
      ["SHA-256", `<p className="label">Diagnosis SHA-256</p>`],
      ["SHA-256", "const label = `SHA-256 ${sha256}`;"],
    ];
    for (const [rule, source] of leaked) {
      expect(
        operatorVocabularyIn(source).map((found) => found.rule),
        `the ${rule} rule missed: ${source}`
      ).toContain(rule);
    }
  });

  it("lets the same facts through inside the operator's disclosure, and roads keep their lanes", () => {
    const clean = [
      `<OperatorDetail><p>Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN and rebuild.</p></OperatorDetail>`,
      `<OperatorDetail className="text-left"><p>{"Apply migration 20260728000009, then reload."}</p></OperatorDetail>`,
      `<SetupPendingNotice className="mt-5" consequence="Assignees are not shown.">
        This deployment is behind migration 20260811000006.
      </SetupPendingNotice>`,
      `<details><summary>For whoever runs this</summary><p>Manifest SHA-256</p></details>`,
      `notices.push({ text: "The map cannot draw.", operatorDetail: "The custody read failed." });`,
      `const projectAreaOperatorDetail = pending ? "Apply migration 20260728000009." : null;`,
      `console.warn("[backdrop] NEXT_PUBLIC_MAPBOX token must use a public pk.* token");`,
      `<p>Two travel lanes and a bike lane, 14.2 lane miles in good condition.</p>`,
      `const path = "./_components/receivables-lane";`,
      `<li>{lane.label}</li>`,
      "const href = `/api/workspaces/${id}/migrations`;",
      "const label = `${count} bike lane${count === 1 ? \"\" : \"s\"}`;",
    ];
    for (const source of clean) {
      expect(operatorVocabularyIn(source), source).toEqual([]);
    }
    // The opening tag is still the planner's: a consequence that names a
    // migration is caught even though the children are not.
    expect(
      operatorVocabularyIn(`<SetupPendingNotice consequence="Apply the migration first.">x</SetupPendingNotice>`).map(
        (found) => found.rule
      )
    ).toContain("migration");
  });
});

/*
  PLANNER AGENT'S FUNDING WORDS (October 14, 2026). The assistant panel counted
  "project funding lanes" and "project reimbursement lanes", offered "Create
  funding need anchor", and sent the prompt "Which funding lane should move
  next?" on a planner's behalf. A planner counts projects and opens invoices.
  The two files that write those sentences are read here.

  They are not in RENDERED_LIB_FILES above, because the full rules would also
  flag words other passes own in the same files (the aerial answers' "artifact
  custody", the "Evidence lane ready" label, the "RTP registry lane"), and a
  whole-file allowance would let these phrases back. So this rule is narrower:
  "lane" after a funding or grant word, and the funding "anchor".

  It reads the source with comments removed, not string literals. Both files
  nest template literals, which the string scanner above splits at the inner
  backtick, so half of each sentence would fall between two "strings". Reading
  the source instead, an identifier (`fundingAnchorCommand`, the id
  "workspace-open-reimbursement-lane", the event "open_reimbursement_lane")
  never matches, because the rule needs a space before "lane" or "anchor".

  Blind categories: "lane" after a word not on the list ("the reporting lane");
  a phrase split by an interpolation (`funding ${"lane"}`); a wrong plural,
  which the assistant-respond tests pin instead; and every other file.
*/
const ASSISTANT_FUNDING_FILES = ["src/lib/assistant/operations.ts", "src/lib/assistant/respond.ts"];

const ASSISTANT_FUNDING_WORDS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\b(?:funding|reimbursement|grants?|award|billing|invoicing|decision|conversion|strategy|posture|operating|project)[ \t]+lanes?\b/gi,
    why: "count the projects, or name the page or record the link opens",
  },
  {
    pattern: /\b(?:funding(?:[- ]need)?|profile|need|missing)[ \t]+anchors?\b|\bnot anchored\b/gi,
    why: "the record is the project's funding target",
  },
];

function assistantFundingWordsIn(source: string): string[] {
  const code = stripSourceComments(source);
  return ASSISTANT_FUNDING_WORDS.flatMap(({ pattern, why }) =>
    [...code.matchAll(pattern)].map((match) => `"${match[0]}" (${why})`)
  );
}

describe("Planner Agent's funding answers name projects, not lanes", () => {
  it("reads both assistant files", () => {
    for (const file of ASSISTANT_FUNDING_FILES) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8").length, file).toBeGreaterThan(50_000);
    }
  });

  it("finds no funding lane or funding anchor in either file", () => {
    const findings = ASSISTANT_FUNDING_FILES.flatMap((file) =>
      assistantFundingWordsIn(readFileSync(path.join(process.cwd(), file), "utf8")).map((found) => `${file}: ${found}`)
    );
    expect(findings).toEqual([]);
  });

  it("catches each phrase in the form it shipped, and lets identifiers and roads through", () => {
    const leaked = [
      'const s = `, ${n} funding lane${n === 1 ? " still needs" : "s still need"} sourcing`;',
      'const s = `${n} project reimbursement lane${n === 1 ? " is" : "s are"} active`;',
      "const p = `What should be reviewed next on this package funding lane?`;",
      'const p = "A lead project funding profile anchor was created. Which funding lane should move next?";',
      'quickLink("project-create-funding-profile", "Create funding need anchor", href, {});',
      'const label = "Review missing funding anchors in panel";',
      'const r = "so the grants lane is not anchored at the project level yet.";',
      'const label = "Open lead award conversion lane";',
    ];
    for (const source of leaked) {
      expect(assistantFundingWordsIn(source), source).not.toEqual([]);
    }
    const clean = [
      'quickLink("workspace-open-reimbursement-lane", "Open lead reimbursement invoice", href, { auditEvent: "assistant.operation.workspace.open_reimbursement_lane" });',
      "const fundingAnchorCommand = queue.find((item) => item.key === \"anchor-project-funding-needs\");",
      'const label = "Delivery anchor";',
      'const s = "Two travel lanes and a bike lane on the funded segment.";',
      "// The project funding lane is where this used to live.",
    ];
    for (const source of clean) {
      expect(assistantFundingWordsIn(source), source).toEqual([]);
    }
  });
});
