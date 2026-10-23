import catalog from "../../../../scripts/modeling/population_source_profiles.v1.json";
import { jsonValuesEqual } from "@/lib/models/demand-agreement-artifact";

export const POPULATION_PROFILE_PURPOSES = [
  "new_guided_launch", "retained_validation", "aequilibrae_production", "activitysim_consumption",
] as const;
export type PopulationProfilePurpose = (typeof POPULATION_PROFILE_PURPOSES)[number];
export type PopulationSourceDescriptorIdentity = { id: string; vintage: string; retrievalUrl: string };
export type PopulationSourceProfile = Record<string, unknown>;
export type PopulationProfileResult =
  | { status: "supported"; profile: PopulationSourceProfile }
  | { status: "unsupported" | "unassessed" | "unavailable"; reason: string };
export type PopulationSourceRegistration = {
  id: string;
  descriptor: PopulationSourceDescriptorIdentity;
  profile: PopulationSourceProfile;
  capabilities?: Readonly<Partial<Record<PopulationProfilePurpose, string>>>;
};

/** A private copy keeps callers from changing enrollment through returned data. */
export function createPopulationSourceRegistry(registrations: readonly PopulationSourceRegistration[]) {
  const entries: PopulationSourceRegistration[] = JSON.parse(JSON.stringify(registrations));
  function capability(entry: PopulationSourceRegistration, purpose: PopulationProfilePurpose): PopulationProfileResult {
    if (!POPULATION_PROFILE_PURPOSES.includes(purpose)) {
      return { status: "unsupported", reason: "This population profile purpose is unsupported." };
    }
    const status = entry.capabilities?.[purpose];
    if (status === "supported") return { status, profile: structuredClone(entry.profile) };
    if (status === "unsupported" || status === "unavailable") {
      return { status, reason: `This registered population source is ${status} for ${purpose}.` };
    }
    return { status: "unassessed", reason: `This registered population source has no assessed ${purpose} capability.` };
  }
  return {
    forDescriptor(descriptor: PopulationSourceDescriptorIdentity, purpose: PopulationProfilePurpose): PopulationProfileResult {
      const matches = entries.filter((entry) => entry.descriptor.id === descriptor.id &&
        entry.descriptor.vintage === descriptor.vintage && entry.descriptor.retrievalUrl === descriptor.retrievalUrl);
      if (matches.length !== 1) return { status: "unsupported", reason: "This adapter descriptor has no unique registered population profile." };
      return capability(matches[0], purpose);
    },
    profileAllowed(value: unknown, purpose: PopulationProfilePurpose): value is PopulationSourceProfile {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const matches = entries.filter((entry) => jsonValuesEqual(value, entry.profile));
      return matches.length === 1 && capability(matches[0], purpose).status === "supported";
    },
  };
}

// Production enrollment comes only from this versioned source catalog. Test
// registries are independent values and cannot add entries to this instance.
export const populationSourceRegistry = createPopulationSourceRegistry(catalog.profiles);

/** Preserve the raw object, including extra fields, until exact membership decides. */
export function isRetainedPopulationSourceProfile(value: unknown): value is PopulationSourceProfile {
  return populationSourceRegistry.profileAllowed(value, "retained_validation");
}
