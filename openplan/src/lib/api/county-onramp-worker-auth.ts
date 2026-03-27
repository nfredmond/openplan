import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function parseBearerAuthorizationHeader(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthenticatedCountyWorkerCallback(request: NextRequest): boolean {
  const configuredToken = process.env.OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN?.trim();
  if (!configuredToken) {
    return false;
  }

  const requestToken = parseBearerAuthorizationHeader(request);
  if (!requestToken) {
    return false;
  }

  return constantTimeEquals(configuredToken, requestToken);
}
