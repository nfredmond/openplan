import { describe, expect, it } from "vitest";
import { buildRtpExportHtml, normalizeRtpLinkedProjects } from "@/lib/rtp/export";

describe("buildRtpExportHtml", () => {
  it("adds a release-review scan summary before packet sections", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-scan",
        workspace_id: "workspace-scan",
        title: "2027 RTP",
        status: "draft",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2026-06-01T00:00:00.000Z",
        public_review_open_at: "2026-04-20T00:00:00.000Z",
        public_review_close_at: "2026-05-20T00:00:00.000Z",
        summary: "Cycle summary",
        updated_at: "2026-04-16T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-scan",
          title: "Financial plan",
          section_type: "financial_plan",
          status: "ready_for_review",
          summary: "Chapter summary",
          guidance: "",
          content_markdown: "Draft content",
          sort_order: 10,
        },
      ],
      linkedProjects: normalizeRtpLinkedProjects([
        {
          id: "link-scan",
          project_id: "project-scan",
          portfolio_role: "constrained",
          priority_rationale: "Priority rationale",
          projects: {
            id: "project-scan",
            name: "Main Street Safety",
            status: "active",
            delivery_phase: "analysis",
            summary: "Project summary",
          },
        },
      ]),
      campaigns: [
        {
          id: "campaign-scan",
          title: "Planwide comments",
          status: "active",
          engagement_type: "comment_collection",
          summary: "Collect planwide feedback",
          rtp_cycle_chapter_id: null,
        },
      ],
      options: { sectionKeys: ["cycle_overview", "adoption_readiness"] },
    });

    expect(html).toContain("Release-review scan summary");
    expect(html).toContain("Use this packet summary for a quick completeness pass");
    expect(html).toContain("1/1</strong><span>chapters complete or ready");
    expect(html).toContain("Included sections:</strong> Cycle Overview · Adoption Readiness");
    expect(html.indexOf("Release-review scan summary")).toBeLessThan(html.indexOf("Cycle overview"));
  });

  it("renders public review loop posture when provided", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-1",
        workspace_id: "workspace-1",
        title: "2027 RTP",
        status: "public_review",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2026-06-01T00:00:00.000Z",
        public_review_open_at: "2026-04-20T00:00:00.000Z",
        public_review_close_at: "2026-05-20T00:00:00.000Z",
        summary: "Cycle summary",
        updated_at: "2026-04-16T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-1",
          title: "Consultation and engagement",
          section_type: "engagement",
          status: "ready_for_review",
          summary: "Chapter summary",
          guidance: "Chapter guidance",
          content_markdown: "Draft content",
          sort_order: 10,
        },
      ],
      linkedProjects: normalizeRtpLinkedProjects([
        {
          id: "link-1",
          project_id: "project-1",
          portfolio_role: "constrained",
          priority_rationale: "Priority rationale",
          projects: {
            id: "project-1",
            name: "Main Street Safety",
            status: "active",
            delivery_phase: "analysis",
            summary: "Project summary",
          },
        },
      ]),
      campaigns: [
        {
          id: "campaign-1",
          title: "Planwide comments",
          status: "active",
          engagement_type: "comment_collection",
          summary: "Collect planwide feedback",
          rtp_cycle_chapter_id: null,
        },
      ],
      options: {
        titleSuffix: "OpenPlan RTP Packet",
        publicReviewSummary: {
          label: "Comment-response foundation ready",
          detail: "5 approved comments are ready for packet handoff and the current RTP packet is in place for review closure.",
          tone: "success",
          actionItems: ["Carry approved comments into the board-ready response summary."],
          cycleLevelCampaignCount: 1,
          chapterLevelCampaignCount: 0,
          pendingCommentCount: 0,
          readyCommentCount: 5,
        },
      },
    });

    expect(html).toContain("Comment-response foundation ready");
    expect(html).toContain("5 approved comments are ready for packet handoff");
    expect(html).toContain("1 cycle targets · 0 chapter targets · 5 ready comments · 0 pending comments");
  });

  it("exports captured RTP funding source context with explicit operator-review caveats", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-funding",
        workspace_id: "workspace-funding",
        title: "2027 RTP",
        status: "draft",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2026-06-01T00:00:00.000Z",
        public_review_open_at: "2026-04-20T00:00:00.000Z",
        public_review_close_at: "2026-05-20T00:00:00.000Z",
        summary: "Cycle summary",
        updated_at: "2026-05-10T00:00:00.000Z",
      },
      chapters: [],
      linkedProjects: normalizeRtpLinkedProjects([
        {
          id: "link-funding",
          project_id: "project-funding",
          portfolio_role: "constrained",
          priority_rationale: "Primary implementation package.",
          projects: {
            id: "project-funding",
            name: "SR-49 safety package",
            status: "active",
            delivery_phase: "programming",
            summary: "Safety implementation package.",
            updated_at: "2026-05-09T10:00:00.000Z",
          },
        },
      ]),
      campaigns: [],
      options: {
        sectionKeys: ["portfolio_posture"],
        fundingSnapshot: {
          capturedAt: "2026-05-10T12:00:00.000Z",
          latestSourceUpdatedAt: "2026-05-10T12:00:00.000Z",
          linkedProjectCount: 1,
          trackedProjectCount: 1,
          fundedProjectCount: 0,
          likelyCoveredProjectCount: 1,
          gapProjectCount: 1,
          committedFundingAmount: 500000,
          likelyFundingAmount: 750000,
          totalPotentialFundingAmount: 1250000,
          unfundedAfterLikelyAmount: 250000,
          paidReimbursementAmount: 0,
          outstandingReimbursementAmount: 500000,
          uninvoicedAwardAmount: 500000,
          awardRiskCount: 0,
          label: "Partially funded",
          reason: "Likely dollars do not yet cover the full RTP implementation need.",
          reimbursementLabel: "Reimbursement not complete",
          reimbursementReason: "A paid reimbursement record is not yet complete.",
        },
        fundingProfileScans: [
          {
            projectId: "project-funding",
            projectName: "SR-49 safety package",
            portfolioRole: "constrained",
            priorityRationale: "Primary implementation package.",
            latestFundingSourceUpdatedAt: "2026-05-10T12:00:00.000Z",
            scan: {
              generatedAt: "2026-05-10T12:00:00.000Z",
              status: "attention",
              label: "Funding profile needs operator review",
              nextAction: "Review source context and funding-source criteria before reusing the evidence in a grant package.",
              lanes: [],
            },
          },
        ],
        fundingSourceContextReadiness: {
          capturedAt: "2026-05-10T12:00:00.000Z",
          status: "attention",
          label: "RTP funding source context needs operator review",
          detail: "1 linked project funding scan needs operator review before strong RTP funding language is reused.",
          linkedProjectScanCount: 1,
          readyProjectScanCount: 0,
          attentionProjectScanCount: 1,
          blockedProjectScanCount: 0,
          modelingEvidenceCount: 0,
          engagementReadyForHandoffCount: 0,
          enabledSectionCount: 1,
          operatorReviewCaveat:
            "Operator review required. This funding/source-context scan supports planning packet review only; it is not legal compliance automation, award prediction, or autonomous approval.",
        },
      },
    });

    expect(html).toContain("Funding source context");
    expect(html).toContain("Captured during packet generation");
    expect(html).toContain("Partially funded");
    expect(html).toContain("$500,000");
    expect(html).toContain("$250,000");
    expect(html).toContain("SR-49 safety package");
    expect(html).toContain("Funding profile needs operator review");
    expect(html).toContain("Operator-review caveat");
    expect(html).toContain("not legal compliance automation, award prediction, or autonomous approval");
    expect(html).not.toMatch(/grant-award/i);
    expect(html).not.toMatch(/legal (?:sign-off|approval|determination) (?:is|was) (?:ready|complete|granted)/i);
    expect(html).not.toMatch(/autonomous (?:approval|planning|decision) (?:is|was) (?:ready|complete|granted)/i);
  });

  it("embeds .chapter-markdown styles and wraps tables in standalone exports", () => {
    const chapterMarkdown = [
      "## Existing conditions",
      "",
      "> Screening-grade only — not for regulatory use.",
      "",
      "| Facility | Observed | Modeled |",
      "| --- | ---: | ---: |",
      "| SR-174 | 73,666 | 34,775 |",
    ].join("\n");

    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-standalone",
        workspace_id: "workspace-standalone",
        title: "2027 RTP",
        status: "draft",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: null,
        public_review_open_at: null,
        public_review_close_at: null,
        summary: "Cycle summary",
        updated_at: "2026-04-16T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-standalone",
          title: "Existing conditions",
          section_type: "performance",
          status: "ready_for_review",
          summary: "",
          guidance: "",
          content_markdown: chapterMarkdown,
          sort_order: 10,
        },
      ],
      linkedProjects: [],
      campaigns: [],
      options: { titleSuffix: "OpenPlan RTP Packet" },
    });

    expect(html).toMatch(/<style>[\s\S]*\.chapter-markdown\s*\{/);
    expect(html).toMatch(/<style>[\s\S]*\.chapter-markdown-table-wrap\s*\{/);
    expect(html).toContain('<div class="chapter-markdown-table-wrap">');
    expect(html).toMatch(/<div class="chapter-markdown-table-wrap">\s*<table/);
    expect(html).toMatch(/<td[^>]*>73,666<\/td>/);
  });

  it("renders assignment modeling evidence beside model-backed RTP language", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-modeling",
        workspace_id: "workspace-modeling",
        title: "2027 RTP",
        status: "draft",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: null,
        public_review_open_at: null,
        public_review_close_at: null,
        summary: "Cycle summary",
        updated_at: "2026-04-24T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-modeling",
          title: "Existing conditions",
          section_type: "performance",
          status: "ready_for_review",
          summary: "Model-backed existing conditions.",
          guidance: "",
          content_markdown: "The screening run identifies capacity stress on SR-174.",
          sort_order: 10,
        },
      ],
      linkedProjects: [],
      campaigns: [],
      options: {
        titleSuffix: "OpenPlan RTP Packet",
        modelingEvidence: [
          {
            countyRunId: "county-run-1",
            runName: "Nevada County assignment screening",
            geographyLabel: "Nevada County, CA",
            stage: "validated-screening",
            updatedAt: "2026-04-24T01:00:00.000Z",
            evidence: {
              claimDecision: {
                track: "assignment",
                claimStatus: "screening_grade",
                statusReason: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
                reasons: ["Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold."],
                validationSummary: {
                  passed: 3,
                  warned: 1,
                  failed: 1,
                  missingRequiredMetricKeys: [],
                  requiredMetricKeys: ["assignment_final_gap", "critical_absolute_percent_error"],
                },
                decidedAt: "2026-04-24T01:00:00.000Z",
              },
              reportLanguage:
                "Screening-grade modeling result. Use for planning context only, and include the validation caveats before making any outward claim.",
              sourceManifests: [
                {
                  id: "source-1",
                  sourceKey: "observed_count_validation",
                  sourceKind: "local_public_counts",
                  sourceLabel: "Observed count validation",
                  sourceUrl: null,
                  sourceVintage: "2026",
                  geographyId: "06057",
                  geographyLabel: "Nevada County, CA",
                  licenseNote: "Public agency count data.",
                  citationText: "Observed public count validation for Nevada County.",
                },
              ],
              validationResults: [
                {
                  id: "validation-1",
                  track: "assignment",
                  metricKey: "critical_absolute_percent_error",
                  metricLabel: "Critical facility absolute percent error",
                  observedValue: 237.62,
                  thresholdValue: 50,
                  thresholdMaxValue: null,
                  thresholdComparator: "lte",
                  status: "fail",
                  blocksClaimGrade: true,
                  detail: "Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.",
                  sourceManifestId: "source-1",
                  evaluatedAt: "2026-04-24T01:00:00.000Z",
                },
              ],
            },
          },
        ],
      },
    });

    expect(html).toContain("Assignment modeling claim posture");
    expect(html).toContain("Screening-grade modeling result");
    expect(html).toContain("Worst matched facility APE 237.62% exceeds the 50% claim-grade threshold.");
    expect(html).toContain("3 pass · 1 warning · 1 fail");
    expect(html).toContain("Observed count validation");
    expect(html).toContain("Export proof:");
    expect(html).toContain("No raw behavioral-onramp KPI rows are read by export metadata helpers.");
    expect(html).toContain("regenerate the packet if county-run evidence");
  });

  it("renders a scan-friendly adoption record checklist in adoption readiness", () => {
    const html = buildRtpExportHtml({
      cycle: {
        id: "cycle-adoption",
        workspace_id: "workspace-adoption",
        title: "2027 RTP",
        status: "public_review",
        geography_label: "Nevada County",
        horizon_start_year: 2027,
        horizon_end_year: 2050,
        adoption_target_date: "2026-06-15T00:00:00.000Z",
        public_review_open_at: "2026-04-20T00:00:00.000Z",
        public_review_close_at: "2026-05-20T00:00:00.000Z",
        summary: "Cycle summary",
        updated_at: "2026-05-09T00:00:00.000Z",
      },
      chapters: [
        {
          id: "chapter-adoption",
          title: "Adoption package and compliance appendix",
          section_type: "compliance",
          status: "ready_for_review",
          summary: "Resolution and findings are staged for board review.",
          guidance: "Keep final resolution references attached after adoption.",
          content_markdown: "Draft adoption record",
          sort_order: 70,
        },
      ],
      linkedProjects: [],
      campaigns: [],
      options: { sectionKeys: ["adoption_readiness"] },
    });

    expect(html).toContain("Adoption record checklist");
    expect(html).toContain("Board packet readiness, public-review dates");
    expect(html).toContain("<strong>Adoption/compliance chapter:</strong> Ready for Review");
    expect(html).toContain("Adoption package and compliance appendix is present in the chapter record.");
    expect(html).toContain("<strong>Chapter record:</strong> 1/1 complete or ready");
  });

});
