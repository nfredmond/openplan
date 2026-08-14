import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripSourceComments } from "@/test/helpers/source-text";

/**
 * THE WORKLIST RULE, ON THE SURFACES WHERE CARDS ARE THE RIGHT ANSWER.
 *
 * Nathaniel, after using OpenPlan as a human for the first time (2026-08-13):
 * "it's too 'card' heavy in the UI, I still want to use cards, but it's ONLY
 * cards and when they get super nested it gets confusing."
 *
 * On the dashboard, /my-work and the index pages he is right twice over. A
 * worklist is a set of comparable things a planner scans and chooses between,
 * and a card is the device that makes two of them comparable at a glance — so
 * the card is not the defect here. THE DEPTH IS. The interface standard
 * ("Plain Words, Fewer Boxes", 2026-08-13) sets the limit at three frames
 * counting the page shell: shell › section › item card. A box inside an item
 * card is the fourth, and there is no hierarchy left to spend on it.
 *
 * WHY THIS EXISTS ALONGSIDE THE BROWSER AUDIT, RATHER THAN INSTEAD OF IT.
 * `qa-harness/openplan-local-card-nesting-audit.js` measures the real box model
 * in real Chrome and is the authority on what a page LOOKS like. It has two
 * blind spots this file is built for, and neither is fixable there:
 *
 *   1. IT ONLY SEES WHAT THE SIGNED-IN WORKSPACE RENDERS. The nested panel this
 *      lane removed from the project card (`grantModelingEvidence`, projects
 *      page) only renders for a project that already has grant modeling
 *      evidence. On the near-empty workspace the budget was seeded from, that
 *      branch never ran, so /projects measured a clean depth 3 while carrying a
 *      depth-4 box for any agency with real data. A source guard sees the
 *      branch whether or not today's data reaches it.
 *
 *   2. IT CANNOT SEE A TINT. A box, to a reader, is a frame — and a filled
 *      panel with a radius and no border is a frame. The audit counts borders,
 *      so swapping a border for a background tint would show up there as an
 *      improvement no reader can perceive. The standard names that evasion and
 *      refuses it; the third test below is the refusal, as an equality.
 *
 * WHAT IT CANNOT DO, so a green run is not over-read:
 *   - It reads `className` string literals. A class list built by `cn()` from
 *     variables, or one that arrives as a prop, is invisible to it.
 *   - It infers containment from INDENTATION, not from a parsed tree. The repo
 *     is uniformly formatted, so an item card's subtree is exactly the more
 *     indented lines that follow it; a hand-formatted file could hide from
 *     this, and would also be the only file in the repository shaped that way.
 *   - It says nothing about whether a card is LEGITIMATE — the standard's five
 *     tests (two or more siblings, one component from one array, the reader's
 *     job is to pick, three to five facts, one click target) are judgement, and
 *     judgement does not go in a test.
 *   - jsdom applies no stylesheet and has no box model. Nothing here is
 *     rendered; every number in it comes from source text. DENSITY, SPACING AND
 *     ACTUAL NESTING DEPTH ARE MEASURED IN CHROME, not here.
 *
 * MUTATION-VERIFIED 2026-08-13 — see the round report for which mutation
 * produced which failure.
 */

const APP_ROOT = path.join(__dirname, "..", "..");

/**
 * The worklist surfaces: the routes whose job is a list of comparable things.
 *
 * `/dashboard` and `/my-work` are here because they are worklists that happen
 * not to be called one, and the nine index pages because a list of projects is
 * the archetype.
 */
const WORKLIST_ROUTES = [
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/my-work/page.tsx",
  "src/app/(app)/projects/page.tsx",
  "src/app/(app)/grants/page.tsx",
  "src/app/(app)/programs/page.tsx",
  "src/app/(app)/models/page.tsx",
  "src/app/(app)/scenarios/page.tsx",
  "src/app/(app)/plans/page.tsx",
  "src/app/(app)/engagement/page.tsx",
  "src/app/(app)/aerial/page.tsx",
  "src/app/(app)/county-runs/page.tsx",
];

/**
 * Components owned by a different lane's surface, excluded by path.
 *
 * `src/components/reports/**` renders on the RTP and report reading surfaces,
 * which is a different archetype with a different rule (a heading and prose,
 * not a card). Guarding it from here would mean two lanes asserting opposite
 * things about one file.
 */
const OTHER_LANES = ["src/components/reports/"];

/**
 * The scope is DERIVED from what the routes import, not written down.
 *
 * A hand-written file list is the thing that goes stale: the next lane adds a
 * section component to /grants, the list does not grow, and the guard reports
 * green over code it never opened. Reading the imports means the scope follows
 * the pages.
 */
