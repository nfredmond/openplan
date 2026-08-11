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
];

const CHANGELOG_PATH = path.join(process.cwd(), "..", "CHANGELOG.md");

function version(name: string): string {
  return name.slice(0, 14);
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
    const suffixes = new Set(inRelease.map((file) => version(file).slice(-6)));
    for (const match of section.matchAll(/(?:…|\.{3})(\d{6})/g)) {
      expect(
        suffixes.has(match[1]),
        `CHANGELOG ${latest.tag} references migration …${match[1]}, which is not in that release`
      ).toBe(true);
    }
  });
});
