import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { censusApiKey, withCensusApiKey } from "@/lib/data-sources/census-api-key";

const ENDPOINT = "https://api.census.gov/data/2023/acs/acs5?get=NAME&for=county:*";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withCensusApiKey", () => {
  it("appends the configured key", () => {
    vi.stubEnv("CENSUS_API_KEY", "abc123");
    expect(withCensusApiKey(ENDPOINT)).toBe(`${ENDPOINT}&key=abc123`);
  });

  it("uses ? when the url has no query string yet", () => {
    vi.stubEnv("CENSUS_API_KEY", "abc123");
    expect(withCensusApiKey("https://api.census.gov/data/2023/acs/acs5")).toBe(
      "https://api.census.gov/data/2023/acs/acs5?key=abc123"
    );
  });

  it("escapes the key rather than injecting it raw", () => {
    vi.stubEnv("CENSUS_API_KEY", "a b&c=d");
    expect(withCensusApiKey(ENDPOINT)).toBe(`${ENDPOINT}&key=a%20b%26c%3Dd`);
  });

  it("is a no-op when no key is configured, and treats blank as unset", () => {
    vi.stubEnv("CENSUS_API_KEY", "");
    expect(withCensusApiKey(ENDPOINT)).toBe(ENDPOINT);
    expect(censusApiKey()).toBeNull();

    vi.stubEnv("CENSUS_API_KEY", "   ");
    expect(censusApiKey()).toBeNull();
  });

  it("reads the environment at call time, not at import", () => {
    // The county catalog froze its URL at module load, so a key present at
    // runtime could still be missing from the request.
    vi.stubEnv("CENSUS_API_KEY", "first");
    expect(withCensusApiKey(ENDPOINT)).toContain("key=first");
    vi.stubEnv("CENSUS_API_KEY", "second");
    expect(withCensusApiKey(ENDPOINT)).toContain("key=second");
  });
});

/**
 * REGRESSION GUARD.
 *
 * `us-counties.ts` built its Census URL by hand and omitted the key. The Census
 * API answers an unauthenticated request with `302 -> missing_key.html` rather
 * than an error, so the JSON parse failed, the catalog resolved empty, and US
 * county search returned NOTHING on every deployment — including ones with a
 * key configured. Nothing caught it because the symptom was emptiness.
 *
 * Any new Census request URL must go through `withCensusApiKey`.
 */
describe("every Census API request URL carries the key", () => {
  const SRC = path.join(process.cwd(), "src");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return entry === "test" ? [] : walk(full);
      }
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("has no hand-built api.census.gov data request", () => {
    const offenders = walk(SRC)
      .filter((file) => !file.endsWith(path.join("data-sources", "census-api-key.ts")))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // A *request* URL, not a citation: `?get=` or a `${...}/acs` template
        // is what distinguishes a fetch target from provenance metadata or
        // documentation links shown to users.
        const buildsRequest =
          /api\.census\.gov\/data[^"'`\s]*\?get=/.test(source) ||
          /CENSUS_BASE\}\/\$\{/.test(source);
        if (!buildsRequest) return false;
        return !/withCensusApiKey\(/.test(source);
      });

    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });

  it("still detects the two known request-building modules", () => {
    // Guard the guard: if the detector stops matching anything, the test above
    // would pass while protecting nothing.
    const builders = walk(SRC).filter((file) => {
      const source = readFileSync(file, "utf8");
      return (
        /api\.census\.gov\/data[^"'`\s]*\?get=/.test(source) || /CENSUS_BASE\}\/\$\{/.test(source)
      );
    });

    const names = builders.map((file) => path.basename(file)).sort();
    expect(names).toContain("census.ts");
    expect(names).toContain("us-counties.ts");
  });
});
