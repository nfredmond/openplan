import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEMOGRAPHICS_SCREENING_CAVEAT,
  shapeDemographicsSummary,
  type DemographicsSummaryRow,
  type SelfReportedDemographicsSource,
} from "@/lib/engagement/demographics";
import {
  JOINT_READING_LABELS,
  type JointRepresentativeness,
} from "@/lib/engagement/joint-representativeness";
import {
  REPRESENTATIVENESS_SCREENING_CAVEAT,
  type CampaignRepresentativeness,
} from "@/lib/engagement/representativeness";
import { buildReportEngagementSummary } from "@/lib/reports/engagement";
import { buildCampaignReportHtml, type CampaignReportGenerationData } from "@/lib/reports/html";

/**
 * E5a + E5c reaching a REPORT, which is the half of the joint reading that makes
 * it worth computing. The ecological (ACS) screen already travelled into packets
 * and grants; the self-reported side stopped at the campaign page, so a planner
 * exporting a packet carried the inference about tracts and left behind the
 * answers actual respondents gave.
 *
 * Two things this file exists to make impossible:
 *   1. LAUNDERING. A k-anonymized aggregate whose suppression note is lost on
 *      the way into a report reads as a complete census of respondents. The note
 *      travels with the number or the number does not travel.
 *   2. A BARE HEADLINE. The joint sentence compares two screenings that share
 *      almost no vocabulary and count different people. Without the limits, it
 *      is a comparison the data does not support.
 */

const ROWS: DemographicsSummaryRow[] = [
  { dimension: "__meta__", band: "respondents_with_demographics", respondent_count: 20 },
  { dimension: "race_ethnicity", band: "white", respondent_count: 8 },
  { dimension: "race_ethnicity", band: "hispanic", respondent_count: 7 },
  { dimension: "race_ethnicity", band: "suppressed", respondent_count: 5 },
  { dimension: "household_tenure", band: "rent", respondent_count: 11 },
];

const UNDER_REPRESENTED_ACS: CampaignRepresentativeness = {
  metrics: [
    {
      key: "minority",
      label: "Residents of color (ACS)",
      baselinePct: 30,
      respondentPct: 12,
      representationRatio: 0.4,
      status: "under",
    },
  ],
  respondentCount: 24,
  tractCount: 6,
  underRepresented: ["minority"],
  caveat: REPRESENTATIVENESS_SCREENING_CAVEAT,
  computedAt: "2026-07-20T18:00:00.000Z",
  locatedRespondentCount: 31,
  studyAreaSource: "project_place",
};

function packetHtml(input: {
  selfReported: SelfReportedDemographicsSource;
  representativeness?: CampaignRepresentativeness | null;
}): { html: string; joint: JointRepresentativeness | null } {
  const engagement = buildReportEngagementSummary({
    campaign: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Corridor listening campaign",
      summary: null,
      status: "active",
      engagement_type: "comment_collection",
      share_token: null,
      updated_at: "2026-07-20T18:00:00.000Z",
    },
    categories: [],
    items: [],
    representativeness: input.representativeness ?? null,
    selfReported: input.selfReported,
  });

  if (!engagement) {
    throw new Error("engagement summary should build from a campaign row");
  }

  const data: CampaignReportGenerationData = {
    report: {
      id: "report-1",
      title: "Corridor engagement packet",
      summary: null,
      report_type: "engagement_summary",
      created_at: "2026-07-21T00:00:00.000Z",
    },
    workspace: { id: "ws-1", name: "Test Workspace" },
    engagement,
    sections: [
      {
        id: "section-1",
        section_key: "engagement_summary",
        title: "Engagement summary",
        enabled: true,
        sort_order: 0,
        config_json: {},
      },
    ],
  };

  return { html: buildCampaignReportHtml(data), joint: engagement.joint };
}

