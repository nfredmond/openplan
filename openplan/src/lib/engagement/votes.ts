// Rate-limit posture for anonymous "support" votes on the public portal.
// Lives outside the route file because Next.js route modules may only export
// HTTP handlers and segment config.
export const PUBLIC_VOTE_RATE_WINDOW_MINUTES = 10;
export const PUBLIC_VOTE_MAX_PER_WINDOW = 30;
