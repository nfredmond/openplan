import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROJECT_RECORD_COMPOSER_TYPES } from "@/components/projects/project-record-composer";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { stripSourceComments } from "./helpers/source-text";

/**
 * TWO THINGS TABBING A PAGE QUIETLY TOOK AWAY.
 *
 * 1. THE PAGE'S NAME. A detail page's `h1` is its accessible name and the top
 *    of its heading outline. On the project page that `h1` lived inside the
 *    component only the Overview tab renders, so four of five tabs had no name
 *    and began at `h2` — a screen reader landing on `?tab=funding` was told
 *    nothing about which project it was reading. The rule this encodes: the
 *    heading belongs ABOVE the strip, on the chrome every tab shares.
 *
 * 2. A WAY TO CREATE THE THING THE TAB LISTS. One composer served all seven
 *    project record types and ended up in Delivery, so the Record tab listed
 *    risks, issues, decisions and meetings read-only with no way to add one.
 *    The two composers must therefore PARTITION the seven types — every type
 *    offered somewhere, none offered twice, each beside the log that reads it.
 *
 * Source-reading, not rendering: jsdom applies no stylesheet, so it cannot see
 * that a closed panel is hidden or that a heading is on screen. What is checked
 * here is structure — where the heading sits relative to the strip, and which
 * types each composer is given — which is exactly what broke.
 */

const SRC = path.join(process.cwd(), "src");

/** The four tabbed detail pages, by the file that renders their tab strip. */
const TABBED_PAGES: Array<{ label: string; routeDir: string; stripFile: string }> = [
  {
    label: "project detail",
    routeDir: "app/(app)/projects/[projectId]",
    stripFile: "app/(app)/projects/[projectId]/page.tsx",
  },
  {
    label: "engagement console",
    routeDir: "app/(app)/engagement/[campaignId]",
    stripFile: "app/(app)/engagement/[campaignId]/page.tsx",
  },
  {
    label: "RTP cycle",
    routeDir: "app/(app)/rtp/[rtpCycleId]",
    stripFile: "app/(app)/rtp/[rtpCycleId]/page.tsx",
  },
  {
    label: "report detail",
    routeDir: "app/(app)/reports/[reportId]",
    stripFile: "app/(app)/reports/[reportId]/_components/report-standard-detail.tsx",
  },
];

function code(file: string): string {
  return stripSourceComments(readFileSync(path.join(SRC, file), "utf8"));
}

/**
 * The `.tsx` files that make up ONE route: its own directory, plus helper
 * directories like `_components`, but never a nested route. A child directory
 * holding its own `page.tsx` is a different page with a different heading —
 * `/rtp/<id>/document` is not a tab of `/rtp/<id>`.
 */
function filesInRoute(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (readdirSync(full).includes("page.tsx")) continue;
      filesInRoute(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("a tabbed page names itself on every tab", () => {
  for (const page of TABBED_PAGES) {
    it(`puts the ${page.label} h1 above its tab strip`, () => {
      const source = code(page.stripFile);

      const stripAt = source.indexOf("<PageTabNav");
      expect(stripAt, `${page.label} no longer renders a tab strip`).toBeGreaterThan(-1);

      const headings = [...source.matchAll(/<h1[\s>]/g)].map((match) => match.index ?? -1);
      expect(headings, `${page.label} renders no h1 at all`).not.toEqual([]);

      for (const at of headings) {
        expect(
          at,
          `${page.label} renders an h1 BELOW its tab strip — it is inside one tab's panel, so every ` +
            "other tab loses the page's accessible name and starts its outline at h2",
        ).toBeLessThan(stripAt);
      }
    });

    it(`keeps the ${page.label} h1 out of its panels' own components`, () => {
      // The failure was not a stray `<h1>` in the page file; it was an `<h1>`
      // in a component that only one tab renders. Nothing in the page file can
      // see that, so the whole route directory is swept.
      const offenders = filesInRoute(path.join(SRC, page.routeDir))
        .filter((file) => path.relative(SRC, file) !== page.stripFile)
        .filter((file) => /<h1[\s>]/.test(stripSourceComments(readFileSync(file, "utf8"))))
        .map((file) => path.relative(SRC, file));

      expect(
        offenders,
        `these ${page.label} components render an h1, and a component is rendered by one tab — the ` +
          "page's heading belongs above the strip, where every tab shares it",
      ).toEqual([]);
    });
  }
});

/**
 * The `recordTypes` each `<ProjectRecordComposer>` on the project page is
 * given, keyed by the tab whose panel it sits in.
 */
function composersByTab(): Map<string, string[]> {
  const source = code("app/(app)/projects/[projectId]/page.tsx");
  const byTab = new Map<string, string[]>();

  const panels = [...source.matchAll(/<PageTabPanel\s+tabKey="([a-z]+)"/g)];
  for (const [index, panel] of panels.entries()) {
    const start = panel.index ?? 0;
    const end = panels[index + 1]?.index ?? source.length;
    const body = source.slice(start, end);

    const composer = body.match(/<ProjectRecordComposer[\s\S]*?\/>/);
    if (!composer) continue;

    const list = composer[0].match(/recordTypes=\{\[([^\]]*)\]\}/)?.[1] ?? "";
    byTab.set(
      panel[1],
      [...list.matchAll(/"([a-z]+)"/g)].map((match) => match[1]),
    );
  }

  return byTab;
}

describe("every project record type can be created on the tab that reads it", () => {
  it("splits the composer across Delivery and Record, covering all seven types once", () => {
    const byTab = composersByTab();

    expect(
      [...byTab.keys()].sort(),
      "the record composer is not on both the Delivery and Record tabs",
    ).toEqual(["delivery", "record"]);

    const all = [...byTab.values()].flat();
    expect(
      [...all].sort(),
      "the two composers do not partition the seven record types — a type offered nowhere has no " +
        "creation surface at all, and one offered twice gives the planner two identical forms",
    ).toEqual([...PROJECT_RECORD_COMPOSER_TYPES].sort());
  });

  it("puts the composer for a record type on the tab whose anchors are its form fields", () => {
    // The Record tab declares `risk-`, `issue-`, `decision-` and `meeting-`
    // prefixes. The only elements with those ids are the composer's own form
    // fields, so the declaration is only true while that composer is here.
    const byTab = composersByTab();
    const recordTab = buildProjectTabs({
      overview: { reports: false, stageGates: false },
      delivery: { milestones: false, submittals: false },
      funding: { profile: false, awards: false, opportunities: false, invoices: false },
      evidence: { datasets: false, runs: false, aerial: false },
      record: { risks: false, issues: false, decisions: false, meetings: false },
    }).find((tab) => tab.key === "record");

    const offered = byTab.get("record") ?? [];
    for (const prefix of recordTab?.anchorPrefixes ?? []) {
      const type = prefix.replace(/-$/, "");
      expect(
        offered,
        `the Record tab claims the "${prefix}" anchors but does not compose ${type} records, so ` +
          "those ids are rendered on some other tab",
      ).toContain(type);
    }
  });
});
