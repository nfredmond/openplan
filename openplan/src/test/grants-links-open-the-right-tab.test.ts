import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GRANTS_TABS, defaultGrantsTab } from "@/app/(app)/grants/_tabs";
import { pageTabForAnchor } from "@/lib/ui/page-tabs";
import { stripSourceComments } from "@/test/helpers/source-text";

/*
  GRANTS LINKS OPEN THE RIGHT TAB.

  The Grants page became three tabs on October 10, 2026. More than fifty
  places in the product link into it with a fragment ("/grants#grants-gap-
  resolution-lane", "/grants?focusOpportunityId=…#funding-opportunity-…").
  A fragment no tab claims opens Opportunities with its target unrendered, a
  link that goes nowhere. The shared tab guards match record pages with an id
  segment (`/rtp/<id>#…`), which an index page does not have, so this is the
  same check for /grants.

  Blind category: a link assembled from parts at runtime, such as a fragment
  held in a variable.
*/
const SRC = path.join(process.cwd(), "src");
const LINK = /\/grants(?:\?[^\s"'`#]*)?#([a-z][a-z0-9-]*)(\$\{)?/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const links = sourceFiles(SRC).flatMap((file) =>
  [...stripSourceComments(readFileSync(file, "utf8")).matchAll(LINK)].map((match) => ({
    file: path.relative(SRC, file),
    anchor: match[2] ? `${match[1]}interpolated-id` : match[1],
  }))
);

describe("grants links open the right tab", () => {
  it("finds the links it is meant to check", () => {
    expect(links.length).toBeGreaterThan(20);
  });

  it("resolves every fragment to the tab that renders it", () => {
    const stranded = links
      .filter((link) => pageTabForAnchor(GRANTS_TABS, link.anchor) === null)
      .map((link) => `${link.file}: #${link.anchor}`);
    expect([...new Set(stranded)]).toEqual([]);
  });

  it("sends the most-linked target, the funding gap lane, to Funding gaps", () => {
    expect(pageTabForAnchor(GRANTS_TABS, "grants-gap-resolution-lane")).toBe("gaps");
    expect(pageTabForAnchor(GRANTS_TABS, "funding-opportunity-abc")).toBe("opportunities");
    expect(pageTabForAnchor(GRANTS_TABS, "funding-opportunity-creator-open")).toBe("gaps");
    expect(pageTabForAnchor(GRANTS_TABS, "invoice-record-abc")).toBe("awards");
  });

  it("opens on the work a focus parameter names when no tab is asked for", () => {
    expect(defaultGrantsTab({ invoiceId: null, fundingNeedProjectFocused: false, awardConversionFocused: false })).toBe(
      "opportunities"
    );
    expect(defaultGrantsTab({ invoiceId: "i1", fundingNeedProjectFocused: false, awardConversionFocused: false })).toBe(
      "awards"
    );
    expect(defaultGrantsTab({ invoiceId: null, fundingNeedProjectFocused: true, awardConversionFocused: false })).toBe(
      "gaps"
    );
  });
});
