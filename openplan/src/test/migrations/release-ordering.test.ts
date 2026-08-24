import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationFiles } from "./read-migrations";

/**
 * Once a release ships, no new migration may sort at or below its high-water
 * mark. `supabase migration up` applies only versions above the deployment's
 * applied maximum, so a migration inserted below a shipped mark is silently
 * skipped by every deployment already on that release — self-hosted schemas
 * fork from fresh installs and nobody sees it happen. The hazard is proven
 * in-repo: 20260321000033 was committed on 2026-04-04, eleven days AFTER
 * 20260324000134 which sorts after it (pre-release, so no promise broke —
 * post-1.0 the same slip is unrecoverable).
 *
 * RELEASE DUTY: cutting a release adds a row here (tag, last migration,
 * count — read them off `git ls-tree <tag>`) in the same commit that tags.
 * The CHANGELOG check below keeps the operator-facing migration story tied
 * to these recorded facts.
 */

const RELEASES: ReadonlyArray<{ tag: string; lastMigration: string; migrationsAtRelease: number }> = [
  {
    tag: "0.2.0",
    lastMigration: "20260730000005_aerial_artifact_custody_anon_revoke.sql",
    migrationsAtRelease: 157,
  },
  {
    tag: "0.3.0",
    lastMigration: "20260730000011_enable_rls_on_public_reference_tables.sql",
    migrationsAtRelease: 163,
  },
  {
    tag: "0.4.0",
    lastMigration: "20260805000001_us_federal_default_stage_gate_template.sql",
    migrationsAtRelease: 166,
  },
  // Tagged 2026-08-05 and MISSING FROM THIS TABLE UNTIL 2026-08-06, which is
  // the failure this guard is least able to report on itself: with the newest
  // release absent, `latest` pointed at 0.4.0, so the high-water mark was
  // checked against a line every deployment had already moved past and the
  // CHANGELOG assertion read the wrong section. A release-ordering guard that
  // does not know about the most recent release is guarding history.
  // Counts read off the tag itself (`git ls-tree -r --name-only v0.5.0`), not
  // from memory.
  {
    tag: "0.5.0",
    lastMigration: "20260805000003_rtp_financial_element.sql",
    migrationsAtRelease: 168,
  },
  // The transit lane: the GTFS service-level schema, its honesty columns, and
  // the atomic version promotion. Counts read off the tree at the tag, not
  // remembered.
  {
    tag: "0.6.0",
    lastMigration: "20260805000008_promote_gtfs_feed_version.sql",
    migrationsAtRelease: 173,
  },
  // 0.7.0 and 0.8.0 were BOTH missing from this table until 2026-08-10 — the
  // 0.5.0 failure above, repeated twice, discovered while cutting 0.9.0. For
  // four days `latest` pointed at 0.6.0: the high-water check guarded a line
  // every deployment had moved past, and the CHANGELOG assertion read the
  // 0.6.0 section. The RELEASE DUTY note above says "in the same commit that
  // tags" precisely so this cannot happen; it happened anyway, twice, because
  // a note asks and cannot enforce — and no assertion here can see a tag that
  // was never recorded. Counts read off `git ls-tree -r --name-only v0.7.0` /
  // `v0.8.0`, not from memory.
  {
    tag: "0.7.0",
    lastMigration: "20260805000009_title_vi_service_equity.sql",
    migrationsAtRelease: 174,
  },
  {
    tag: "0.8.0",
    lastMigration: "20260805000011_survey_question_draft_status.sql",
    migrationsAtRelease: 176,
  },
  // Repeat-failure history for model runs; the pass 8/9 engine audits, the
  // per-run zone-skew disclosure and the public per-cycle map ship in the same
  // release but add no schema beyond this one migration.
  {
    tag: "0.9.0",
    lastMigration: "20260810000001_model_run_failure_history.sql",
    migrationsAtRelease: 177,
  },
  // 0.10.0 — the coherence release: nav/first-run overhaul, cross-module
  // seams, and the engagement deploy path (slugs + multi-project coverage).
  {
    tag: "0.10.0",
    lastMigration: "20260810000003_engagement_campaign_projects.sql",
    migrationsAtRelease: 179,
  },
  // 0.11.0 — the agent reads the evidence; drone flight planning + exports.
  {
    tag: "0.11.0",
    lastMigration: "20260811000001_aerial_flight_plans.sql",
    migrationsAtRelease: 180,
  },
  // 0.12.0 — imagery OpenPlan owns, the in-house ODM worker, orthos on the map.
  {
    tag: "0.12.0",
    lastMigration: "20260811000004_aerial_processing_manifest_jobs.sql",
    migrationsAtRelease: 183,
  },
  // 0.13.0 — the document library: KB generalized into the workspace file index.
  {
    tag: "0.13.0",
    lastMigration: "20260811000005_document_library_stored_kinds.sql",
    migrationsAtRelease: 184,
  },
  // 0.14.0 — assignees, My Work, deadline digests, portfolio, work-plan templates.
  {
    tag: "0.14.0",
    lastMigration: "20260811000007_work_notifications.sql",
    migrationsAtRelease: 186,
  },
  // 0.15.0 — reading an adopted plan (transcription with page provenance),
  // the OCR worker, and the grant fix for 0.14.0's notification inbox.
  {
    tag: "0.15.0",
    lastMigration: "20260811000011_work_notifications_grants.sql",
    migrationsAtRelease: 190,
  },
  // 0.16.0 — the neutral crash vocabulary, deep collision filtering, people
  // as role/band/outcome, and safety evidence reaching RTP, BCA and grants.
  {
    tag: "0.16.0",
    lastMigration: "20260812000003_safety_crash_severity_counts.sql",
    migrationsAtRelease: 193,
  },
  // 0.17.0 — the drawdown ledger, the reimbursement worksheet, lapse dates,
  // and the two money figures that were wrong before it.
  {
    tag: "0.17.0",
    lastMigration: "20260812000010_award_expenditure_deadline.sql",
    migrationsAtRelease: 194,
  },
  // 0.18.0 — the self-help measure fund: receipts, ordinance rules as data,
  // sub-recipient claims, and the oversight record that reconciles.
  {
    tag: "0.18.0",
    lastMigration: "20260812000014_measure_off_the_top_and_atomic_allocation.sql",
    migrationsAtRelease: 198,
  },
  // 0.19.0 — workspace GIS layers: 6,688 coordinate systems, legacy
  // shapefiles placed where they belong, and the prime-meridian correction.
  {
    tag: "0.19.0",
    lastMigration: "20260812000018_workspace_gis_layer_references.sql",
    migrationsAtRelease: 201,
  },
  // 0.20.0 — the UX coherence pass: read-the-map mode, accessible muted text
  // in all ten palettes, one money format, one failure notice, one
  // confirmation. No schema change, so the migration head is unmoved — which
  // this table is happy to record: a release need not carry a migration.
  {
    tag: "0.20.0",
    lastMigration: "20260812000018_workspace_gis_layer_references.sql",
    migrationsAtRelease: 201,
  },
  // 0.21.0 — observed-count calibration and two behavioral demand methods on
  // one network, plus the engagement/safety seam, bounded create flows, and
  // seven additive migrations. Counts read from this release tree.
  {
    tag: "0.21.0",
    lastMigration: "20260822000001_work_notification_recipient_can_mark_read.sql",
    migrationsAtRelease: 208,
  },
  // 0.22.0 — nationwide HPMS count evidence, one acceptance rule for both
  // calibration drivers, and the frozen 32-county gateway-volume study. The
  // candidate failed its untouched holdout, so model defaults did not change.
  // No schema change; expanded credibility fields live in run artifacts.
  {
    tag: "0.22.0",
    lastMigration: "20260822000001_work_notification_recipient_can_mark_read.sql",
    migrationsAtRelease: 208,
  },
  // 0.23.0 — verified dual-model agreement evidence can be selected for a
  // report, frozen into its packet, and cited from that snapshot in grants.
  // No schema change; selections and snapshots use versioned JSON metadata.
  {
    tag: "0.23.0",
    lastMigration: "20260822000001_work_notification_recipient_can_mark_read.sql",
    migrationsAtRelease: 208,
  },
  // 0.24.0 — custody-verified aerial previews can be explicitly selected on
  // authenticated maps throughout the workspace. No schema change.
  {
    tag: "0.24.0",
    lastMigration: "20260822000001_work_notification_recipient_can_mark_read.sql",
    migrationsAtRelease: 208,
  },
  // 0.25.0 — the self-hosted ODM worker collects real NodeODM exports and
  // authenticated planning maps can zoom to a selected preview. No schema
  // change; the worker image gains GDAL for deterministic PNG rendering.
  {
    tag: "0.25.0",
    lastMigration: "20260822000001_work_notification_recipient_can_mark_read.sql",
    migrationsAtRelease: 208,
  },
  // 0.26.0 — a planner-selected held orthophoto can be frozen into a private
  // report packet and cited from that immutable snapshot in grant narratives.
  // The additive storage configuration migration admits PNG in report-artifacts.
  {
    tag: "0.26.0",
    lastMigration: "20260823000001_report_artifact_aerial_preview_mime.sql",
    migrationsAtRelease: 209,
  },
  // 0.27.0 — complete land-use-plan authoring and administration, with frozen
  // reviewed/adopted versions, exact map-version references, private tribal
  // consultation, publication, and annual implementation reports.
  {
    tag: "0.27.0",
    lastMigration: "20260823000006_land_use_plan_report_target.sql",
    migrationsAtRelease: 214,
  },
  // 0.28.0 — immutable public-review releases, exact finalized GIS hashes,
  // frozen adoption manifests, descriptor process records, and distinct
  // readable plan-packet and implementation-report targets.
  {
    tag: "0.28.0",
    lastMigration: "20260823000007_land_use_plan_review_reporting.sql",
    migrationsAtRelease: 215,
  },
  // 0.29.0 — fresh-account readiness closure: observed safety evidence,
  // reviewed project CSV intake, board-readable map and PDF handoffs, and the
  // resumable first-week harness that established the defects. Three additive
  // migrations; no user data is replaced.
  {
    tag: "0.29.0",
    lastMigration: "20260824000003_project_estimated_cost_and_csv_provenance.sql",
    migrationsAtRelease: 218,
  },
  // 0.30.0 — geography-matched legal setup with durable selection provenance,
  // explicit-override preservation, and honest neutral fallbacks. The one
  // additive migration leaves every pre-release workspace row unchanged.
  {
    tag: "0.30.0",
    lastMigration: "20260824000004_workspace_stage_gate_template_selection.sql",
    migrationsAtRelease: 219,
  },
];

