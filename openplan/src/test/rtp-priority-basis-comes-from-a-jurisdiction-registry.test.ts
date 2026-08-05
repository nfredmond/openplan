/**
 * The RTP priority criteria may not cite one jurisdiction's law to another's
 * agency.
 *
 * This guard exists because they did. `RTP_PRIORITY_CRITERIA` carried
 * `policyBasis: "CEQA §15064.3 · SB 743"` and three more California statutes as
 * module constants; `buildNarrative` spliced them into prose; and the PUBLIC
 * share page rendered that prose. Every agency in the United States that
 * published its plan told its own residents its projects advanced California
 * law. Nothing failed, because no test asserted anything about the basis
 * strings — which is exactly the shape of defect a convention cannot catch and
 * a failing test can.
 *
 * Two independent things are asserted, because either alone is escapable:
 *
 *   1. STRUCTURAL — statute-shaped strings appear only in `frameworks/`. Catches
 *      a basis hardcoded back into the taxonomy or into a narrative builder.
 *   2. BEHAVIOURAL — the same scores under two different bindings produce
 *      different bases, and a workspace with no matched framework cites none.
 *      Catches a threaded parameter that is accepted and then ignored, which a
 *      single-fixture test cannot distinguish from a hardcode.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { RTP_PRIORITY_CRITERIA } from "@/lib/rtp/priority-criteria";
import {
  createRtpPriorityFrameworkRegistry,
  resolveRtpPriorityCriteria,
  type RtpPriorityFrameworkDescriptor,
} from "@/lib/rtp/priority-frameworks";
import {
  describeRtpPriorityFrameworkBinding,
  resolveRtpPriorityFramework,
} from "@/lib/rtp/priority-framework-binding";
import {
  buildPortfolioPriorityNarrative,
  buildRtpPriorityRationale,
} from "@/lib/rtp/priority-scoring";
import { US_CA_RTP_PRIORITY_FRAMEWORK } from "@/lib/rtp/frameworks/us-ca";
import { US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK } from "@/lib/rtp/frameworks/us-federal-generic";

const RTP_LIB_DIR = join(process.cwd(), "src/lib/rtp");

/**
 * Statute-shaped citations. Deliberately jurisdiction-shaped rather than a list
 * of known statutes: a guard that banned only "SB 743" would pass the moment
 * someone hardcoded "SB 375".
 */
const STATUTE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "a California-style bill number", pattern: /\b(?:SB|AB|ACA|SCA)\s?\d{1,4}\b/i },
  { label: "a CEQA citation", pattern: /\bCEQA\b/i },
  { label: "a CARB reference", pattern: /\bCARB\b/i },
  { label: "a Justice40 reference", pattern: /\bJustice\s?40\b/i },
  { label: "a CalEnviroScreen reference", pattern: /\bCalEnviroScreen\b/i },
  { label: "a section-symbol citation", pattern: /§\s?\d/ },
];

