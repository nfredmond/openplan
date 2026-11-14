import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { BCA_NARRATIVE_CAVEAT } from "@/lib/bca/parameters";
import { ENGAGEMENT_NARRATIVE_CAVEAT } from "@/lib/grants/engagement-evidence";
import { KB_NARRATIVE_CAVEAT } from "@/lib/grants/kb-evidence";
import { GRANT_MODELING_PLANNING_CAVEAT } from "@/lib/grants/modeling-evidence";
import { SAFETY_SEED_CAVEAT } from "@/lib/grants/safety-seed-origin";
import { MANAGED_RUN_MODE_KEYS } from "@/lib/models/run-modes";
import { buildProjectFundingSnapshot } from "@/lib/projects/funding";
import {
  buildAcceptedSectionNarratives,
  buildReportSectionFacts,
  factsHash,
  type ReportSectionFactsInput,
} from "@/lib/reports/narrative-drafts";

/**
 * AN ACCEPTED NARRATIVE STAYS CURRENT WHEN ONLY OUR WORDING CHANGES.
 *
 * Each accepted report narrative stores `facts_hash`, the hash of the fact
 * claims it was grounded on. Generation recomputes it and, on a mismatch,
 * prints "Underlying data changed since acceptance" on the narrative. So any
 * product sentence that becomes part of a claim is effectively a stored
 * value: rewording it (even punctuation, as the November 2026 em dash sweep
 * did) tells every planner their data changed when it did not.
 *
 * The hashes below were captured by running this exact fixture on main at
 * aed8dd948, before the sweep. They are equalities on purpose. If one moves,
 * a claim's wording changed: put the old wording back, or accept that every
 * saved narrative citing it will be flagged and say so in the change.
 *
 * The grant export cover works the same way with stored section text, so its
 * quoted caveats are pinned here too.
 *
 * Blind category: claims whose text comes from modules this fixture does not
 * reach (a comparable-funding block, county stages not listed here), and RTP
 * chapter drafts, whose facts_hash is stored but not yet compared.
 */

const FIXED = "2026-07-20T00:00:00.000Z";

/**
 * Claims print timestamps with formatFactDateTime(), which always formats in
 * UTC (KI-2026-11-02-055), so these hashes no longer depend on the time zone
 * of the process that runs them. The pins were captured with TZ=UTC, which is
 * also the zone the hosted site runs in.
 */

function fixture(): ReportSectionFactsInput {
  return {
    report: { title: "Corridor Board Packet", summary: "Quarterly packet.", report_type: "board_packet" },
    project: {
      name: "Main St Bridge",
      summary: "Replace the load-limited bridge.",
      status: "active",
      plan_type: "capital",
      delivery_phase: "design",
      updated_at: FIXED,
    },
    runs: [
      {
        id: "run-1",
        title: "Corridor screening",
        summary_text: "Screening summary text.",
        metrics: { overallScore: 72, confidence: "medium" },
        created_at: FIXED,
      },
      { id: "run-2", title: null, summary_text: null, metrics: null, created_at: null },
    ],
    // Every managed engine, so every engine's standing caveat is in a claim.
    citedModelRuns: MANAGED_RUN_MODE_KEYS.map((engineKey, index) => ({
      id: `model-${index}`,
      run_title: `Run ${engineKey}`,
      engine_key: engineKey,
      status: index % 2 === 0 ? "succeeded" : "failed",
      result_summary_json: index % 2 === 0 ? { overallScore: 61 } : null,
    })),
    citedCountyRuns: [
      {
        id: "county-1",
        run_name: "County validation",
        stage: "validated-screening",
        validation_summary_json: { passed: 4, warned: 1, failed: 0 },
      },
      { id: "county-2", run_name: null, stage: "bootstrap-incomplete", validation_summary_json: null },
    ],
    projectFundingSnapshot: buildProjectFundingSnapshot({
      profile: { funding_need_amount: 500000, local_match_need_amount: 50000, updated_at: FIXED },
      awards: [
        {
          awarded_amount: 200000,
          match_amount: 0,
          risk_flag: null,
          obligation_due_at: null,
          updated_at: FIXED,
          created_at: FIXED,
        },
      ],
      opportunities: [],
      invoices: [],
    }),
  };
}

const SECTIONS = ["status_snapshot", "executive_summary", "run_summaries"] as const;

/** factsHash per section for `fixture()`, captured on main at aed8dd948 with TZ=UTC. */
const HASH_AT_AED8DD948: Record<(typeof SECTIONS)[number], string> = {
  status_snapshot: "79136e7e13758afc92072fe071092b79cbd403b37f2d2aec3bb48a832ac86d95",
  executive_summary: "79136e7e13758afc92072fe071092b79cbd403b37f2d2aec3bb48a832ac86d95",
  run_summaries: "41643c4ca4a8b7617eb35dc066b43f22f3ca46f72e32f9f8be4015475970c4da",
};

type ZoneRun = {
  zone: string;
  fixedInZone: string;
  hashes: Record<(typeof SECTIONS)[number], string>;
};

