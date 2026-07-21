import type { NextRequest } from "next/server";
import { timingSafeSecretEquals } from "@/lib/http/secret-compare";

/**
 * Bearer auth for ProcessingCallback deliveries from the Aerial Intel
 * Platform (natford-aerial-processing.v1).  The shared secret must equal the
 * platform's AERIAL_PROCESSING_CALLBACK_TOKEN.
 */

const CALLBACK_TOKEN_ENV = "OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN";

function parseBearerAuthorizationHeader(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * True when the callback bearer token env var is set.  The callback route
 * answers 503 missing_config (rather than 401) when it is not, so operators
 * can tell "not provisioned" apart from "bad credentials".
 */
export function isAerialProcessingCallbackConfigured(): boolean {
  return Boolean(process.env[CALLBACK_TOKEN_ENV]?.trim());
}

export function isAuthenticatedAerialProcessingCallback(request: NextRequest): boolean {
  const configuredToken = process.env[CALLBACK_TOKEN_ENV]?.trim();
  if (!configuredToken) {
    return false;
  }

  const requestToken = parseBearerAuthorizationHeader(request);
  return timingSafeSecretEquals(requestToken, configuredToken);
}
