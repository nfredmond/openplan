import { describe, expect, it } from "vitest";

import { pageSource } from "./page-tabs-guard-source";

/**
 * A READ THAT FAILED BEHIND A CLOSED TAB MUST STILL BE ANNOUNCED — AND THAT
 * DEPENDS ENTIRELY ON THE CALL SITE.
 *
 * `describeUnreadableTabs` and the four `build*Tabs` builders are well tested,
 * and every one of those tests calls the builder ITSELF with flags it wrote.
 * None of them can see what the page passes. Changing the engagement page's
 * `buildCampaignTabs({ … itemsUnreadable … })` to a hardcoded `false` — a
 * console that can never report a failed read of its own comment queue — left
 * seven `page-tabs-*` files and 151 tests green.
 *
 * That is the repo's read-failure rule losing its last mile: the builder is
 * honest, the notice component is honest, and the page quietly tells them both
 * that nothing went wrong. On a tabbed page it is worse than on a scroll,
 * because the panel that would have shown the failure is not on screen at all,
 * so an unread lane and an empty one are the same picture.
 *
 * HOW THIS IS DERIVED, on both sides. The required flags come from the
 * BUILDER's own body — every `flags.x` and `flags.x.y` it reads — so adding a
 * lane to a builder immediately requires the page to supply it, with no list
 * here to update. The supplied values come from the page's call site. A guard
 * with a hand-written flag table would have gone stale the first time a lane
 * was added, which is the failure mode this whole lane keeps meeting.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT. It proves each lane is wired to an
 * expression the page computes, not to a constant. It does NOT prove the
 * expression is the RIGHT one — `itemsUnreadable: categoriesUnreadable` would
 * pass here. Catching that needs the page rendered against a fake client whose
 * one failing read is known, which is a different test; this closes the case
 * that actually shipped.
 */

type WiredBuilder = {
  label: string;
  /** The module that declares the builder, read for the flags it consumes. */
  builderFile: string;
  builderName: string;
  /** The page that CALLS it — for reports, the route file, not the detail
   * component that renders the strip. */
  callSiteFile: string;
};

const WIRED_BUILDERS: WiredBuilder[] = [
  {
    label: "project detail",
    builderFile: "app/(app)/projects/[projectId]/_components/_tabs.ts",
    builderName: "buildProjectTabs",
    callSiteFile: "app/(app)/projects/[projectId]/page.tsx",
  },
  {
    label: "engagement console",
    builderFile: "app/(app)/engagement/[campaignId]/_tabs.ts",
    builderName: "buildCampaignTabs",
    callSiteFile: "app/(app)/engagement/[campaignId]/page.tsx",
  },
  {
    label: "RTP cycle",
    builderFile: "app/(app)/rtp/[rtpCycleId]/_tabs.ts",
    builderName: "buildRtpCycleTabs",
    callSiteFile: "app/(app)/rtp/[rtpCycleId]/page.tsx",
  },
  {
    label: "report detail",
    builderFile: "app/(app)/reports/[reportId]/_components/_read-failures.ts",
    builderName: "buildReportUnreadableByTab",
    callSiteFile: "app/(app)/reports/[reportId]/page.tsx",
  },
];

/**
 * Every read-failure flag a builder consults, as a dotted path.
 *
 * Taken from the body rather than from the flags TYPE because the body is what
 * decides whether a lane is disclosed: a field declared on the type and never
 * read discloses nothing, and requiring the page to pass it would be requiring
 * ceremony instead of behaviour.
 */