/**
 * Builds the fact hashes in a fresh Node process whose host zone is `zone`.
 * Setting TZ there, not here, keeps the zone out of every other test sharing
 * this worker. The child reports the zone it actually ran in, because a TZ
 * value the runtime ignores would otherwise pass silently.
 */
function hashesInHostZone(zone: string): Promise<ZoneRun> {
  const childSource = `
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const { buildReportSectionFacts, factsHash } = await import(
  pathToFileURL(resolve("src/lib/reports/narrative-drafts.ts")).href
);
const input = JSON.parse(raw);
const sections = ${JSON.stringify(SECTIONS)};
process.stdout.write(JSON.stringify({
  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  fixedInZone: new Date(${JSON.stringify(FIXED)}).toLocaleString("en-US"),
  hashes: Object.fromEntries(sections.map((section) => [section, factsHash(buildReportSectionFacts(input, section))])),
}));
`;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", "--input-type=module", "--eval", childSource],
      { cwd: process.cwd(), env: { ...process.env, TZ: zone }, stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`fact hash child for ${zone} exited ${code}: ${stderr}`));
      else resolvePromise(JSON.parse(stdout) as ZoneRun);
    });
    child.stdin.end(JSON.stringify(fixture()));
  });
}

describe("accepted report narratives outlive copy edits", () => {
  it("builds the same fact hashes on a host in any time zone", async () => {
    const zones = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"];
    const runs = await Promise.all(zones.map(hashesInHostZone));

    // Each child really ran in its zone, and the fixture's timestamp reads
    // differently in all three, so equal hashes are not an accident of TZ.
    expect(runs.map((run) => run.zone)).toEqual(zones);
    expect(new Set(runs.map((run) => run.fixedInZone)).size).toBe(zones.length);

    const [utc, ...others] = runs;
    for (const run of others) expect({ zone: run.zone, hashes: run.hashes }).toEqual({ zone: run.zone, hashes: utc.hashes });
  }, 120_000);

  it("rebuilds the same fact hash that main stored before the em dash sweep", () => {
    const current = Object.fromEntries(
      SECTIONS.map((section) => [section, factsHash(buildReportSectionFacts(fixture(), section))])
    );
    expect(current).toEqual(HASH_AT_AED8DD948);
  });

  it("reads a narrative accepted on main as current, not as changed data", () => {
    const rows = SECTIONS.map((section, index) => ({
      id: `draft-${index}`,
      workspace_id: "workspace-1",
      target_kind: "report_section",
      target_id: "report-1",
      section_key: section,
      draft_markdown: "The project is active. [fact:1]",
      model: "claude",
      grounding_json: {},
      grounded_sentence_count: 1,
      total_sentence_count: 1,
      facts_hash: HASH_AT_AED8DD948[section],
      status: "accepted",
      accepted_markdown: null,
      accepted_by: "user-1",
      accepted_at: FIXED,
      created_by: "user-1",
      created_at: FIXED,
    }));
    const accepted = buildAcceptedSectionNarratives(rows, (section) =>
      factsHash(buildReportSectionFacts(fixture(), section))
    );
    expect(accepted.map((narrative) => [narrative.sectionKey, narrative.stale])).toEqual(
      SECTIONS.map((section) => [section, false])
    );
  });

  it("keeps the grant cover caveats that sections saved on main quote word for word", () => {
    // application-html.ts puts a caveat on the export cover when a saved final
    // section (or its draft) contains the caveat's exact text. Sections saved
    // before a rewording no longer match, and the caveat silently drops off.
    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    expect({
      GRANT_MODELING_PLANNING_CAVEAT: sha(GRANT_MODELING_PLANNING_CAVEAT),
      BCA_NARRATIVE_CAVEAT: sha(BCA_NARRATIVE_CAVEAT),
      ENGAGEMENT_NARRATIVE_CAVEAT: sha(ENGAGEMENT_NARRATIVE_CAVEAT),
      KB_NARRATIVE_CAVEAT: sha(KB_NARRATIVE_CAVEAT),
      SAFETY_SEED_CAVEAT: sha(SAFETY_SEED_CAVEAT),
    }).toEqual({
      // Captured on main at aed8dd948.
      GRANT_MODELING_PLANNING_CAVEAT: "3e3d671c34e4f6cc2cbafc6ee28b407a9e3acde8843f4213c96ae6ee6400662a",
      BCA_NARRATIVE_CAVEAT: "35f2ba9c84ae5077288151758ff4c79c209015157540b5ad69b36528f54ced5f",
      ENGAGEMENT_NARRATIVE_CAVEAT: "e432f61530b46d7bdd5089d2f3931d0c9e60ef428e40804f868eb4a311f1789b",
      KB_NARRATIVE_CAVEAT: "9cb6ca7da2b41e0c9074111a6fcf8587b942567393b239cda8a4b75432174cd4",
      SAFETY_SEED_CAVEAT: "623d301f39b768c6f4777ed6ff7f5b9267df061fd59ef02d28809c03b4820341",
    });
  });
});
