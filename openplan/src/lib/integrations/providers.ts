/**
 * The integration-provider registry: every external service a workspace can
 * bring its own key for, described as DATA — id, label, where to get a key,
 * which env var the deployment fallback reads, and whether a per-workspace
 * key actually takes effect in this release.
 *
 * Adding a provider means adding a descriptor here (plus its live-validation
 * probe in the API layer), never editing call sites — the same registry
 * discipline as stage-gates and invoicing profiles.
 *
 * `workspaceConfigurable: false` is an honest flag, not a stub: Mapbox's
 * browser token is inlined at build time (`NEXT_PUBLIC_*`), so a stored
 * per-workspace token would not reach the map components. Until a runtime
 * token endpoint exists, the wizard shows Mapbox as deployment-env-only with
 * copy-paste instructions and a validate button — it never pretends to save.
 */

export type IntegrationProviderId = "anthropic" | "census" | "mapbox";

export type IntegrationProviderDescriptor = {
  id: IntegrationProviderId;
  label: string;
  /** What the key unlocks, in planner terms. */
  purpose: string;
  /** Where a team gets its own key. */
  keySignupUrl: string;
  /** The deployment env var used when no workspace key exists. */
  envVar: string;
  /** Whether a stored workspace key takes effect in this release. */
  workspaceConfigurable: boolean;
  /** Shown when workspaceConfigurable is false. */
  workspaceConfigurableNote?: string;
};

export const INTEGRATION_PROVIDERS: readonly IntegrationProviderDescriptor[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    purpose:
      "AI drafting, the Planner Agent, engagement synthesis, moderation, and translation. With your own key, AI usage from this workspace — including its public engagement portal — is billed to your Anthropic account.",
    keySignupUrl: "https://console.anthropic.com/settings/keys",
    envVar: "ANTHROPIC_API_KEY",
    workspaceConfigurable: true,
  },
  {
    id: "census",
    label: "US Census Bureau",
    purpose:
      // Scoped to what the key ACTUALLY buys. Place / CDP / metro search reads
      // keyless TIGERweb and keeps working without one, and county search names
      // its missing key rather than answering an empty list, so promising that
      // both "return empty results" would send a planner to fix a surface that
      // is not broken and misdescribe one that already refuses honestly.
      "US county search, the ACS demographics that size model zones, and the EJ/Title VI equity overlay on worker-backed model runs. The app reads the ACS with your key and hands the finished table to the modeling worker, so the worker needs no key of its own. Free key; United States geographies only. Place, CDP and metro search do not need it. Without a key — here or on the deployment — county search says so instead of answering, and an AequilibraE or behavioral-demand run can build its zone table only if the worker host carries a Census key of its own.",
    keySignupUrl: "https://api.census.gov/data/key_signup.html",
    envVar: "CENSUS_API_KEY",
    workspaceConfigurable: true,
  },
  {
    id: "mapbox",
    label: "Mapbox",
    purpose: "Basemaps and map rendering across every module.",
    keySignupUrl: "https://console.mapbox.com/account/access-tokens/",
    envVar: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    workspaceConfigurable: false,
    workspaceConfigurableNote:
      "The browser map token is compiled into the app at build time, so a per-workspace token cannot take effect at runtime yet. Set it as a deployment environment variable; the validate button below checks the one this deployment is using.",
  },
] as const;

export function integrationProvider(id: string): IntegrationProviderDescriptor | null {
  return INTEGRATION_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Providers whose stored workspace keys actually apply at runtime. */
export function workspaceConfigurableProviders(): IntegrationProviderDescriptor[] {
  return INTEGRATION_PROVIDERS.filter((provider) => provider.workspaceConfigurable);
}
