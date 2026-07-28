import { describe, expect, it } from "vitest";

import {
  KIND_FILTERS,
  PURSUIT_KIND_LABELS,
  buildGrantsFilterHref,
  normalizeKindFilter,
  resolveOpportunityPursuitKind,
} from "@/lib/grants/page-helpers";

describe("grants registry kind filter", () => {
  it("normalizes only the known kinds, defaulting to all", () => {
    expect(KIND_FILTERS).toEqual(["all", "grant", "proposal"]);
    expect(normalizeKindFilter("proposal")).toBe("proposal");
    expect(normalizeKindFilter("grant")).toBe("grant");
    expect(normalizeKindFilter("rfp")).toBe("all");
    expect(normalizeKindFilter(undefined)).toBe("all");
  });

  it("labels the two kinds as an operator names them", () => {
    expect(PURSUIT_KIND_LABELS.grant).toBe("Grant application");
    expect(PURSUIT_KIND_LABELS.proposal).toBe("Proposal");
  });

  it("carries the kind through filter hrefs, omitting the default", () => {
    expect(buildGrantsFilterHref({ status: "all", decision: "all", kind: "proposal" })).toBe(
      "/grants?kind=proposal"
    );
    expect(buildGrantsFilterHref({ status: "open", decision: "pursue", kind: "proposal" })).toBe(
      "/grants?status=open&decision=pursue&kind=proposal"
    );
    expect(buildGrantsFilterHref({ status: "open", decision: "all", kind: "all" })).toBe(
      "/grants?status=open"
    );
    // Callers that predate the kind filter keep their exact old hrefs.
    expect(buildGrantsFilterHref({ status: "open", decision: "all" })).toBe("/grants?status=open");
  });

  it("resolves rows predating the pursuit migration as grants", () => {
    expect(resolveOpportunityPursuitKind({ pursuit_kind: "proposal" })).toBe("proposal");
    expect(resolveOpportunityPursuitKind({ pursuit_kind: "grant" })).toBe("grant");
    expect(resolveOpportunityPursuitKind({ pursuit_kind: null })).toBe("grant");
    expect(resolveOpportunityPursuitKind({})).toBe("grant");
  });
});
