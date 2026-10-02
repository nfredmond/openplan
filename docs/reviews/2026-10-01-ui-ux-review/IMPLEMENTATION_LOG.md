# UI/UX review implementation log

Work happens in the worktree `~/.local/state/openplan/ui-ux-2026-10-01` on branch `work/ui-ux-review`. Nathaniel delegated the design decisions in section 7 of the review on October 1, 2026, and accepted the recommendations as written.

## Phase 0, October 1, 2026

Checks run in the worktree: `npm run lint` (clean), `npm run deadcode` (exit 0), `npm test` (16,641 passed, 1,173 skipped), `npm run build` (exit 0). Not run: `test:provider-connector`, the live RLS gate and `npm audit`. None of the changes touch a worker, a policy or a dependency.

Browser checks ran against a dev server started from the worktree on port 3210 (`/proc/<pid>/cwd` confirmed), as the local test account, at 1440 and 390 pixels wide. The dev server did not pick up stylesheet edits until `.next` was removed and the server restarted.

| # | Fix | How it was checked |
|---|---|---|
| 1 | Secondary and destructive buttons use paired token ink. Cause of KI-2026-09-05-062 | Chrome, dark mode: "Generate the report packet" computes rgb(240,237,230) on rgb(26,34,38), 13.81:1. New guard `ui-primitives-use-token-ink.test.ts` fails when the old class is restored |
| 2 | Auth callback keeps a query string on `next` | New `auth-callback-destination.test.ts`; fails with `/dashboard%3Fintent=modeling` when the old assignment is restored. Not exercised through a real confirmation email |
| 3 | Portal name hint says the name appears publicly once approved (English and Spanish) | Read in source. Spanish wording was written by the model and has not been reviewed by a Spanish speaker |
| 4 | Attribution control on the seven maps that had none | Chrome: one attribution control on the dashboard backdrop, Corridor Analysis, Aerial and the portal. On non-map pages the backdrop's control sits under the rail; Phase 2 removes that backdrop |
| 5 | Missing tract values draw in a no-data grey, with a legend entry | Three pinned tests updated and one added. Not checked on screen against a tract with a missing value |
| 6 | Corridor Analysis rail readable in light mode | Chrome, light mode: tile values, heading and select compute rgb(240,237,230) |
| 7 | Stat tile grids size to their container; grants catalog uses one column | Chrome at 1440: grants 7 tiles in 3 columns, project page 4 tiles in one row |
| 8 | Sign-in form before the marketing text on phones | Chrome at 390 by 844: email field at 425 pixels, submit button ends at 662 |
| 9 | Skip link and one `main` landmark per page | Chrome: first Tab focuses "Skip to main content"; Enter moves focus to `#main-content`; one `main` on the dashboard and the portal |
| 10 | Portal error and loading pages | Compiles and builds. The error page was not triggered in a browser |
| 12 | Language picker is one row that opens to 44-pixel links | Chrome at 1440 and 390: closed row reads "Language English"; 22 links, 44 pixels tall |

## Still open from Phase 0

- A closed or archived campaign still returns the generic 404 (P4). It needs a read-only results page, which is new behavior and belongs with the portal work in Phase 6.
- Favicon, PNG social image and scaffold file removal (P10). These wait on the wordmark in Phase 6.
