# Engagement map sweep, 2026-10-10

Nathaniel asked for a sweep of OpenPlan's public engagement map and a second
pass to make it better than Social Point's (formerly Social Pinpoint) 3D Social
Map. This note records what was observed, what changed on branch
`work/engagement-map-sweep-20261010`, how it was checked, and what remains.

## What was observed on the competitor

Observed in Chrome through Playwright on 2026-10-10, at
`https://demo.socialpinpoint.com/social-map/3d-social-map`, without an account.
Nothing was submitted to the demo. The page now carries "Social Point by Open
Point" branding.

- **Map.** Mapbox 3D buildings with pitch and reset-bearing controls, zoom,
  home, an address search box, find-my-location, share and fullscreen buttons.
- **Reading.** An Activity Feed panel ("A Walking marker was added. It is
  located at 253 Hoddle Street...") with "Load more". Choosing an entry opens a
  detail panel with author, date, comment, category and previous/next buttons.
  A banner shows "294 contributions so far".
- **Filtering.** A Categories panel and a Layers panel with per-layer switches
  (bike paths, train lines).
- **Contributing.** Add Marker, then a tap on the map, then a form: a required
  category select, a required comment, and an optional image (png, gif, jpg,
  jpeg; 5 MB).
- **Phone (390 px wide).** The site header, page title and toolbar come before
  the map, which starts about 610 px down the page. Add Marker is a full-width
  button under the map.
- **Defects seen.** At 1325 px wide, the open detail panel covered the Add
  Marker button, and a click on it was intercepted. The feed lists entries as
  "A Walking marker was added" rather than by what the person said.

These are observations of one demo configuration on one day. Entitlements,
moderation staffing and other configurations were not tested.

## Where OpenPlan stood before this branch

A code sweep checked the eight gaps recorded in
`docs/reviews/2026-09-04-pre-handoff/ENGAGEMENT_PRIORITY_RESEARCH.md`. Five
were already closed or narrowed: the 200-comment cap is gone (cursor paging),
receipts reach the resident, drafts survive a trip to the about page, the
operator close-loop read reports its errors, and a missing map key gives a
words-only form. Still open: photo metadata, anti-abuse keyed to one IP,
Spanish as the only translated catalog, close-loop source links, and no map
without a Mapbox key.

In the browser, three problems showed up that the sweep had not listed:

1. Tapping a neighbour's pin to read it also moved the resident's own mark
   onto that pin.
2. Pins on the map-first page were all the same blue. Topic colours never
   reached the map.
3. Comments could be read only on the about page, never beside the map.

## What changed

- **Comments beside the map.** A Comments button opens a panel with search,
  topic filters (only topics somebody used), a list, and a detail view with
  previous/next, date, name, photo, support and a link to replies. Filters and
  search narrow the map and the list together. Tapping a pin opens its comment.
  Each comment has an address (`?item=<id>`).
- **The pin-tap defect is fixed.** A tap on a pin or line opens the comment. A
  tap on a group of pins zooms in. Only a tap on empty map marks. An area
  comment still lets a resident mark inside it.
- **Topic colours.** The operator's colour if set, otherwise the next colour
  from Okabe and Ito's colour-blind-safe set, with orange (the resident's own
  mark) removed.
- **Scale.** Pins are a clustered data layer instead of one HTML element each.
- **Map controls.** Find-my-location (moves the camera only), compass, and a
  3D buildings switch. Mapbox's button labels come from the resident's
  language catalog.
- **Photos.** Re-encoded with `sharp` before storage, removing EXIF, XMP, IPTC
  and ICC data, with orientation applied first.
- **Less text.** The rail went from roughly 15 lines of explanation to a title,
  a status chip, a progress bar and one question. The about page lost its
  posture card, fact tiles, mode labels and duplicate project card. Banned-term
  counts fell (for example "input" 39 to 32, "submission" 10 to 5) and are
  banked in the plain-words guard.
- **Honesty kept.** A comment count is withheld, not printed as zero, when the
  read failed. The review-before-publish sentence remains, reworded plainly,
  and passes its protected-claim check.

## Added after the first pull request

- **Find a street or place.** A combobox over Mapbox's geocoder on the existing
  map key, ranked near the map's centre, in the resident's language. A result
  moves the map and gives it focus, so Enter marks the spot. Checked live:
  "125 Mill Street" returned Grass Valley first, in English and Spanish at
  390 px. `OPENPLAN_PUBLIC_PLACE_SEARCH=off` removes it; the self-hosting
  provider table names the data sent.
- **What happened to a comment.** The open comment shows the team's published
  response that cites it, with its translation caveat, and its approved
  replies. Each "We did" entry on the about page lists the comments it answers,
  linking to each on the map. This closes the September gap 7 (public response
  without inspectable sources). Not seen in a browser: no local campaign has a
  published response citing comments, or any approved reply, and creating them
  would have written into the shared database. Tests and mutation checks cover
  it.

## How it was checked

- Browser, dev server on port 3530 from this worktree (base `565cd983`),
  desktop 1440 x 900 and phone 390 x 844, English and Spanish, two local demo
  campaigns. No console errors. Keyboard: Enter opens a comment and moves focus
  into it; Escape returns to the same list row, then closes the panel.
- 71 related test files, 1,564 tests, pass. `tsc --noEmit` and ESLint on the 33
  changed TypeScript files pass with no warnings.
- Mutation checks: 18 targeted breaks in the map work and 7 in the photo work
  each failed the test written for them; four harmless changes survived.
- The browser caught one defect the tests had passed. A shared link selected
  its comment after the style loaded but while tiles were still streaming,
  when Mapbox's `isStyleLoaded()` answers false, so the camera never moved. The
  stage now uses its own record of `style.load`, and the test double
  reproduces the tile-loading window so the test fails without the fix. One first-run pass (the 3D switch's camera
  guard) was unable to fail, so the test was rewritten until it could.
- Not checked live: a photo upload. It would have written into the shared local
  database, which is not a test target. Route tests check the stored bytes.

## What remains

- **Map without a Mapbox key** (roadmap requirement), anti-abuse that does not
  block a shared connection, catalogs beyond Spanish, and replying from the
  map.
- **People.** No resident, screen-reader user or agency moderator has used
  either product for this comparison. A superiority claim needs that
  observation; this note supports a development target only.