function worklistFiles(): string[] {
  const found = new Set<string>();
  for (const route of WORKLIST_ROUTES) {
    const absolute = path.join(APP_ROOT, route);
    if (!existsSync(absolute)) throw new Error(`${route} no longer exists — fix the list above.`);
    found.add(route);
    const source = readFileSync(absolute, "utf8");
    for (const match of source.matchAll(/from "@\/components\/([\w./-]+)"/g)) {
      const relative = `src/components/${match[1]}.tsx`;
      if (OTHER_LANES.some((prefix) => relative.startsWith(prefix))) continue;
      if (existsSync(path.join(APP_ROOT, relative))) found.add(relative);
    }
  }
  return [...found].sort();
}

/** A radius, however it is spelled — including Tailwind's arbitrary values. */
const RADIUS = /\brounded(?:-(?:sm|md|lg|xl|2xl|3xl|\[[^\]\s]+\]))?\b/;
const BORDER = /\bborder\b|\bborder-[a-z[]/;
const BACKGROUND = /\bbg-(?!transparent\b|clip-|none\b)[a-z[]/;
const PADDING = /\bp-[\d[]|\bpx-[\d[]|\bpy-[\d[]/;

/**
 * Things that are round but are not boxes: chips, badges, pills, avatars,
 * thumbnails, and every form control (shadcn's inputs and selects all carry
 * `border-input`). Excluding them is not softening the rule — a reader does not
 * read a status pill as a frame around content.
 */
const NOT_A_BOX = /inline-flex|inline-block|rounded-full|module-record-chip|border-input|object-cover|\bh-\d+ w-\d+\b/;

/** The item card in this codebase's list idiom, under both of its class names. */
const ITEM_CARD = /module-record-row|module-summary-card/;

/** Only a block container can frame content. A `<code>` or a `<button>` cannot. */
const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "article",
  "li",
  "ul",
  "ol",
  "aside",
  "form",
  "fieldset",
  "main",
  "nav",
]);

type Finding = { readonly where: string; readonly classes: string };

function classListOn(line: string): string | null {
  const match = line.match(/className=\{?"([^"]*)"/);
  return match ? match[1] : null;
}

/**
 * The tag this `className` belongs to, found by walking back to the nearest
 * unclosed `<tag`. Returns null when the nearest opening tag is a component
 * (capitalized) — a component's own root element is guarded where it is
 * defined, which is a file in this same scope.
 */
function owningTag(lines: readonly string[], index: number): string | null {
  for (let i = index; i >= 0 && i > index - 6; i -= 1) {
    const matches = [...lines[i].matchAll(/<([A-Za-z][\w.]*)/g)];
    if (matches.length === 0) continue;
    return matches[matches.length - 1][1];
  }
  return null;
}

/**
 * Where the element carrying this line's `className` actually STARTS.
 *
 * This is load-bearing and it is where the first version of this guard was
 * vacuous. The project card is written across several lines —
 * `<CartographicSelectionLink` at one indent, `className="module-record-row …"`
 * two deeper, then a lone `>` back at the tag's indent. Anchoring the subtree
 * scan on the CLASSNAME line meant the scan hit that `>` immediately, stopped,
 * and reported a clean file over a real nested box. Restoring the box did not
 * fail the test. Anchor on the tag.
 */
function elementStart(lines: readonly string[], index: number): number {
  for (let i = index; i >= 0 && i > index - 8; i -= 1) {
    if (/<[A-Za-z][\w.]*/.test(lines[i])) return i;
  }
  return index;
}

/**
 * The line the element's opening tag closes on: the first `>` that is not
 * inside a string and not inside a `{…}` expression. Everything after it and
 * more indented than the tag is the element's content.
 */
function openingTagEnd(lines: readonly string[], tagLine: number): number {
  let braces = 0;
  let quote: string | null = null;
  for (let i = tagLine; i < lines.length; i += 1) {
    const line = lines[i];
    const from = i === tagLine ? line.search(/<[A-Za-z]/) : 0;
    for (let c = Math.max(from, 0); c < line.length; c += 1) {
      const ch = line[c];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") braces += 1;
      else if (ch === "}") braces -= 1;
      else if (ch === ">" && braces === 0) return i;
    }
  }
  return tagLine;
}

/** Every line of an item card's subtree: the more-indented lines that follow it. */
function subtreeOf(lines: readonly string[], classNameLine: number): number[] {
  const tagLine = elementStart(lines, classNameLine);
  const indent = lines[tagLine].search(/\S/);
  const rows: number[] = [];
  for (let i = openingTagEnd(lines, tagLine) + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    if (lines[i].search(/\S/) <= indent) break;
    rows.push(i);
  }
  return rows;
}

function scanFile(relative: string): { nested: Finding[]; tinted: Finding[]; cards: number } {
  const lines = stripSourceComments(readFileSync(path.join(APP_ROOT, relative), "utf8")).split("\n");
  const nested: Finding[] = [];
  const tinted: Finding[] = [];
  let cards = 0;

  const isBoxLine = (index: number, requireBorder: boolean): string | null => {
    const classes = classListOn(lines[index]);
    if (!classes) return null;
    if (!RADIUS.test(classes)) return null;
    if (NOT_A_BOX.test(classes)) return null;
    if (requireBorder ? !BORDER.test(classes) : BORDER.test(classes)) return null;
    const tag = owningTag(lines, index);
    if (!tag || !CONTAINER_TAGS.has(tag)) return null;
    return classes;
  };

  for (let i = 0; i < lines.length; i += 1) {
    // A filled, radiused, padded block with no border. This is a box to a
    // reader and invisible to the browser audit — the tint evasion.
    const tint = isBoxLine(i, false);
    if (tint && BACKGROUND.test(tint) && PADDING.test(tint)) {
      tinted.push({ where: `${relative}:${i + 1}`, classes: tint });
    }

    if (!ITEM_CARD.test(lines[i])) continue;
    cards += 1;
    for (const row of subtreeOf(lines, i)) {
      const box = isBoxLine(row, true);
      if (box) nested.push({ where: `${relative}:${row + 1}`, classes: box });
    }
  }

  return { nested, tinted, cards };
}

function scanScope(): { files: string[]; nested: Finding[]; tinted: Finding[]; cards: number } {
  const files = worklistFiles();
  const nested: Finding[] = [];
  const tinted: Finding[] = [];
  let cards = 0;
  for (const file of files) {
    const result = scanFile(file);
    nested.push(...result.nested);
    tinted.push(...result.tinted);
    cards += result.cards;
  }
  return { files, nested, tinted, cards };
}

/**
 * Tinted, unbordered, padded panels on the worklist surfaces, as measured
 * 2026-08-13. An EQUALITY: one more fails as the tint evasion, one fewer fails
 * until this number is lowered in the same commit that removed it.
 *
 * Zero is the target and zero is where it currently stands. Do not delete this
 * constant when it is 0 — 0 is the assertion that the evasion stays refused.
 */
const TINTED_PANEL_BASELINE = 0;

describe("the standard this file enforces is written down", () => {
  /**
   * This guard, the browser audit and the copy guard all cite "Plain Words,
   * Fewer Boxes" by name for the rules they do NOT encode — the four
   * archetypes, and the five tests for whether a card has earned its frame.
   * For a week the document did not exist: the citation named a decision that
   * lived only in a chat log, which is the convention-not-mechanism failure
   * wearing a mechanism's clothes. A reader who cannot follow the reference
   * cannot apply the half of the standard that is judgement.
   */
  it("resolves the document the comments above point at", () => {
    const standard = path.join(APP_ROOT, "docs/PLAIN_WORDS_FEWER_BOXES.md");
    expect(existsSync(standard)).toBe(true);

    const text = readFileSync(standard, "utf8");
    // The three clauses this file's assertions are the enforcement of. If the
    // document is rewritten without them, these tests are orphaned again.
    // Whitespace-insensitive: the document is hard-wrapped prose, so any of
    // these phrases may straddle a line break.
    const flowed = text.replace(/\s+/g, " ");
    expect(flowed).toMatch(/three frames/i);
    expect(flowed).toMatch(/filled panel with a radius and no border/i);
    expect(flowed).toMatch(/map-first/i);
  });
});

describe("a worklist card does not contain another card", () => {
  it("scans the surfaces it claims to, and can still see a violation", () => {
    // Without this, every assertion below could pass by finding nothing.
    const { files, cards } = scanScope();
    expect(files.length).toBeGreaterThan(40);
    // AND the scan must actually be finding item cards in those files. Without
    // this, "no box inside an item card" passes trivially the day the list
    // idiom is renamed and ITEM_CARD matches nothing — the shape of vacuous
    // coverage this repository has shipped repeatedly.
    expect(cards).toBeGreaterThanOrEqual(50);
    expect(files).toContain("src/app/(app)/projects/page.tsx");
    expect(files).toContain("src/components/my-work/my-work-board.tsx");
    // Derived, not written down: a component only reachable through an import.
    expect(files).toContain("src/components/onboarding/first-run-checklist.tsx");
    // And a different lane's surface is not in scope.
    expect(files.every((file) => !file.startsWith("src/components/reports/"))).toBe(true);

    // POSITIVE CONTROL: the exact shape this lane removed from the project
    // card — a bordered, radiused, padded div inside `module-record-row` — must
    // be reported, and the hairline that replaced it must not be.
    const card = [
      '        <div className="module-record-row">',
      '          <div className="mt-3 rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5">',
      "            <p>Grant release review</p>",
      "          </div>",
      "        </div>",
    ];
    const hairline = card.map((line) =>
      line.replace('rounded-[0.5rem] border border-border/60 bg-background/70 px-3 py-2.5', "border-t border-border/60 pt-2.5")
    );
    const scan = (lines: string[]) => {
      const found: string[] = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (!ITEM_CARD.test(lines[i])) continue;
        for (const row of subtreeOf(lines, i)) {
          const classes = classListOn(lines[row]);
          if (!classes || !RADIUS.test(classes) || NOT_A_BOX.test(classes) || !BORDER.test(classes)) continue;
          const tag = owningTag(lines, row);
          if (tag && CONTAINER_TAGS.has(tag)) found.push(classes);
        }
      }
      return found;
    };
    expect(scan(card)).toHaveLength(1);
    expect(scan(hairline)).toHaveLength(0);
  });

  it("puts no box inside an item card on any worklist surface", () => {
    const { nested } = scanScope();
    expect(
      nested.map((finding) => `${finding.where} — ${finding.classes}`),
      "A card inside a card. Counting the page shell this is the fourth frame, " +
        "and the standard stops at three. Four moves, in order: flatten it to a " +
        "label/value row; promote it to a sibling if it is the same KIND of thing " +
        "as its parent; demote it to text under a 1px top rule; or move it to the " +
        "detail page. What you may not do is swap the border for a background " +
        "tint — the test below refuses that, because it reads as a box to a person " +
        "while disappearing from the browser audit."
    ).toEqual([]);
  });

  it("does not swap a border for a background tint", () => {
    const { tinted } = scanScope();
    expect(
      tinted.length,
      `A filled, radiused, padded panel with no border: ${tinted
        .map((finding) => finding.where)
        .join(", ")}. That is a box to a reader and nothing to ` +
        "`openplan-local-card-nesting-audit.js`, which counts borders. If a panel " +
        "genuinely needs to be set apart, give it a hairline rule and no frame. If " +
        "one was legitimately REMOVED, lower TINTED_PANEL_BASELINE in this commit."
    ).toBe(TINTED_PANEL_BASELINE);
  });
});

/**
 * The two self-framing panels the dashboard hoists into the first-run
 * checklist. Each draws its own border and radius, which is right when it sits
 * on the page and is the fourth frame when it sits inside a checklist step.
 */
const HOISTED_PANELS = ["WorkspaceGeographyPanel", "WorkspaceIntegrationKeysPanel"];

describe("a panel mounted inside a checklist step drops its own frame", () => {
  it("passes embedded wherever a self-framing panel is mounted into the checklist", () => {
    const source = stripSourceComments(
      readFileSync(path.join(APP_ROOT, "src/app/(app)/dashboard/page.tsx"), "utf8")
    );

    const missing: string[] = [];
    for (const panel of HOISTED_PANELS) {
      // Every mount of the panel on this page, with its full attribute list.
      const mounts = [...source.matchAll(new RegExp(`<${panel}\\b([\\s\\S]*?)/>`, "g"))];
      expect(mounts.length, `${panel} is no longer mounted on the dashboard`).toBeGreaterThan(0);
      const hoisted = mounts.filter((mount) => /embedded/.test(mount[1]));
      if (hoisted.length === 0) missing.push(panel);
    }

    expect(
      missing,
      "A self-framing panel is hoisted into the first-run checklist without " +
        "`embedded`, so it draws a border inside the step card, inside the " +
        "get-started card, inside the page shell — four frames. /dashboard " +
        "measured exactly that in Chrome on 2026-08-13 before this was fixed."
    ).toEqual([]);

    // And the panels must still HONOUR the prop: a component that accepts
    // `embedded` and frames itself anyway would pass the check above.
    for (const panel of HOISTED_PANELS) {
      const file = path.join(
        APP_ROOT,
        "src/components/workspaces",
        panel === "WorkspaceGeographyPanel"
          ? "workspace-geography-panel.tsx"
          : "workspace-integration-keys-panel.tsx"
      );
      const panelSource = stripSourceComments(readFileSync(file, "utf8"));
      expect(
        panelSource,
        `${panel} must make its own border conditional on embedded, not merely accept the prop.`
      ).toMatch(/embedded \? undefined : "rounded-xl border/);
    }
  });
});
