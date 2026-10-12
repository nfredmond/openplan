// Rate-limit posture for anonymous "support" votes on the public portal.
// Lives outside the route file because Next.js route modules may only export
// HTTP handlers and segment config.
export const PUBLIC_VOTE_RATE_WINDOW_MINUTES = 10;
/** Per device (or per connection when a browser sends no device token). */
export const PUBLIC_VOTE_MAX_PER_WINDOW = 30;
/**
 * Per connection, across every device on it: a meeting room on one Wi-Fi.
 * Added 2026-10-11 when support became one per device rather than one per
 * connection.
 */
export const PUBLIC_VOTE_MAX_PER_CONNECTION_WINDOW = 120;
/**
 * Per connection, per comment, over a rolling day. Added 2026-10-12
 * (KI-2026-10-12-011): the device token comes from the browser, so a script can
 * mint a new one per request and, under the room limit above alone, add about
 * 120 supports to one comment every 10 minutes from one connection.
 *
 * 50 is a large meeting room on one Wi-Fi in which everyone supports the same
 * comment on the same day. A script on one connection now adds at most 50 to a
 * comment per day instead of about 17,000. People on other connections are not
 * affected.
 */
export const PUBLIC_VOTE_MAX_PER_CONNECTION_PER_ITEM = 50;
export const PUBLIC_VOTE_PER_ITEM_WINDOW_HOURS = 24;