function flagsConsumedBy(source: string, builderName: string): string[] {
  const start = source.indexOf(`export function ${builderName}(`);
  if (start === -1) throw new Error(`${builderName} is no longer exported from its module`);
  const body = source.slice(start);
  const paths = new Set<string>();
  for (const match of body.matchAll(/\bflags\.([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?/g)) {
    paths.add(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  }
  return [...paths].sort();
}

/** The balanced `{ … }` that follows `opener` in `source`. */
function objectLiteralAfter(source: string, opener: string): string {
  const at = source.indexOf(opener);
  if (at === -1) throw new Error(`no call site for ${opener}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced object literal at ${opener}`);
}

/** `key: value` pairs at the top level of an object literal body, with
 * shorthand (`itemsUnreadable,`) expanded to `itemsUnreadable: itemsUnreadable`. */
function entriesOf(objectBody: string): Map<string, string> {
  const entries = new Map<string, string>();
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const char of objectBody) {
    if (char === "{" || char === "(" || char === "[") depth += 1;
    if (char === "}" || char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) entries.set(trimmed, trimmed);
    else entries.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim());
  }
  return entries;
}

/** Globals and literals, which are not something the page works out. */
const NOT_A_PAGE_VALUE = new Set([
  "Boolean",
  "String",
  "Number",
  "Array",
  "Object",
  "true",
  "false",
  "null",
  "undefined",
]);

/**
 * The variables an expression READS — the root of each member chain, with
 * string literals removed first.
 *
 * `stageGateSummary.decisionsRead.readable === false` names one thing the page
 * has to have computed, `stageGateSummary`; `decisionsRead` and `readable` are
 * that value's own shape and are not declared on the page at all. Counting
 * them would have made this guard demand ceremony rather than wiring — it did,
 * on its first run.
 */
function valuesRead(expression: string): string[] {
  const withoutStrings = expression.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  return [...withoutStrings.matchAll(/(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)/g)]
    .map((match) => match[2])
    .filter((name) => !NOT_A_PAGE_VALUE.has(name));
}

describe("the derivation is reading the real builders", () => {
  it("finds the flags each builder consults", () => {
    // A parse that returned nothing would pass every assertion below without
    // checking a single call site.
    for (const wired of WIRED_BUILDERS) {
      const flags = flagsConsumedBy(pageSource(wired.builderFile), wired.builderName);
      expect(flags.length, `${wired.label}: no read-failure flags found in ${wired.builderName}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("treats a hardcoded boolean as unwired", () => {
    // The exact mutation this file exists for, checked against the predicate
    // rather than against the tree, so the predicate cannot rot into one that
    // accepts everything.
    const entries = entriesOf("categoriesUnreadable, itemsUnreadable: false, other: someFlag");
    expect(entries.get("categoriesUnreadable")).toBe("categoriesUnreadable");
    expect(entries.get("itemsUnreadable")).toBe("false");
    expect(entries.get("other")).toBe("someFlag");
  });

  it("reads the root of a member chain and nothing else", () => {
    expect(valuesRead('stageGateSummary.decisionsRead.readable === false')).toEqual(["stageGateSummary"]);
    expect(valuesRead('packetReportsState === "failed"')).toEqual(["packetReportsState"]);
    expect(valuesRead("Boolean(aerialUnreadableReason)")).toEqual(["aerialUnreadableReason"]);
    expect(valuesRead("false")).toEqual([]);
  });
});

describe("every page wires its own read failures into its tab strip", () => {
  for (const wired of WIRED_BUILDERS) {
    it(`passes a computed value for each ${wired.label} lane`, () => {
      const required = flagsConsumedBy(pageSource(wired.builderFile), wired.builderName);
      const callSite = pageSource(wired.callSiteFile);
      const supplied = entriesOf(objectLiteralAfter(callSite, `${wired.builderName}(`));

      const problems: string[] = [];
      for (const dotted of required) {
        const [head, leaf] = dotted.split(".");
        const outer = supplied.get(head);
        if (outer === undefined) {
          problems.push(`${dotted}: the page passes no "${head}"`);
          continue;
        }

        let expression = outer;
        if (leaf) {
          const inner = entriesOf(objectLiteralAfter(outer, "{")).get(leaf);
          if (inner === undefined) {
            problems.push(`${dotted}: the page's "${head}" carries no "${leaf}"`);
            continue;
          }
          expression = inner;
        }

        if (expression === "true" || expression === "false") {
          problems.push(`${dotted}: hardcoded \`${expression}\``);
          continue;
        }

        // The expression has to name something the page works out for itself.
        // A value the page never mentions anywhere else is either a typo or a
        // constant wearing a variable's clothes.
        const names = valuesRead(expression);
        if (names.length === 0) {
          problems.push(`${dotted}: \`${expression}\` names nothing the page computes`);
          continue;
        }
        for (const name of names) {
          const mentions = callSite.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
          if (mentions < 2) problems.push(`${dotted}: \`${name}\` appears nowhere else on the page`);
        }
      }

      expect(
        problems,
        `these ${wired.label} lanes are not wired to the page's own read outcomes, so a failed read behind ` +
          "a closed tab would be reported as a tab nobody opened — pass the flag the page already computes",
      ).toEqual([]);
    });
  }
});