/**
 * Strip comments so PROSE about the defect does not trip the guard that
 * prevents it. Only string literals and code are scanned.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function tsFilesDirectlyIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name);
}

describe("statute citations live only in the jurisdiction framework descriptors", () => {
  it("finds no statute-shaped string anywhere in src/lib/rtp outside frameworks/", () => {
    const offenders: string[] = [];

    for (const name of tsFilesDirectlyIn(RTP_LIB_DIR)) {
      const code = stripComments(readFileSync(join(RTP_LIB_DIR, name), "utf8"));
      for (const { label, pattern } of STATUTE_PATTERNS) {
        if (pattern.test(code)) offenders.push(`src/lib/rtp/${name} contains ${label}`);
      }
    }

    // The registry is the ONE place a jurisdiction's law may be named. Anywhere
    // else, a citation is applied to every workspace regardless of where it is.
    expect(offenders).toEqual([]);
  });

  it("keeps the criteria taxonomy free of any policy-basis field", () => {
    // The taxonomy is what every jurisdiction shares. A `policyBasis` key on it
    // is a citation that cannot vary, which is the original defect exactly.
    for (const criterion of RTP_PRIORITY_CRITERIA) {
      expect(Object.keys(criterion)).not.toContain("policyBasis");
    }
  });

  it("guards the guard: the scanner catches a seeded statute and ignores one in a comment", () => {
    // Positive — a real hardcode is caught.
    const hardcoded = stripComments('const basis = "CEQA §15064.3 · SB 743";');
    expect(STATUTE_PATTERNS.some(({ pattern }) => pattern.test(hardcoded))).toBe(true);

    // Negative — the same words in a comment are not, or this guard could never
    // coexist with the documentation explaining why it exists.
    const commented = stripComments('// this used to say "SB 743" and CEQA\nconst basis = null;');
    expect(STATUTE_PATTERNS.some(({ pattern }) => pattern.test(commented))).toBe(false);
  });
});

describe("the resolved framework, not the module, decides what a plan cites", () => {
  const SCORES = { vmt_reduction: 3, ghg_reduction: 3, multimodal: 3 };

  const californiaCriteria = resolveRtpPriorityCriteria(US_CA_RTP_PRIORITY_FRAMEWORK);
  const federalCriteria = resolveRtpPriorityCriteria(US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK);

  it("cites California statutes for a California workspace", () => {
    const rationale = buildRtpPriorityRationale(SCORES, californiaCriteria);
    expect(rationale.narrative).toContain("SB 743");
  });

  it("cites NO California statute for a workspace in another state", () => {
    const rationale = buildRtpPriorityRationale(SCORES, federalCriteria);
    // The regression this whole change exists to prevent.
    expect(rationale.narrative).not.toContain("SB 743");
    expect(rationale.narrative).not.toContain("SB 375");
    expect(rationale.narrative).toContain("23 CFR");
  });

  it("varies the portfolio narrative with the binding too", () => {
    // Both builders splice the basis; guarding only one leaves the other free.
    const ca = buildPortfolioPriorityNarrative([SCORES], californiaCriteria);
    const federal = buildPortfolioPriorityNarrative([SCORES], federalCriteria);
    expect(ca.narrative).not.toEqual(federal.narrative);
    expect(federal.narrative).not.toContain("SB 743");
  });

  it("cites nothing at all when no framework covers the workspace", () => {
    // A workspace outside every registered jurisdiction. Scoring must still
    // work; only the legal claim is withheld.
    const binding = resolveRtpPriorityFramework({
      workspaceJurisdiction: { country: "NZ", subdivision: null },
    });
    expect(binding.framework).toBeNull();
    expect(binding.selection).toBe("uncited");

    const rationale = buildRtpPriorityRationale(SCORES, binding.criteria);
    expect(rationale.summary.composite).toBeGreaterThan(0);
    expect(rationale.narrative).not.toContain("CFR");
    expect(rationale.narrative).not.toContain("SB ");
    // The basis clause is the trailing parenthetical. It must be absent
    // entirely — not rendered as an empty "()" — so the sentence ends at the
    // priority levels. (Rating labels like "(high)" appear earlier and are not
    // citations, which is why this asserts the ENDING rather than "no parens".)
    expect(rationale.narrative.trimEnd().endsWith("priorities.")).toBe(true);
  });

  it("withholds citations rather than assuming a country when geography is unset", () => {
    const binding = resolveRtpPriorityFramework({ workspaceJurisdiction: null });
    expect(binding.framework).toBeNull();
    expect(binding.uncitedReason).toBe("no_workspace_jurisdiction");
    // The disclosure has to tell a planner how to fix it, or the withheld
    // citation reads as a product limitation rather than a missing input.
    expect(describeRtpPriorityFrameworkBinding(binding).action).toBeTruthy();
  });

  it("binds California to California and every other US state to the federal floor", () => {
    const ca = resolveRtpPriorityFramework({
      workspaceJurisdiction: { country: "US", subdivision: "CA" },
    });
    expect(ca.framework?.frameworkId).toBe("us-ca");

    const ohio = resolveRtpPriorityFramework({
      workspaceJurisdiction: { country: "US", subdivision: "OH" },
    });
    expect(ohio.framework?.frameworkId).toBe("us-federal-generic");

    // Subdivision unknown must NOT pick a state pack.
    const unknown = resolveRtpPriorityFramework({
      workspaceJurisdiction: { country: "US", subdivision: null },
    });
    expect(unknown.framework?.frameworkId).toBe("us-federal-generic");
  });
});

describe("the registry refuses a framework that would leave a criterion uncited", () => {
  it("throws when a registered framework omits a criterion the taxonomy declares", () => {
    const incomplete: RtpPriorityFrameworkDescriptor = {
      ...US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK,
      frameworkId: "test-incomplete",
      policyBasis: { safety: "23 CFR 450.306(b)(2)" },
    };
    // Completeness is checked against RTP_PRIORITY_CRITERIA itself, so adding a
    // ninth criterion fails every framework that has not decided its basis —
    // at construction, rather than as a blank on a published page.
    expect(() => createRtpPriorityFrameworkRegistry([incomplete])).toThrow(/no policy basis/i);
  });

  it("throws when two frameworks claim the same country's nationwide floor", () => {
    expect(() =>
      createRtpPriorityFrameworkRegistry([
        US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK,
        { ...US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK, frameworkId: "second-claimant" },
      ])
    ).toThrow(/interim default/i);
  });

  it("declares a basis for every criterion in every shipped framework", () => {
    // Derived from the registry, never a literal count: registering another
    // state must not require editing this test.
    for (const framework of [US_FEDERAL_GENERIC_RTP_PRIORITY_FRAMEWORK, US_CA_RTP_PRIORITY_FRAMEWORK]) {
      const resolved = resolveRtpPriorityCriteria(framework);
      expect(resolved.every((criterion) => Boolean(criterion.policyBasis))).toBe(true);
      expect(resolved).toHaveLength(RTP_PRIORITY_CRITERIA.length);
    }
  });
});
