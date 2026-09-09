# Desktop Control: demo identity and updating main

Nathaniel requested restoration of the visible demo commit and a working update-to-main button on September 9, 2026. The desktop launcher points to the canonical repository's `openplan/scripts/ops/openplan-control-panel.py`.

## Observed defects

The Demo tab showed only version 0.46.0 and "Update available". The commit was hidden in Diagnostics, and the comparison used the launching checkout's HEAD instead of freshly fetched GitHub main. Slow GitHub checks delayed the first local status display.

The actual demo served `76f019bfb803` from `~/apps/openplan` through user service `openplan-web.service`. Its September 9 10:51 UTC update receipt recorded `preparation_failed`: the builder found pending migrations and asked for manual terminal work. The preserved old demo was still healthy. Current main added 28 migrations beyond the database's 279 applied versions.

## Repair

The Demo tab names the served commit and GitHub main, fetched without moving the launching checkout. Local identity renders before network checks. Fetch failure remains unavailable and never reuses an older green comparison. The update button says "Update to main".

The existing retained-build coordinator now supplies a private database-backup destination to its builder. When migrations are pending, the helper resolves production environment settings with Next's env loader using the service's startup environment. Candidate, current demo and local CLI API URLs must match. Only the known local OpenPlan DB/API containers with matching ports and network are supported. Remote or ambiguous targets stop before database writes.

Applied migration history must be an exact prefix of the candidate's files. A private custom-format PostgreSQL dump must succeed and pass `pg_restore --list` before migration. Container identity is rechecked, `supabase migration up --local --yes` runs, and the inventory is checked again. The updater retains the old application build and its recovery behavior. It never resets the database. App recovery retains additive database changes; it does not automatically restore the DB and discard intervening work.

## Verification and limits

All seven operations test files passed, including 31 controller/builder cases, 20 isolated updater cases, six database cases, and native layout at 820×760 and 640×700 with 1.33 and 2.0 scaling. The four mutation harnesses observed 48 broken behaviors fail through assertions and four harmless controls survive. Layout tests initially caught collapsed activity space and a clipped hint; both were corrected without relaxing assertions. Mutation outcomes are retained in `mutation-results.json`.

Database unit tests mock commands and cannot prove real container routing, SQL behavior, or full restoration. Archive listing proves readability, not a completed restore. The existing upgrade and restore workflows remain separate evidence. Custom remote stacks, altered API gateway routing, and arbitrary systemd wrapper configurations are outside this machine-specific updater. Native Control supports desktop sizes, not a 390px phone viewport.

No user records, environment values, or database backups belong in this directory. Runtime backups and logs stay in the private local updater directory.

## Observed desktop update

The actual Tk **Update to main** button, invoked through its normal widget command, completed the update from `76f019bfb803` to `9950e247c58b` on September 9. It created a private 50,776,184-byte custom database backup, applied all 28 pending migrations, built Next 16.3.4 with webpack and TypeScript, promoted the candidate, and verified the serving commit. `which-openplan.sh` agreed. The demo checkout remained clean. The prior application build and database dump remain in `~/apps/.openplan-updates/`.

The native Demo tab showed both commits matching. `current-desktop.png` and `current-small.png` show the repaired display at the default and minimum supported window sizes. Commit text uses the light foreground after inspection found the previous green too dark. The source hash and observed runtime identity are in `live-update.json`. The **Open demo** button opened a new Chrome tab at the demo home page. Real navigation reached the dashboard and Programming Cycles; the browser console returned no entries. The dashboard did disclose an unreadable project-submittals summary. That application data-query issue was not resolved or represented as a successful read by this Control repair. No user records were changed for the navigation check.

The final follow-up changes only status readability and completion wording. These do not claim full product acceptance. Its main update is exercised again after pushing so the installed demo can match the final main commit.

GitHub RLS passed on `9950e247`. The first CI attempt failed during apt dependency setup in both Python jobs because Google's Chrome repository returned a hash mismatch, before tests ran. The other CI jobs were still running when this note was prepared; this is not a claim that GitHub CI passed. Local operations checks passed as recorded above. Main `d41d5006` had passed CI, RLS and the unchanged SQL upgrade-path workflow before this repair.
