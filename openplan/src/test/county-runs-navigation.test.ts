import { describe, expect, it } from "vitest";
import {
  buildCountyRunDetailHref,
  getCountyRunsBackContextLabel,
  getSafeCountyRunsBackHref,
} from "@/lib/ui/county-runs-navigation";

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

  it("describes the saved county dashboard context", () => {
    expect(
      getCountyRunsBackContextLabel(
        "/county-runs?view=needs-attention&runtimeStatus=behavioral_runtime_blocked&runtimeMode=preflight_only"
      )
    ).toBe("View: Needs attention · Sort: Recently updated · Runtime: Runtime blocked · Mode: Preflight only");
  });

  it("describes the evidence-ready county dashboard context", () => {
    expect(getCountyRunsBackContextLabel("/county-runs?view=evidence-ready&sort=median-ape-asc")).toBe(
      "View: Evidence-ready · Sort: Lowest median APE"
    );
  });

  it("does not describe the default county runs page as a saved dashboard context", () => {
    expect(getCountyRunsBackContextLabel("/county-runs")).toBeNull();
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
