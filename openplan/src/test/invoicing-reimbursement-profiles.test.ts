import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createReimbursementProfileRegistry,
  reimbursementProfileRegistry,
  type ReimbursementProfileDescriptor,
} from "@/lib/invoicing/reimbursement-profiles";
import {
  INTERIM_DEFAULT_RATIONALE,
  isValidPosture,
  postureLabel,
  resolveReimbursementProfile,
} from "@/lib/invoicing/reimbursement-profile-binding";
import { US_CA_LAPM_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-ca-lapm";

function profile(overrides: Partial<ReimbursementProfileDescriptor>): ReimbursementProfileDescriptor {
  return {
    profileId: "test_profile",
    profileName: "Test profile",
    version: "1.0.0",
    jurisdiction: { country: "US", subdivision: "OH", label: "Ohio, United States" },
    postureOptions: [{ postureId: "standard", label: "Standard" }],
    defaultPostureId: "standard",
    isInterimDefault: false,
    ...overrides,
  };
}

describe("reimbursement profile registry", () => {
  const ohio = profile({
    profileId: "us_oh_reimbursement_v1",
    jurisdiction: { country: "US", subdivision: "OH", label: "Ohio, United States" },
  });
  const nationwide = profile({
    profileId: "us_nationwide_reimbursement_v1",
    jurisdiction: { country: "US", label: "United States" },
    isInterimDefault: true,
  });
  const registry = createReimbursementProfileRegistry([ohio, nationwide]);

  it("lists and gets registered profiles", () => {
    expect(registry.list().map((entry) => entry.profileId)).toEqual([
      "us_oh_reimbursement_v1",
      "us_nationwide_reimbursement_v1",
    ]);
    expect(registry.get("us_oh_reimbursement_v1")?.profileId).toBe("us_oh_reimbursement_v1");
    expect(registry.get("nope")).toBeNull();
    expect(registry.defaultProfileId).toBe("us_nationwide_reimbursement_v1");
  });

  it("matches the subdivision profile over the nationwide one", () => {
    const match = registry.findByJurisdiction({ country: "US", subdivision: "OH" });
    expect(match).toMatchObject({ kind: "matched", profile: { profileId: "us_oh_reimbursement_v1" } });
  });

  it("falls to the nationwide tier for a subdivision with no profile of its own", () => {
    const match = registry.findByJurisdiction({ country: "US", subdivision: "TX" });
    expect(match).toMatchObject({ kind: "matched", profile: { profileId: "us_nationwide_reimbursement_v1" } });
  });

  it("never matches a subdivision profile when the subdivision is unknown", () => {
    // Picking Ohio's process for a workspace whose subdivision is not
    // established is the exact substitution the registry exists to prevent.
    const match = registry.findByJurisdiction({ country: "US", subdivision: null });
    expect(match).toMatchObject({ kind: "matched", profile: { profileId: "us_nationwide_reimbursement_v1" } });
  });

  it("returns no_profile for a country with nothing registered", () => {
    expect(registry.findByJurisdiction({ country: "CA", subdivision: "ON" })).toEqual({ kind: "no_profile" });
  });

  it("returns no_profile rather than the interim default when nothing covers the query", () => {
    const subdivisionOnly = createReimbursementProfileRegistry([
      profile({ profileId: "only_ca", jurisdiction: { country: "US", subdivision: "CA", label: "California" }, isInterimDefault: true }),
    ]);
    expect(subdivisionOnly.findByJurisdiction({ country: "US", subdivision: "OH" })).toEqual({ kind: "no_profile" });
    expect(subdivisionOnly.findByJurisdiction({ country: "US", subdivision: null })).toEqual({ kind: "no_profile" });
  });

  it("reports two equally-specific profiles as ambiguous instead of picking one", () => {
    const twoOhio = createReimbursementProfileRegistry([
      ohio,
      profile({ profileId: "us_oh_alt_v1", jurisdiction: { country: "US", subdivision: "OH", label: "Ohio (alt)" } }),
    ]);
    const match = twoOhio.findByJurisdiction({ country: "US", subdivision: "OH" });
    expect(match.kind).toBe("ambiguous");
    if (match.kind === "ambiguous") {
      expect(match.profiles.map((entry) => entry.profileId)).toEqual(["us_oh_reimbursement_v1", "us_oh_alt_v1"]);
    }
  });

  it("normalizes jurisdiction casing and whitespace", () => {
    const match = registry.findByJurisdiction({ country: " us ", subdivision: " oh " });
    expect(match).toMatchObject({ kind: "matched", profile: { profileId: "us_oh_reimbursement_v1" } });
  });

  it("throws on a duplicate profile id", () => {
    expect(() => createReimbursementProfileRegistry([ohio, ohio])).toThrow(/Duplicate reimbursement profile/);
  });

  it("throws when more than one profile claims the interim default", () => {
    expect(() =>
      createReimbursementProfileRegistry([
        nationwide,
        profile({ profileId: "second_default", isInterimDefault: true }),
      ])
    ).toThrow(/Multiple reimbursement profiles claim the interim default/);
  });

  it("throws when a default posture is not among the posture options", () => {
    expect(() =>
      createReimbursementProfileRegistry([profile({ profileId: "bad_default", defaultPostureId: "missing" })])
    ).toThrow(/default posture/);
  });
});

describe("the built-in California profile", () => {
  it("carries the exact vocabulary the legacy caltrans_posture column stored", () => {
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.profileId).toBe("us_ca_lapm_reimbursement_v1");
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.jurisdiction).toMatchObject({ country: "US", subdivision: "CA" });
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.postureOptions.map((option) => option.postureId)).toEqual([
      "deferred_exact_forms",
      "local_agency_consulting",
      "federal_aid_candidate",
    ]);
    // The labels the composer has always shown — a backfilled row must read
    // exactly as it did the day it was written.
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.postureOptions.map((option) => option.label)).toEqual([
      "Exact forms deferred",
      "Local-agency consulting",
      "Federal-aid candidate",
    ]);
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.defaultPostureId).toBe("deferred_exact_forms");
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.submittedToHint).toBe("Caltrans D3 Local Assistance");
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.formPackStatus).toBe("deferred_exact_forms");
    expect(US_CA_LAPM_REIMBURSEMENT_PROFILE.isInterimDefault).toBe(true);
  });

  it("is registered in the built-in registry as the interim default", () => {
    expect(reimbursementProfileRegistry.get("us_ca_lapm_reimbursement_v1")).not.toBeNull();
    expect(reimbursementProfileRegistry.defaultProfileId).toBe("us_ca_lapm_reimbursement_v1");
  });
});