const CHANGELOG_PATH = path.join(process.cwd(), "..", "CHANGELOG.md");

function version(name: string): string {
  return name.slice(0, 14);
}

function sectionNamesMigration(section: string, file: string): boolean {
  const slug = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_])${escaped}(?=$|[^a-z0-9_])`, "i").test(section);
}

describe("released migration ordering", () => {
  const files = migrationFiles();
  const latest = RELEASES[RELEASES.length - 1];

  it("every release's recorded last migration exists on disk", () => {
    const onDisk = new Set(files);
    const missing = RELEASES.filter((release) => !onDisk.has(release.lastMigration));
    expect(missing).toEqual([]);
  });

  it("no migration has been inserted at or below a shipped high-water mark", () => {
    for (const release of RELEASES) {
      const atOrBelow = files.filter((file) => version(file) <= version(release.lastMigration));
      // More files below the mark than shipped at the tag = an out-of-order
      // insertion that released deployments will silently skip. Fewer = a
      // released migration was deleted, which is just as unacceptable.
      expect(
        { tag: release.tag, migrationsAtOrBelowMark: atOrBelow.length },
        `migrations at or below the ${release.tag} mark must equal the count recorded at release — ` +
          `an inserted file there is silently skipped by every deployment already on ${release.tag}`
      ).toEqual({ tag: release.tag, migrationsAtOrBelowMark: release.migrationsAtRelease });
    }
  });

  it("new work sorts strictly after the latest release (no version collisions)", () => {
    const newFiles = files.filter((file) => version(file) > version(latest.lastMigration));
    const all = [...files].sort();
    // Filename sort IS version sort for the whole set, and versions are unique.
    expect(files).toEqual(all);
    const versions = files.map(version);
    expect(new Set(versions).size).toBe(versions.length);
    // Sanity: the split accounts for every file.
    expect(newFiles.length + latest.migrationsAtRelease).toBe(files.length);
  });

  it("the CHANGELOG's Unreleased section names every migration landed since the newest tag", () => {
    /**
     * THE HALF THE CHECK BELOW CANNOT SEE.
     *
     * That one verifies every migration a section REFERENCES exists. It cannot
     * notice a migration nobody referenced — and on 2026-08-22 the Unreleased
     * section read "**No migrations.** Pull and deploy." while six had landed
     * since v0.20.0, one of them a cross-workspace security fix. The
     * CHANGELOG's stated job is to lead with required migrations; an operator
     * following it would have deployed code against a schema missing all six,
     * and the measure-fund reserve feature errors against a table that is not
     * there.
     *
     * Matched on the migration's SLUG, not the six-digit shorthand the section
     * below uses: four of those six migrations are `…000001` on different
     * dates, so a suffix match would accept the wrong one and call it covered.
     *
     * Applied to UNRELEASED ONLY, deliberately. Requiring it of already-tagged
     * sections would demand editing dated records to say something they did not
     * say when written. Unreleased is the live section; by the time it is
     * tagged it is already complete.
     */
    const changelog = readFileSync(CHANGELOG_PATH, "utf8");
    const start = changelog.search(/^## Unreleased\b/m);
    expect(start, 'CHANGELOG.md must carry a "## Unreleased" section').toBeGreaterThan(-1);

    const rest = changelog.slice(start);
    const nextHeading = rest.slice(2).search(/^## /m);
    const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 2);

    const sinceRelease = files.filter((file) => version(file) > version(latest.lastMigration));

    if (sinceRelease.length === 0) {
      // Nothing has landed, so the section may say so — but it must not claim
      // migrations that do not exist either.
      return;
    }

    expect(
      /no migrations/i.test(section),
      `The Unreleased section says there are no migrations, but ${sinceRelease.length} have landed ` +
        `since ${latest.tag}: ${sinceRelease.join(", ")}`
    ).toBe(false);

    const missing = sinceRelease.filter((file) => !sectionNamesMigration(section, file));

    expect(
      missing,
      "Every migration landed since the newest tag must be named in the CHANGELOG's Unreleased " +
        "section — that section is what an operator reads to know what to run before deploying. " +
        `Missing: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("the CHANGELOG's newest release section exists and its migration references resolve", () => {
    const changelog = readFileSync(CHANGELOG_PATH, "utf8");
    const heading = new RegExp(`^## ${latest.tag.replace(/\./g, "\\.")}\\b`, "m");
    expect(heading.test(changelog), `CHANGELOG.md must carry a "## ${latest.tag}" section`).toBe(true);

    const sectionStart = changelog.search(heading);
    const rest = changelog.slice(sectionStart);
    const nextHeading = rest.slice(2).search(/^## /m);
    const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 2);

    // Every shorthand migration reference (`…000008` / `...000008`) in the
    // section must match a migration inside this release's range — an
    // operator following the CHANGELOG must never chase a migration that
    // does not exist in the release it describes.
    const previous = RELEASES[RELEASES.length - 2];
    const inRelease = files.filter(
      (file) =>
        version(file) > version(previous?.lastMigration ?? "0") &&
        version(file) <= version(latest.lastMigration)
    );
    const missing = inRelease.filter((file) => !sectionNamesMigration(section, file));
    expect(
      missing,
      `Every migration in ${latest.tag} must be named in its CHANGELOG section. Missing: ${missing.join(", ")}`
    ).toEqual([]);

    const suffixes = new Set(inRelease.map((file) => version(file).slice(-6)));
    for (const match of section.matchAll(/(?:…|\.{3})(\d{6})/g)) {
      expect(
        suffixes.has(match[1]),
        `CHANGELOG ${latest.tag} references migration …${match[1]}, which is not in that release`
      ).toBe(true);
    }
  });
});