describe("a packet carrying the self-reported half of representativeness", () => {
  it("prints no published count without the suppression note and the screening caveat", () => {
    const { html } = packetHtml({
      selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
      representativeness: UNDER_REPRESENTED_ACS,
    });

    // The counts themselves reach the packet…
    expect(html).toContain("20 respondents shared optional demographics");
    expect(html).toContain("Hispanic / Latino 7");
    expect(html).toContain("Small groups (suppressed) 5");
    expect(html).toContain("Renter 11");
    // …and cannot arrive without what suppression did to them.
    expect(html).toContain("do not sum to the respondent total");
    expect(html).toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("never prints a percentage beside a suppressed band", () => {
    // Suppression + multi-select race make a share wrong by an unknown amount,
    // always upward. The campaign panel already refuses one; the packet must
    // not quietly reintroduce it.
    const { html } = packetHtml({
      selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
    });

    const selfReportedBlock = html.slice(html.indexOf("Self-reported respondent demographics"));
    const bandList = selfReportedBlock.slice(0, selfReportedBlock.indexOf("</ul>"));
    expect(bandList).not.toMatch(/\d%/);
  });

  it("carries the joint headline only alongside every limit it depends on", () => {
    const cases: SelfReportedDemographicsSource[] = [
      { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
      { state: "not_collected" },
      { state: "unreadable", message: "permission denied for function" },
    ];

    for (const selfReported of cases) {
      for (const representativeness of [UNDER_REPRESENTED_ACS, null]) {
        const { html, joint } = packetHtml({ selfReported, representativeness });
        if (!joint) {
          continue;
        }

        expect(joint.limits.length).toBeGreaterThan(0);
        expect(html).toContain(JOINT_READING_LABELS[joint.reading]);
        expect(html).toContain("What this cannot say");
        for (const limit of joint.limits) {
          expect(html).toContain(limit);
        }
        expect(html).toContain(joint.caveat);
      }
    }
  });

  it("withholds a headline that arrives without its limits instead of printing it bare", () => {
    const { joint } = packetHtml({
      selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
      representativeness: UNDER_REPRESENTED_ACS,
    });
    if (!joint) {
      throw new Error("expected a joint reading");
    }

    const engagement = buildReportEngagementSummary({
      campaign: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Corridor listening campaign",
        summary: null,
        status: "active",
        engagement_type: "comment_collection",
        share_token: null,
        updated_at: "2026-07-20T18:00:00.000Z",
      },
      categories: [],
      items: [],
      representativeness: UNDER_REPRESENTED_ACS,
      selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
    });
    if (!engagement?.joint) {
      throw new Error("expected a joint reading");
    }
    // Reach past the builder to the one shape the markup must refuse.
    const stripped = { ...engagement, joint: { ...engagement.joint, limits: [] } };

    const html = buildCampaignReportHtml({
      report: {
        id: "report-1",
        title: "Corridor engagement packet",
        summary: null,
        report_type: "engagement_summary",
        created_at: "2026-07-21T00:00:00.000Z",
      },
      workspace: { id: "ws-1", name: "Test Workspace" },
      engagement: stripped,
      sections: [
        {
          id: "section-1",
          section_key: "engagement_summary",
          title: "Engagement summary",
          enabled: true,
          sort_order: 0,
          config_json: {},
        },
      ],
    });

    expect(html).toContain("Joint representativeness reading withheld");
    expect(html).not.toContain(joint.headline);
  });

  it("does not read as unrepresentative when the campaign collected no demographics", () => {
    // The ACS screen flags under-representation, and that flag still travels —
    // but it is an inference about tracts. With no respondent answers there is
    // nothing that describes the people, and the packet has to say so.
    const { html } = packetHtml({
      selfReported: { state: "not_collected" },
      representativeness: UNDER_REPRESENTED_ACS,
    });

    expect(html).toContain(JOINT_READING_LABELS.ecological_only);
    expect(html).toContain("nothing here describes the people who actually responded");
    expect(html).toContain("This campaign is not collecting respondent demographics");
    // No counts were published, so no suppression note is owed — and none of the
    // self-reported block appears at all.
    expect(html).not.toContain("Self-reported respondent demographics (screening)");
    expect(html).not.toContain(DEMOGRAPHICS_SCREENING_CAVEAT);
  });

  it("does not read as representative when there is no ACS baseline to clear", () => {
    const { html } = packetHtml({
      selfReported: { state: "loaded", summary: shapeDemographicsSummary(ROWS) },
      representativeness: null,
    });

    expect(html).toContain(JOINT_READING_LABELS.self_reported_only);
    expect(html).toContain("There is no ACS baseline for this area to compare that against");
    expect(html).not.toContain("Both screenings point the same way");
  });

  it("reports a failed demographics read as unknown, never as nobody answering", () => {
    const { html } = packetHtml({
      selfReported: { state: "unreadable", message: "permission denied for function" },
      representativeness: UNDER_REPRESENTED_ACS,
    });

    expect(html).toContain(JOINT_READING_LABELS.self_reported_unreadable);
    expect(html).toContain("Reported cause: permission denied for function");
    expect(html).toContain("must not be reported as an absence of respondent demographics");
    expect(html).not.toContain("No respondent has shared demographics");
  });
});

describe("the report generator's own reach into the self-reported aggregate", () => {
  const source = readFileSync(
    join(process.cwd(), "src/app/api/reports/[reportId]/generate/route.ts"),
    "utf8"
  );

  /**
   * A source guard must read the CODE, never the prose explaining it. Both
   * campaign reads carry a comment saying why `demographics_enabled` has to be
   * selected — and while this guard scanned the whole call chunk, that comment
   * satisfied it: the column could be deleted from both `.select()` strings and
   * this file stayed green, which is the one thing it exists to prevent.
   */
  const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("cannot read one representativeness signal into a packet without the other", () => {
    // These Supabase clients are untyped on purpose, so a column left out of a
    // .select() string is `undefined` at runtime rather than a type error — and
    // an undefined demographics_enabled would charge every campaign with "not
    // collecting demographics" in a document handed to a funder.
    //
    // The invariant is stated over the ECOLOGICAL column: any campaign read that
    // carries representativeness_json is feeding a packet, and a packet that
    // gets the area-based screen must also get the opt-in switch that decides
    // whether the self-reported side can be read at all. (The RTP path lists
    // campaigns without either column and is correctly out of scope.)
    const packetCampaignSelects = sourceWithoutComments
      .split('.from("engagement_campaigns")')
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf(".eq(")))
      // The COLUMN LIST itself, not the call chunk around it.
      .map((chunk) => /\.select\(\s*"([^"]*)"/.exec(chunk)?.[1] ?? "")
      .filter((columns) => columns.includes("representativeness_json"));

    expect(packetCampaignSelects.length).toBe(2);
    for (const columns of packetCampaignSelects) {
      expect(columns.split(/\s*,\s*/)).toContain("demographics_enabled");
    }
  });

  it("loads the self-reported source and hands it to the packet builder on both paths", () => {
    const loads = sourceWithoutComments.match(/loadSelfReportedDemographicsSource\(/g) ?? [];
    const handoffs = sourceWithoutComments.match(/selfReported: \w+/g) ?? [];

    expect(loads.length).toBe(2);
    expect(handoffs.length).toBe(2);
  });
});