describe("resolveReimbursementProfile — selection provenance", () => {
  it("records an explicit request as explicitly_requested", () => {
    const resolution = resolveReimbursementProfile({
      requestedProfileId: "us_ca_lapm_reimbursement_v1",
      workspaceJurisdiction: { country: "US", subdivision: "OH" },
    });
    expect(resolution).toMatchObject({
      kind: "resolved",
      binding: {
        profileId: "us_ca_lapm_reimbursement_v1",
        selection: "explicitly_requested",
        interimDefaultReason: null,
        submittedToHint: "Caltrans D3 Local Assistance",
        formPackStatus: "deferred_exact_forms",
      },
    });
  });

  it("returns unknown_profile with the available list instead of substituting the default", () => {
    const resolution = resolveReimbursementProfile({
      requestedProfileId: "not_a_profile",
      workspaceJurisdiction: null,
    });
    expect(resolution.kind).toBe("unknown_profile");
    if (resolution.kind === "unknown_profile") {
      expect(resolution.requestedProfileId).toBe("not_a_profile");
      expect(resolution.available.map((entry) => entry.profileId)).toContain("us_ca_lapm_reimbursement_v1");
    }
  });

  it("records a home-geography match as jurisdiction_matched", () => {
    const resolution = resolveReimbursementProfile({
      workspaceJurisdiction: { country: "US", subdivision: "CA" },
    });
    expect(resolution).toMatchObject({
      kind: "resolved",
      binding: { profileId: "us_ca_lapm_reimbursement_v1", selection: "jurisdiction_matched", interimDefaultReason: null },
    });
  });

  it("labels the no-geography fallback interim_unconfigured_default with its reason", () => {
    const resolution = resolveReimbursementProfile({ workspaceJurisdiction: null });
    expect(resolution).toMatchObject({
      kind: "resolved",
      binding: {
        profileId: "us_ca_lapm_reimbursement_v1",
        selection: "interim_unconfigured_default",
        interimDefaultReason: "no_workspace_jurisdiction",
      },
    });
  });

  it("labels the no-profile-for-jurisdiction fallback with its reason", () => {
    const resolution = resolveReimbursementProfile({
      workspaceJurisdiction: { country: "US", subdivision: "OH" },
    });
    expect(resolution).toMatchObject({
      kind: "resolved",
      binding: {
        selection: "interim_unconfigured_default",
        interimDefaultReason: "no_profile_for_jurisdiction",
      },
    });
  });

  it("labels an ambiguous jurisdiction with its reason instead of picking a profile", () => {
    const twoCa = createReimbursementProfileRegistry([
      profile({ profileId: "ca_one", jurisdiction: { country: "US", subdivision: "CA", label: "California" }, isInterimDefault: true }),
      profile({ profileId: "ca_two", jurisdiction: { country: "US", subdivision: "CA", label: "California (alt)" } }),
    ]);
    const resolution = resolveReimbursementProfile({
      workspaceJurisdiction: { country: "US", subdivision: "CA" },
      registry: twoCa,
    });
    expect(resolution).toMatchObject({
      kind: "resolved",
      binding: {
        profileId: "ca_one",
        selection: "interim_unconfigured_default",
        interimDefaultReason: "ambiguous_jurisdiction_profiles",
      },
    });
  });

  it("quotes one rationale for every interim default", () => {
    expect(INTERIM_DEFAULT_RATIONALE).toMatch(/interim default profile is applied and disclosed/);
  });
});

