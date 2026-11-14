import { cache } from "react";
import { resolvePublicPortalShareValue } from "@/lib/engagement/public-portal-data";

/**
 * Which campaign this address reaches, resolved once for the request and
 * shared by `layout.tsx`, both pages and their `generateMetadata` through
 * React's per-request cache. The lookup rule is the portal's own (token, then
 * printable slug, active before closed, a status filter as the access
 * control); this only stops it running more than once.
 */
export const resolvePortalForRequest = cache(resolvePublicPortalShareValue);
