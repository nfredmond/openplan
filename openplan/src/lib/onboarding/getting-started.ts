/**
 * The first six things to do in a new workspace.
 *
 * ONE LIST, TWO READERS. The workspace bootstrap API returns this list in its
 * response, and the in-app Help page renders it where a person can actually
 * read it. It lives here — not inline in the API route — because the route's
 * copy was unreachable on the real sign-up path (the `handle_new_user` trigger
 * provisions the workspace, so almost nobody calls the bootstrap endpoint), and
 * a checklist only an API response carries is a checklist nobody sees.
 *
 * REWRITTEN (2026-07) because the original was written for a supervised
 * single-county pilot that no longer exists: it told every new workspace in the
 * country to "set pilot success metrics", "schedule pilot readout", and hold a
 * "weekly KPI review cadence" — steps that belong to one agency's engagement,
 * not to the product. OpenPlan is self-serve now (non-negotiable #4), so the
 * first thing a planner reads cannot assume a founder, a pilot period, a
 * readout meeting, or a reporting cadence somebody else set.
 *
 * These are jurisdiction-neutral on purpose: no place, agency, or program is
 * named, because the same list is the first thing a city planner in Ohio, a
 * tribal transportation department, and a two-person consultancy will read.
 */
export const NEW_WORKSPACE_GETTING_STARTED_STEPS: readonly string[] = [
  "Confirm the workspace owner; add another admin if more than one person will manage it.",
  "Set your workspace's home geography so analyses start in your area.",
  "If you have a team, invite the people who will review and approve work. A solo workspace is complete without this.",
  "Draw or upload a corridor, then run your first corridor analysis.",
  "Read the source transparency panel and check what was measured and what was not.",
  "Export a report and confirm the run metadata and disclosures read the way you need.",
];
