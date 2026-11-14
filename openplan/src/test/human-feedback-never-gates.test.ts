import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * HUMAN FEEDBACK NEVER GATES OPENPLAN.
 *
 * On November 13, 2026 Nathaniel decided, permanently, that human feedback
 * never gates development, milestones, merges, releases or v1. Agent-run
 * planner, operator and public-participant checks are the acceptance evidence.
 * His October 17 version of this rule claimed to supersede older gates
 * without editing them, so the active plan kept contradicting itself (both
 * November 1 independent reviews found the leftover lines). The same day he
 * also directed agents to make product, engineering, scientific and
 * sequencing decisions themselves instead of asking him.
 *
 * WHAT IT READS. The active guidance files below, split into sentences and
 * table cells. A sentence fails when it names a human-feedback gate (a real
 * planner, practitioner review, human observation, a comparative human trial,
 * recruiting reviewers) or makes Nathaniel's decision a precondition, unless
 * the same sentence is a policy sentence that places that feedback after v1,
 * calls it optional, or tells agents not to recruit or ask.
 *
 * WHAT STAYS ALLOWED. Human authority is not feedback: an agency's adoption,
 * spending and publication decisions, a named approver bound to an exact
 * payload, licensed legal or scientific determinations, spending approval and
 * staff moderation before publication. None of those phrasings match.
 *
 * BLIND CATEGORIES. Paraphrases outside the listed phrases ("watch a planner
 * use it"), a gate split across two sentences, dated review records under
 * docs/reviews/ (history), product documents not listed below, and the body
 * of PLANNER_OBSERVATION_PROTOCOL.md, which is the
 * optional post-v1 research plan and is checked only for its opening notice.
 */

const REPO_ROOT = path.join(process.cwd(), "..");

const ACTIVE_GUIDANCE = [
  "AGENTS.md",
  "docs/ROADMAP.md",
  "docs/product/MILESTONES.md",
  "docs/product/V1_PRODUCT_CONTRACT.md",
  "docs/product/US_PLANNING_CAPABILITY_MATRIX.md",
  "docs/product/DEVELOPMENT_RELEASE_POLICY.md",
  "docs/product/WORKFLOW_HANDOFFS.md",
  "docs/product/CORE_REQUIREMENTS_LEDGER.md",
];

const GATE_PHRASES: RegExp[] = [
  /\breal planners?\b/i,
  /\bpractitioner (review|observation|feedback|usefulness|sessions?)\b/i,
  /\bhuman (observation|feedback|usefulness|usability|trials?|sessions?|participation|evidence)\b/i,
  /\bhuman-observation\b/i,
  /\bcomparative human\b/i,
  /\bnamed human review\b/i,
  /\bobserve (practicing|a real|real|one planner|a records|coordinator|agency|setup|a solo)\b/i,
  /\bpracticing (planners?|facilitators?|project managers?)\b/i,
  /\brecruit\w* (human )?(reviewers?|participants?|planners?)\b/i,
  /\bagents? cannot substitute\b/i,
  /\bnot just agent personas\b/i,
  /\bask (Nathaniel|him)\b/i,
  /\b(needs|awaiting|pending) Nathaniel's (scope )?decisions?\b/i,
  /\bNathaniel's (scope )?(clarification|decisions?) (of|on)\b/i,
];

const POLICY_SENTENCE = /\b(post-v1|after v1|optional research|never gates|do not recruit|do not ask (Nathaniel|him))\b/i;

/** Join wrapped lines, then split prose into sentences and tables into cells. */
function sentences(markdown: string): string[] {
  return markdown
    .split(/\n\s*\n/)
    .flatMap((block) => block.split("\n").map((line) => line.trim()).join(" ").split(/(?<=[.!?|])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function gateSentences(markdown: string): string[] {
  return sentences(markdown).filter(
    (sentence) => GATE_PHRASES.some((phrase) => phrase.test(sentence)) && !POLICY_SENTENCE.test(sentence),
  );
}

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("human feedback never gates OpenPlan", () => {
  it("reads every active guidance file it is meant to check", () => {
    for (const file of ACTIVE_GUIDANCE) {
      expect(sentences(read(file)).length, file).toBeGreaterThan(20);
    }
  });

  it("finds no human-feedback gate or decision request in active guidance", () => {
    const found = ACTIVE_GUIDANCE.flatMap((file) =>
      gateSentences(read(file)).map((sentence) => `${file}: ${sentence.slice(0, 200)}`),
    );
    expect(found).toEqual([]);
  });

  it("flags planted gate lines", () => {
    const planted = [
      "- **Verification:** observe practicing facilitators and diverse public participants.",
      "Test desktop/mobile/keyboard/accessibility. Agents cannot substitute for these people.",
      "A real planner and recipient complete the case\nwithout guided clicks.",
      "| M9c | Beat Social Pinpoint | Later | Comparative human task evidence |",
      "Freeze the preregistration; needs Nathaniel's decisions on partitions.",
    ].join("\n\n");
    expect(gateSentences(planted)).toHaveLength(5);
  });

  it("allows the post-v1 policy sentence and human authority", () => {
    const allowed = [
      "Human feedback after v1 stays optional research.",
      "Do not recruit reviewers or ask Nathaniel for human feedback.",
      "Human moderation before public release is the default.",
      "For an approval, bind the responsible human to the exact version/payload.",
      "Buying data or commissioning research needs Nathaniel's approval.",
    ].join("\n\n");
    expect(gateSentences(allowed)).toEqual([]);
  });

  it("keeps the observation protocol marked as optional post-v1 research", () => {
    const opening = read("docs/product/PLANNER_OBSERVATION_PROTOCOL.md").split("\n## ")[0];
    expect(opening).toContain("**Post-v1 only, optional.**");
    expect(opening).toContain("November 13, 2026");
    expect(opening).toMatch(/direction reviews do not\s+reopen it/);
  });
});
