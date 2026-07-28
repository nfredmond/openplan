/**
 * The deployment-environment key for one integration provider — the fallback
 * source when a workspace has not stored its own key, and the only source for
 * providers whose keys cannot take effect per-workspace yet (Mapbox).
 *
 * Deliberately reads the env DIRECTLY rather than through `censusApiKey()` /
 * `anthropicApiKey()`: those helpers consult the per-request workspace
 * integration context first, and the integration-keys routes need to answer
 * "what does the DEPLOYMENT have?" independently of any workspace override.
 *
 * Mapbox is special-cased: the browser token is read from the two
 * `NEXT_PUBLIC_*` names (current + legacy alias) through
 * {@link resolvePublicMapboxToken}, which also enforces the `pk.` shape.
 */

import { resolvePublicMapboxToken } from "@/lib/mapbox/public-token";
import type { IntegrationProviderDescriptor } from "./providers";

/** The effective deployment-env key for a provider, or null when unset. */
export function deploymentEnvKey(provider: IntegrationProviderDescriptor): string | null {
  if (provider.id === "mapbox") {
    return (
      resolvePublicMapboxToken(
        process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
        process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      ) || null
    );
  }
  return process.env[provider.envVar]?.trim() || null;
}
