/**
 * Which database migrations this build of OpenPlan expects.
 *
 * Code deploys on every merge to main; hosted migrations are applied by hand.
 * On October 11, 2026 a route went live before the four migrations it read.
 * The build therefore records the version of every file in
 * `supabase/migrations`, and the health routes report it, so a monitor can
 * compare it with the versions the database has applied.
 *
 * `next.config.ts` reads the directory once at build time and inlines the list
 * as `process.env.OPENPLAN_BUILD_MIGRATION_VERSIONS`. The reference below must
 * stay a literal `process.env.NAME` expression for that inlining to work.
 *
 * Hosted migrations may be applied out of numeric order, so a comparison uses
 * the whole set, never only the latest version.
 */

// Supabase CLI's own rule: the version is the digits before the first underscore.
const MIGRATION_FILENAME = /^([0-9]+)_(.*)\.sql$/;

function migrationVersionFromFilename(filename: string): string | null {
  const match = MIGRATION_FILENAME.exec(filename);
  return match ? match[1] : null;
}

/** Sorted, de-duplicated versions for the given migration filenames. */
export function migrationVersionsFromFilenames(filenames: readonly string[]): string[] {
  const versions = new Set<string>();
  for (const filename of filenames) {
    const version = migrationVersionFromFilename(filename);
    if (version) versions.add(version);
  }
  return [...versions].sort();
}

/** Parses the build-time list. Returns null when the build did not stamp one. */
export function parseMigrationVersionList(raw: string | undefined | null): string[] | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const versions = trimmed.split(",").map((part) => part.trim());
  if (versions.some((version) => !/^[0-9]+$/.test(version))) return null;
  return [...new Set(versions)].sort();
}

export type ExpectedMigrations = {
  count: number;
  latest: string;
  versions: string[];
};

/** The migrations this build expects, or null when the build did not record them. */
export function expectedMigrations(): ExpectedMigrations | null {
  const versions = parseMigrationVersionList(process.env.OPENPLAN_BUILD_MIGRATION_VERSIONS);
  if (!versions || versions.length === 0) return null;
  return { count: versions.length, latest: versions[versions.length - 1], versions };
}
