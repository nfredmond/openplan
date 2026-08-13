import { describe, expect, it } from "vitest";

import {
  idsReachableFromPanel,
  panelsOf,
  pageSource,
  prefixReachable,
  tabbedPages,
} from "./page-tabs-guard-source";

/**
 * THE TABS MUST ACTUALLY GROUP SOMETHING.
 *
 * This lane's whole promise is that a detail page which used to be one endless
 * scroll now shows one section at a time. Nothing in this repo tested that
 * promise. Replacing all five `active={activeTab === "…"}` on the project page
 * with `active={true}` — a strip that renders, links that navigate, and every
 * panel on screen at once — left ten `page-tabs-*` files and 166 tests green.
 * The same held on the other three pages.
 *
 * WHY IT IS STRUCTURAL, AND HOW FAR THAT GOES. jsdom applies no stylesheet and
 * has no box model, so no test in this suite can SEE that a panel is hidden;
 * `hidden`, `display:none` and a zero-height container are all indistinguishable
 * from a rendered panel to a DOM query. Rendering the page and asserting the
 * closed panels are absent would only work if `PageTabPanel` returned null,
 * which it does not. So this reads the source instead and asserts the two
 * things that can be read there, both of which the mutation above breaks:
 *
 *   1. Each panel's `active` is a COMPARISON between the tab resolved from the
 *      URL and that panel's own key — not a constant, and not another panel's
 *      key. `active={true}` fails; so does a copy-paste that leaves two panels
 *      comparing against the same key.
 *   2. Each anchor a tab CLAIMS is renderable from inside that tab's own panel.
 *      Grouping that is switched off still groups nothing, but grouping that is
 *      merely wrong — a panel moved to the neighbouring tab — is invisible to
 *      (1), and this is what catches it. The reachability walk lives in
 *      `page-tabs-guard-source.ts`, along with a statement of what it cannot
 *      see.
 *
 * What neither part proves is that a closed panel is invisible to a human. That
 * belongs to `PageTabPanel`'s own rendering and to a browser, and saying so is
 * more useful than a test whose name claims it.
 */

describe("every panel is gated on the tab resolved from the URL", () => {
  for (const page of tabbedPages()) {
    it(`groups the ${page.label} panels`, () => {
      const source = pageSource(page.file);

      // The identifier the page assigns `resolvePageTab`'s answer to. Taking it
      // from source rather than assuming `activeTab` keeps the assertion honest
      // if a page renames it, and proves the comparison below is against the
      // RESOLVED tab rather than against some other variable that happens to
      // hold a string.
      const activeVar = source.match(/const\s+([A-Za-z0-9_]+)\s*=\s*resolvePageTab\(/)?.[1];
      expect(activeVar, `${page.label} does not assign resolvePageTab's answer to anything`).toBeTruthy();

      const panels = panelsOf(source);
      expect(
        panels.map((panel) => panel.tabKey),
        `${page.label} renders a different set of panels than it declares tabs`,
      ).toEqual(page.tabs.map((tab) => tab.key));

      const ungrouped = panels
        .filter((panel) => {
          const active = panel.openTag.match(/active=\{([^}]*)\}/)?.[1]?.trim();
          return active !== `${activeVar} === "${panel.tabKey}"`;
        })
        .map((panel) => `${panel.tabKey}: ${panel.openTag.match(/active=\{[^}]*\}/)?.[0] ?? "no active prop"}`);

      expect(
        ungrouped,
        `these ${page.label} panels are not gated on \`${activeVar} === "<their own key>"\`, so the tab ` +
          "strip changes the URL and nothing else — every panel stays on screen whichever tab is open",
      ).toEqual([]);
    });
  }
});

/**
 * THREE CLAIMS THAT WERE ALREADY WRONG when this guard was first run, left
 * recorded rather than quietly excused. Fixing them means editing
 * `engagement/[campaignId]/_tabs.ts` and the page, which the lane that wrote
 * this guard did not own; the equality assertion below means the list can only
 * ever be edited DOWN — repairing one without deleting its line here fails just
 * as loudly as adding a fourth.
 *
 *   - `setup: survey-` and `analysis: demo-`: the only elements with those ids
 *     are in `public-survey-form.tsx` and `public-engagement-portal.tsx`, which
 *     render on `/engage/<token>`, `/embed/<token>` and the preview route — not
 *     on this console at all. Both claims are dead: they can switch a tab, and
 *     there is nothing on the far side to scroll to. `page-tabs-anchors-have-
 *     elements` passes them because it scans all of `src`, which is precisely
 *     the cross-page blind spot its own header admits to.
 *   - `responses: comment-import-preview`: the element is real, but
 *     `<CommentImportPanel>` is rendered inside the SETUP panel. A link to it
 *     opens Responses, where it is not.
 */
const KNOWN_MISPLACED_CLAIMS: Record<string, string[]> = {
  "engagement console": [
    "setup claims #survey-*",
    "responses claims #comment-import-preview",
    "analysis claims #demo-*",
  ],
};

describe("a tab's anchors are rendered by that tab's own panel", () => {
  for (const page of tabbedPages()) {
    it(`keeps each ${page.label} anchor inside the tab that claims it`, () => {
      const source = pageSource(page.file);
      const panels = new Map(panelsOf(source).map((panel) => [panel.tabKey, panel]));

      const misplaced: string[] = [];
      for (const tab of page.tabs) {
        const panel = panels.get(tab.key);
        if (!panel) {
          misplaced.push(`${tab.key}: declared as a tab but no panel renders it`);
          continue;
        }
        const reachable = idsReachableFromPanel(page.file, panel);

        for (const anchor of tab.anchors ?? []) {
          if (!reachable.exact.has(anchor)) misplaced.push(`${tab.key} claims #${anchor}`);
        }
        for (const prefix of tab.anchorPrefixes ?? []) {
          if (!prefixReachable(reachable, prefix)) misplaced.push(`${tab.key} claims #${prefix}*`);
        }
      }

      expect(
        misplaced.sort(),
        `nothing the ${page.label}'s own panel renders carries these anchors, so a deep link to one opens ` +
          "that tab and finds nothing there — either the panel moved to another tab and its claim did not, " +
          "or the element never got the id. If you have FIXED one of the recorded three, delete its line " +
          "from KNOWN_MISPLACED_CLAIMS in this file",
      ).toEqual([...(KNOWN_MISPLACED_CLAIMS[page.label] ?? [])].sort());
    });
  }
});
