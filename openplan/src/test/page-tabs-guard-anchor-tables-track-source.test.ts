import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pageTabForAnchor, type PageTabDefinition } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "./helpers/source-text";
import {
  REPORT_DETAIL_FILE,
  pageSource,
  reportDetailTabsFromSource,
  reportHeaderAnchorsFromSource,
  tabbedPages,
} from "./page-tabs-guard-source";

/**
 * THE ANCHOR TABLES MUST BE DERIVED, NOT RESTATED.
 *
 * Two sibling suites keep a hand-written copy of the report page's tabs and of
 * its header anchors, and one of them checks five project anchors by name. Both
 * copies pass while the page underneath them changes: moving an anchor that is
 * absent from the hand list survives, and a header anchor deleted from
 * `REPORT_HEADER_ANCHORS` leaves the copy asserting an exemption the product no
 * longer grants. A hand-written list is what failed here, so nothing in this
 * file is hand-written — the report's tabs and header anchors are parsed out of
 * the component that ships them, and the links are walked out of the tree.
 *
 * THE TWO PROPERTIES, both of which the existing tests leave open:
 *
 *   1. EXACTLY ONE claimant. `page-tabs-url-and-anchors` proves no two tabs
 *      declare the same exact anchor, and stops there. It cannot see a PREFIX
 *      on one tab that also matches an anchor claimed by another, and it does
 *      not look at the report page at all. Where two claims overlap,
 *      `pageTabForAnchor` picks by array order — a link's destination decided
 *      by which tab happens to be listed first is a coin toss with a stable
 *      result, which is the worst kind.
 *   2. A page anchor is claimed by NOBODY. An id on chrome above the strip is
 *      on screen whichever tab is open; a tab claiming it as well means arriving
 *      at `?tab=history#report-controls` throws the reader's tab away to reach
 *      a control already in front of them. That regression shipped once. The
 *      exemption list here comes from the component, so deleting an entry there
 *      moves this guard with it instead of leaving it green.
 *
 * WHAT THIS CANNOT SEE: a link built from a fully computed fragment, and a link
 * in a database row rather than in source. Those are covered, as far as they
 * can be, by the anchor's own declaration being right.
 */

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // A fixture URL in a test is not a link a planner can follow, and several
      // of them use ids invented for the fixture.
      if (entry === "test") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

type DeepLink = { file: string; href: string; anchor: string };

/**
 * Every `/<prefix>/…#anchor` this product mints, from plain strings and from
 * template literals alike. A fragment whose tail is itself interpolated
 * (`#artifact-${id}`) is recorded with a placeholder standing in for the
 * computed part, so it resolves through a tab's `anchorPrefixes` the way the
 * real link will.
 */
function deepLinksInto(prefix: string): DeepLink[] {
  const pattern = new RegExp("/" + prefix + "/[^\\s\"'`]*?#([a-z][a-z0-9-]*)(\\$\\{)?", "g");
  const found: DeepLink[] = [];

  for (const file of sourceFiles(SRC)) {
    // Comments first. A route file documents its own fragment shapes in prose,
    // and prose reaching a matcher is a defect this repo has shipped in both
    // directions.
    const text = stripSourceComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(pattern)) {
      found.push({
        file: path.relative(SRC, file),
        href: match[0],
        anchor: match[2] ? `${match[1]}interpolated-id` : match[1],
      });
    }
  }
  return found;
}

/** Every tab whose declarations would match `id`, exact claims and prefixes
 * alike. */
function claimantsOf(tabs: readonly PageTabDefinition<string>[], id: string): string[] {
  return tabs
    .filter(
      (tab) =>
        (tab.anchors ?? []).includes(id) ||
        (tab.anchorPrefixes ?? []).some((p) => id.startsWith(p) && id.length > p.length),
    )
    .map((tab) => tab.key);
}

describe("the report page's tables are parsed, not copied", () => {
  it("reads its tabs and its header anchors out of the component that ships them", () => {
    // A parse that silently returned nothing would make every assertion below
    // vacuous, so the derivation is checked against the file first.
    const tabs = reportDetailTabsFromSource();
    const headerAnchors = reportHeaderAnchorsFromSource();
    const source = pageSource(REPORT_DETAIL_FILE);

    expect(tabs.length, "no tabs parsed out of report-standard-detail").toBeGreaterThan(2);
    expect(headerAnchors.length, "no header anchors parsed out of report-standard-detail").toBeGreaterThan(2);

    // An empty `anchors: []` on every tab is what a silently broken parse looks
    // like, and it is not hypothetical — the first version of the array reader
    // built its own search text, matched nothing, and handed back empty lists
    // that made this file and its sibling pass without reading one anchor.
    const claimed = tabs.flatMap((tab) => [...(tab.anchors ?? []), ...(tab.anchorPrefixes ?? [])]);
    expect(claimed.length, "the report tabs parsed with no anchors at all — the parse is broken").toBeGreaterThan(
      3,
    );
    for (const tab of tabs) {
      expect(source).toContain(`key: "${tab.key}"`);
      for (const anchor of [...(tab.anchors ?? []), ...(tab.anchorPrefixes ?? [])]) {
        expect(source, `parsed "${anchor}" out of thin air`).toContain(`"${anchor}"`);
      }
    }
    // And the page has to TELL the strip about the header anchors, or
    // `pageTabForAnchor` never sees the exemption at runtime and this whole
    // derivation is describing a list nothing consults.
    expect(source, "report-standard-detail does not hand its header anchors to PageTabNav").toMatch(
      /pageAnchors=\{REPORT_HEADER_ANCHORS\}/,
    );
  });
});

