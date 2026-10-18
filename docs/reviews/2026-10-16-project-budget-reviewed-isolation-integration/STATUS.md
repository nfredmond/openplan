# Reviewed stated-budget isolation has a committed source checkpoint

October 16, 2026. Source commit `4577951995969d002a8c89c56268cf34872a332c` records the exact independently reviewed patch in a new checkout. Its application tree is `f520e01ef084e78f1bde90cbe4d6941facd2dae2`. No new behavior differs from the reviewed candidate. All 13 reviewed source hashes and Git blobs match.

The new checkout is `/home/nathaniel/.local/state/openplan/project-budget-reviewed-isolation-20261016`, branch `work/project-budget-reviewed-isolation-20261016`. It starts at the root's documentation checkpoint `88a412fcce962a083a8f107da4795b302bc308da` and applies only patch SHA256 `404acef304a567807dc2ef2dda3292bc2e83eb0baaba9cce56d7567fe13af35c`. The original checkout's three inherited staged changes remain exactly unchanged. The canonical checkout's unrelated three paths remain unchanged.

Independent review `75bf571d590de8f1bd57d67f601a86a788043501` finds no new P1/P2 within this source isolation scope. Its complete report and seals are copied byte-for-byte into this branch. Parent inspection matches all four public hashes, 146 private regular-file entries and one dependency link. The first parent manifest reader assumes every entry has bytes and stops on that link; the corrected comparison handles the declared link target. It changes no evidence.

Existing author evidence remains 254 related tests, changed-file lint and a seven-entry compiler closure. Independent evidence remains 26 selected tests, a harmless survivor, six named faults and exact restoration. These checks concern the identical app tree and are not rerun merely for this mechanical commit. They do not establish native SQL/RLS, complete committed API reads, concurrent snapshots, API writes, browser/390px, exports or finance acceptance.

The exact-money candidate `360420ac` remains separate and unapproved. Its formatter-scale P2 remains open; no arithmetic acceptance or combined-source acceptance follows here. Migration 19 stays unapplied. Main, hosted promotion, M11 and v1 remain unchanged. A push of this checkpoint does not establish CI or release acceptance.
