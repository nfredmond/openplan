import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { PageTabDefinition } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "./helpers/source-text";
import { anchorLinks } from "./page-tabs-guard-source";
import { buildProjectTabs } from "@/app/(app)/projects/[projectId]/_components/_tabs";
import { buildCampaignTabs } from "@/app/(app)/engagement/[campaignId]/_tabs";
import { buildRtpCycleTabs } from "@/app/(app)/rtp/[rtpCycleId]/_tabs";

/**
 * AN ANCHOR A TAB CLAIMS MUST HAVE AN ELEMENT TO LAND ON.
 *
 * `page-tabs-anchor-coverage` walks the links and proves each one resolves to a
 * tab. This walks the OTHER half, which was missing entirely: sixteen declared
 * anchors were `data-testid` values with no matching element id anywhere in the
 * repo. Nothing failed, because the resolution half was perfectly healthy — the
 * link opened the right tab and then scrolled nowhere, which looks like a page
 * that simply did not move.
 *
 * A `data-testid` is not an anchor. Only `id` is.
 *
 * WHAT THIS CANNOT SEE. It scans the whole `src` tree, so it proves an element
 * with that id EXISTS, not that it exists on the page whose tab claims it — a
 * cross-page mistake would still pass. It also cannot see whether the element
 * renders in the current state (an id inside a branch nobody reaches is an id
 * as far as this is concerned). What it does catch is the case that actually
 * shipped: an anchor whose element was never given an id at all.
 */

const SRC = path.join(process.cwd(), "src");

const NO_PROJECT_FAILURES = {
  overview: { reports: false, stageGates: false },
  delivery: { milestones: false, submittals: false },
  funding: { profile: false, awards: false, opportunities: false, invoices: false },
  evidence: { datasets: false, runs: false, aerial: false },
  record: { risks: false, issues: false, decisions: false, meetings: false },
};

const NO_CAMPAIGN_FAILURES = {
  categoriesUnreadable: false,
  itemsUnreadable: false,
  projectUnreadable: false,
  reportsUnreadable: false,
  reportSectionLinksUnreadable: false,
  rtpCycleUnreadable: false,
  rtpChapterUnreadable: false,
  crashCorroborationUnreadable: false,
};

const NO_CYCLE_FAILURES = {
  overview: { packetReports: false, packetArtifacts: false },
  projects: { links: false },
  financial: { horizonBands: false, assumptions: false, measures: false },
  document: { chapters: false },
  comments: { campaigns: false, items: false },
};

/** Restated from `report-standard-detail.tsx`; that restatement is guarded in
 * `page-tabs-anchor-coverage.test.ts`. */
const REPORT_TABS: PageTabDefinition<"packet" | "evidence" | "history">[] = [
  {
    key: "packet",
    label: "Packet",
    anchors: ["packet-release-review", "report-narrative-draft-panel"],
    anchorPrefixes: ["narrative-grounding-line-"],
  },
  { key: "evidence", label: "Evidence", anchorPrefixes: ["artifact-"] },
  { key: "history", label: "History", anchors: ["drift-since-generation", "evidence-chain-summary"] },
];

const TABBED_PAGES: Array<{ label: string; tabs: readonly PageTabDefinition<string>[] }> = [
  { label: "project detail", tabs: buildProjectTabs(NO_PROJECT_FAILURES) },
  { label: "engagement console", tabs: buildCampaignTabs(NO_CAMPAIGN_FAILURES) },
  { label: "RTP cycle", tabs: buildRtpCycleTabs(NO_CYCLE_FAILURES) },
  { label: "report detail", tabs: REPORT_TABS },
];

function componentFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // An id in a test fixture is not an id a planner can scroll to.
      if (entry === "test") continue;
      componentFiles(full, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every element id the product renders, split by how it is written.
 *
 * `exact` is a plain `id="project-invoices"`. `templatePrefixes` is the literal
 * head of an interpolated id — `id={`project-invoice-${row.id}`}` contributes
 * `project-invoice-`. Attributes whose name merely ENDS in `id` are read the
 * same way (`anchorId={...}`), because a component that takes its anchor as a
 * prop and renders it as `id={anchorId}` is otherwise invisible here; the
 * literal at the call site is the only place the id is spelled out.
 */
function collectRenderedIds(): { exact: Set<string>; templatePrefixes: string[] } {
  const exact = new Set<string>();
  const templatePrefixes = new Set<string>();

  for (const file of componentFiles(SRC)) {
    // Comments first. A component's header comment quoting `id="foo"` as an
    // example would otherwise satisfy this guard with prose.
    const source = stripSourceComments(readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\sid="([a-z][a-z0-9-]*)"/g)) {
      exact.add(match[1]);
    }
    for (const match of source.matchAll(/\s[A-Za-z]*[iI]d=\{`([a-z][a-z0-9-]*)\$\{/g)) {
      templatePrefixes.add(match[1]);
    }
  }

  return { exact, templatePrefixes: [...templatePrefixes] };
}

const RENDERED = collectRenderedIds();

/**
 * True when at least one id the product renders would match this prefix.
 *
 * ANY ONE SIBLING SATISFIES IT, and that is as much as a prefix claim can ask
 * for. `rtp-chapter-draft-` is matched by four separate id families — `-assist-`,
 * `-insert-`, `-dismiss-`, `-inserted-` — and each of the four can be deleted
 * on its own without this noticing, which was read as a hole in this guard. It
 * is not one that can be closed here: a prefix claim says "ids under this head
 * belong to this tab", an open-ended statement about ids that do not exist yet,
 * and there is no list of the ids it ought to cover to check against. Turning
 * the four into exact `anchors` would be worse — the page renders one panel per
 * chapter, so a bare id would repeat down the page and every deep link would
 * land on whichever copy came first.
 *
 * What CAN be closed is the half that matters to a reader: the specific
 * fragments the product actually links to. Those are checked one at a time
 * against the id that would receive them, in the sibling describe below.
 */
function prefixHasAnElement(prefix: string): boolean {
  if (RENDERED.templatePrefixes.some((head) => head.startsWith(prefix))) return true;
  return [...RENDERED.exact].some((id) => id.startsWith(prefix) && id.length > prefix.length);
}

describe("the id scan is looking at the real product", () => {
  it("finds ids, and does not find ones that are not there", () => {
    // A scanner that matched nothing would pass every assertion below.
    expect(RENDERED.exact.size).toBeGreaterThan(100);
    expect(RENDERED.templatePrefixes.length).toBeGreaterThan(5);
    expect(RENDERED.exact.has("no-element-has-this-id")).toBe(false);
    expect(prefixHasAnElement("no-element-has-this-prefix-")).toBe(false);
  });

  it("does not count a data-testid as an anchor", () => {
    // The exact defect: sixteen anchors were testids. `data-testid="x"` must
    // not satisfy a claim on `x`, which is why the pattern requires the
    // attribute to be `id` preceded by whitespace.
    const sample = ' <div data-testid="testid-that-is-not-an-anchor" />';
    expect([...sample.matchAll(/\sid="([a-z][a-z0-9-]*)"/g)]).toHaveLength(0);
  });
});

describe("every anchor a tab claims has an element to scroll to", () => {
  for (const page of TABBED_PAGES) {
    it(`renders an element for each ${page.label} anchor`, () => {
      const missing: string[] = [];

      for (const tab of page.tabs) {
        for (const anchor of tab.anchors ?? []) {
          if (!RENDERED.exact.has(anchor)) missing.push(`${tab.key}: id="${anchor}"`);
        }
        for (const prefix of tab.anchorPrefixes ?? []) {
          if (!prefixHasAnElement(prefix)) missing.push(`${tab.key}: id starting "${prefix}"`);
        }
      }

      expect(
        missing,
        `these ${page.label} anchors have no element with a matching id, so a deep link to one opens ` +
          "the right tab and then scrolls nowhere — give the element an id, or claim the prefix the " +
          "element actually renders (a data-testid is not an anchor)",
      ).toEqual([]);
    });
  }
});

/**
 * EVERY FRAGMENT THIS PRODUCT LINKS TO, CHECKED ONE AT A TIME.
 *
 * The describe above walks the tab TABLE, so a prefix is satisfied by any one
 * sibling under it. This walks the LINKS instead — the actual hrefs in source —
 * and each one is answered by itself:
 *
 *   - `/reports/${id}#drift-since-generation` needs an element written
 *     `id="drift-since-generation"`. Nothing else counts.
 *   - `/reports/${id}#artifact-${artifact.id}` needs an element written
 *     ``id={`artifact-${…}`}`` — the head matched EXACTLY. A sibling family
 *     under a longer head (`artifact-custody-`) does not answer it, because the
 *     link builds an id that family never produces.
 *
 * That is the sibling hole closed where it is closable. The remaining gap is
 * stated rather than papered over: an id family nothing links to yet can still
 * be deleted silently, and this cannot see a link assembled from a variable, or
 * one living in a database row or a document rather than in source.
 *
 * It also proves EXISTENCE, not placement — the id is looked for anywhere in
 * `src`, so an element on a different page would satisfy it, and jsdom is not
 * involved at all here, so nothing about visibility or scrolling is proven.
 */
describe("every deep link in the product has an element with that exact id", () => {
  const ROUTE_SEGMENTS = ["projects", "engagement", "rtp", "reports"] as const;
  const links = ROUTE_SEGMENTS.flatMap((segment) => anchorLinks(segment));

  it("is reading the links it is meant to be checking", () => {
    // A walk that found nothing would pass the two cases below in silence.
    expect(links.length, "no deep links found at all — the link walk broke").toBeGreaterThan(20);
    expect(links.some((link) => link.interpolated), "no per-row deep links found").toBe(true);
  });

  it("has an element for every whole-id fragment linked to", () => {
    const orphaned = links
      .filter((link) => !link.interpolated && !RENDERED.exact.has(link.head))
      .map((link) => `${link.file}: ${link.href} — nothing renders id="${link.head}"`);

    expect(
      orphaned,
      "these links name a fragment no element carries, so following one scrolls nowhere",
    ).toEqual([]);
  });

  it("has an element for every per-row fragment linked to, matched head for head", () => {
    const heads = new Set(RENDERED.templatePrefixes);
    const orphaned = links
      .filter((link) => link.interpolated && !heads.has(link.head))
      .map((link) => `${link.file}: ${link.href} — no element is given an id built as \`${link.head}\${…}\``);

    expect(
      orphaned,
      "these links build a per-row fragment no element's id is built the same way — a sibling family " +
        "under a longer head does not answer them",
    ).toEqual([]);
  });
});