describe("no id on a tabbed page has two claimants", () => {
  for (const page of tabbedPages()) {
    it(`gives every ${page.label} anchor exactly one destination`, () => {
      const contested: string[] = [];

      for (const tab of page.tabs) {
        for (const anchor of tab.anchors ?? []) {
          // Exact against exact only. An exact claim on one tab and a matching
          // PREFIX on another is not ambiguous: `pageTabForAnchor` checks every
          // tab's exact anchors before any prefix, so the exact claim wins
          // whatever order the tabs are in. That rule is deliberate — the RTP
          // cycle relies on it, where `projects` owns
          // `rtp-cycle-project-map-canvas` and `overview` owns the broad
          // `rtp-cycle-` prefix — and it is covered in `page-tabs-url-and-
          // anchors`. What has no tie-breaker at all is two exacts, or two
          // prefixes where one contains the other.
          const others = page.tabs
            .filter((other) => other.key !== tab.key && (other.anchors ?? []).includes(anchor))
            .map((other) => other.key);
          if (others.length > 0) contested.push(`#${anchor}: ${tab.key} and ${others.join(", ")}`);
        }
        for (const prefix of tab.anchorPrefixes ?? []) {
          // A prefix is contested when ANOTHER tab's prefix would match the
          // same ids — one being a prefix of the other, in either direction.
          for (const other of page.tabs) {
            if (other.key === tab.key) continue;
            for (const rival of other.anchorPrefixes ?? []) {
              if (prefix.startsWith(rival) || rival.startsWith(prefix)) {
                // Sorted so the pair is reported once rather than from each
                // side of the overlap.
                const [a, b] = [`${prefix}* (${tab.key})`, `${rival}* (${other.key})`].sort();
                contested.push(`#${a} and #${b} overlap`);
              }
            }
          }
        }
      }

      expect(
        [...new Set(contested)],
        `two ${page.label} tabs claim these, so which one a link opens is decided by the order the tabs ` +
          "happen to be listed in — narrow one of the claims",
      ).toEqual([]);
    });
  }
});

describe("an anchor on always-visible chrome belongs to no tab", () => {
  for (const page of tabbedPages()) {
    if (page.pageAnchors.length === 0) continue;
    it(`keeps the ${page.label} header anchors out of every tab`, () => {
      const swept = page.pageAnchors
        .filter((anchor) => claimantsOf(page.tabs, anchor).length > 0)
        .map((anchor) => `#${anchor}: also claimed by ${claimantsOf(page.tabs, anchor).join(", ")}`);

      expect(
        swept,
        `these ${page.label} ids are rendered above the tab strip and are on screen whichever tab is open, ` +
          "so a tab claiming one turns a scroll into a tab switch that discards the tab the reader asked for",
      ).toEqual([]);
    });
  }
});

describe("every deep link this product mints lands somewhere real", () => {
  for (const page of tabbedPages()) {
    it(`resolves each link into the ${page.label}`, () => {
      const links = deepLinksInto(page.linkPrefix);
      const stranded = links
        .filter(
          (link) =>
            !page.pageAnchors.includes(link.anchor) &&
            pageTabForAnchor(page.tabs, link.anchor, page.pageAnchors) === null,
        )
        .map((link) => `${link.file}: ${link.href}`);

      expect(
        [...new Set(stranded)],
        `these links point at ids no ${page.label} tab claims and no header anchor exempts, so they open ` +
          "the default tab with their target unrendered",
      ).toEqual([]);
    });
  }

  it("is walking a tree that still has links in it", () => {
    // A walk that found nothing would pass everything above. The project page
    // alone carries dozens of `#project-invoices` call sites.
    const projectLinks = deepLinksInto("projects");
    expect(projectLinks.length).toBeGreaterThan(20);
    expect(deepLinksInto("reports").length).toBeGreaterThan(0);
    expect(deepLinksInto("no-such-route-segment")).toEqual([]);
  });
});