describe("posture helpers", () => {
  const options = US_CA_LAPM_REIMBURSEMENT_PROFILE.postureOptions;

  it("validates postures against the profile's own vocabulary", () => {
    expect(isValidPosture(options, "deferred_exact_forms")).toBe(true);
    expect(isValidPosture(options, "not_a_posture")).toBe(false);
    expect(isValidPosture(options, null)).toBe(false);
    expect(isValidPosture(options, "  ")).toBe(false);
  });

  it("labels a declared posture with the profile's label", () => {
    expect(postureLabel(options, "local_agency_consulting")).toBe("Local-agency consulting");
  });

  it("humanizes an undeclared posture instead of blanking it", () => {
    // A row written before the profile columns existed still renders what the
    // agency stored.
    expect(postureLabel(options, "some_legacy_value")).toBe("Some legacy value");
    expect(postureLabel(null, "deferred_exact_forms")).toBe("Deferred exact forms");
    expect(postureLabel(options, null)).toBe("Not recorded");
  });
});

/**
 * The literal guard: jurisdiction-specific reimbursement vocabulary lives in
 * profile descriptors under `src/lib/invoicing/profiles/`, and NOWHERE else in
 * the invoicing surfaces. This is what keeps the hardcoding from creeping
 * back: the next Caltrans (or ODOT, or Ontario) literal belongs in a
 * descriptor file, not in a component, a route, or a shared lib.
 *
 * The legacy DB column is named `caltrans_posture` and keeps that name forever
 * (migrations never drop), so referencing that exact identifier — in a select
 * string, a row type, a read fallback — is not a jurisdiction literal and is
 * allowed everywhere.
 */
describe("jurisdiction literals stay inside profile descriptors", () => {
  const SRC = path.join(process.cwd(), "src");
  const INVOICING_SURFACES = [
    path.join(SRC, "lib", "invoicing"),
    path.join(SRC, "components", "invoicing"),
    path.join(SRC, "app", "(app)", "invoicing"),
    path.join(SRC, "app", "api", "invoicing"),
  ];
  const PROFILES_DIR = path.join(SRC, "lib", "invoicing", "profiles") + path.sep;

  /** The one file allowed to IMPORT a profile descriptor: the registration list. */
  const REGISTRY_FILE = path.join(SRC, "lib", "invoicing", "reimbursement-profiles.ts");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  /**
   * Registering a descriptor requires importing it, and descriptor module
   * paths and symbols legitimately carry jurisdiction names ("us-ca-lapm").
   * Scrub the import and the imported symbols' usages so the registration
   * list itself passes — in the registry file ONLY. Anywhere else, importing
   * a descriptor directly is a registry bypass and stays an offense.
   */
  function scrubProfileRegistrations(source: string): string {
    const importPattern = /import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*"@\/lib\/invoicing\/profiles\/[^"]+";?/g;
    const importedNames: string[] = [];
    let scrubbed = source.replace(importPattern, (_match, names: string) => {
      for (const raw of names.split(",")) {
        const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) importedNames.push(name);
      }
      return "";
    });
    for (const name of importedNames) {
      scrubbed = scrubbed.replaceAll(name, "registered_profile");
    }
    return scrubbed;
  }

  it("confines /caltrans|lapm/i to src/lib/invoicing/profiles/", () => {
    const offenders: string[] = [];

    for (const surface of INVOICING_SURFACES) {
      for (const file of walk(surface)) {
        if (file.startsWith(PROFILES_DIR)) continue;
        let source = readFileSync(file, "utf8").replaceAll("caltrans_posture", "legacy_column");
        if (file === REGISTRY_FILE) source = scrubProfileRegistrations(source);
        if (/caltrans|lapm/i.test(source)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("guards the guard — the scan reaches every invoicing surface", () => {
    const files = INVOICING_SURFACES.flatMap((surface) => walk(surface));
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((file) => file.startsWith(PROFILES_DIR))).toBe(true);
    expect(files.some((file) => file.endsWith("invoice-record-composer.tsx"))).toBe(true);
    expect(files.some((file) => file.endsWith(path.join("invoices", "route.ts")))).toBe(true);
  });
});
