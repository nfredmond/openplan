import { describe, expect, it } from "vitest";
import { buildCountyRunDetailHref, getSafeCountyRunsBackHref } from "@/lib/ui/county-runs-navigation";

describe("county-runs navigation helpers", () => {
  it("keeps county dashboard filter URLs as safe back links", () => {
    expect(getSafeCountyRunsBackHref("/county-runs?view=needs-attention&sort=median-ape-asc")).toBe(
      "/county-runs?view=needs-attention&sort=median-ape-asc"
    );
  });

  it("falls back to the county runs base path for unsafe back links", () => {
    expect(getSafeCountyRunsBackHref("https://example.com/elsewhere")).toBe("/county-runs");
    expect(getSafeCountyRunsBackHref("/projects")).toBe("/county-runs");
  });

  it("builds county detail URLs with the preserved dashboard context", () => {
    expect(
      buildCountyRunDetailHref(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "/county-runs?view=needs-attention&sort=median-ape-asc"
      )
    ).toBe(
      "/county-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?backTo=%2Fcounty-runs%3Fview%3Dneeds-attention%26sort%3Dmedian-ape-asc"
    );
  });
});
