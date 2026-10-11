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
