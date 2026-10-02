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

## Phase 1, first batch, October 1, 2026

Checks in the worktree: lint clean, dead-code check exit 0, 16,742 tests passed, production build exit 0. Browser checks on port 3210 from the worktree, dark and light, 1440 and 390 pixels wide.

| Change | How it was checked |
|---|---|
| Type floor. Added `text-label` (12px), `text-compact` (13px) and `text-reading` (17px). Moved 624 component uses and 77 stylesheet declarations under 12px onto the floor, and 197 more onto `text-compact`. Wide letter-spacing (0.16em and up) became 0.12em so labels did not grow wider | Chrome: zero text elements under 12px on 15 of 16 sampled pages, down from 89 to 268 per page at 390 pixels. New guard `type-scale-has-a-floor.test.ts` fails when a 9.9px badge is restored |
| `cn()` knows the new sizes are font sizes | Unit test in the same guard. Without it tailwind-merge drops `text-label` when a colour class follows |
| Status colours (`--status-ok`, `-warn`, `-urgent`, `-info`) are fixed in both modes and no palette overrides them. The status badge uses them | Three tone tests updated to the new classes; each failed first, so each still detects a tone change. Seen on screen in both modes |
| Always-dark surfaces (operator card, Corridor Analysis shell, studio panels, public rail, Planner Agent drawer) take dark token values in light mode | Chrome, light mode: the "Next" badge on the grants operator card and the Corridor Analysis rail are readable. `surface-text-stays-legible` was taught to find `.dark` inside a selector list; it failed first with "expected 4 to be greater than or equal to 5" |
| Input and select borders at 3.2:1 or better | Token change; contrast calculated, not measured in a browser |
| Light Cartographic accent #c03f1c (was #e45635) and warning text #8a5a00 (was #b78018) | Calculated: white on the accent is 5.29:1, accent on the page background is 4.68:1 |
| Grid children may shrink below their content | Chrome at 390 pixels, elements pushed past the right edge: grants 648 to 117, one project 391 to 2, one program 295 to 4, one model 325 to 62 |
| One global reduced-motion rule | Read in source. Not exercised with the setting on |

Known gaps from this batch:

- The generated model charts (`src/lib/models/charts/`) still set 10 and 11px text inside fixed-width SVG. The floor guard does not read SVG attributes. Phase 5 covers charts.
- The other four palettes were not looked at after the accent and status changes.
- One hydration warning appears on a model page in light mode. It was not traced, and I did not establish whether it predates this work.

## Phase 2, the page frame, October 1, 2026

Decision D1 as approved: ordinary pages no longer float over a wallpaper map.

Checks in the worktree: lint clean, typecheck clean, dead-code check exit 0, production build exit 0, 16,771 tests passed with one guard failure fixed afterward (a dialog `id` that the class-name guard read as an unstyled class; renamed and re-run green). Browser checks on port 3210 from the worktree at 1440, 1024, 800 and 390 pixels wide, dark and light.

| Change | How it was checked |
|---|---|
| The shared background map mounts only on the route that reads it (the Aerial index). Every other page has no map instance, tiles or feature requests behind it | `safety-owns-the-only-map` and three backdrop tests updated to the route where the map now mounts. Chrome: no Mapbox attribution or canvas on the dashboard |
| Plain shell: rail and header attach to the window edges; the page is solid, edge to edge, centered at 92rem. The rail opens over the page on hover and no longer pushes it sideways | Chrome at 1440, 1024 and 800 |
| The Planner Agent button sits in the header. The account card sits at the foot of the open rail; with a collapsed rail, sign-out is in the header | Chrome at 1440 and 1024 |
| Phone frame on every route: one 56px header row (workspace, search, Planner Agent), a bar with up to four named destinations and More, and a More sheet that lists all 20 destinations by name with appearance and sign-out | Chrome at 390 by 844: page area 390 by 732, 87 percent of the screen (was 358 by 568, 62 percent). Bar buttons 89 by 52 (were 48 by 23). A real tap on More, then Grants, reached `/grants` and closed the sheet with no console errors |
| Rail rows have a 24px floor | Read in source |

Known gaps from this batch:

- Safety and the Aerial index keep their own desktop layouts. The Aerial index on a phone starts its page 244px down to clear the map dock. Both change when those pages move to the shared map shell in Phase 3.
- Corridor Analysis still draws its own bordered shell inside the page.
- `qa-harness/openplan-local-control-hit-test-audit.js`, `-escape-hatch-audit.js` and `-card-nesting-audit.js` were not run against the new frame.
- The workspace clock under the workspace name is hidden in the plain shell.
- Keyboard order through the new header and the More sheet was not walked by hand.
