# Engagement case journey, November 2, 2026

Milestone-proof attempt for roadmap M9b: trace one contribution from source to
theme, response and decision. This is an agent-run planner and participant
journey on a local build. It is not a hosted proof and not human feedback.

## Provenance

- Build: `main` at `2c6e7db` (health reported commit `2c6e7dbc84e7`, version
  0.72.0, 448 migrations expected) served by `next dev` on port 3495 from this
  branch's worktree. The fixes in this branch were checked on the same server
  after hot reload.
- Database: an isolated local Supabase stack (project `engagement-case`) with
  all 448 migrations applied. No hand-seeded rows; every record came from real
  navigation in Playwright Chromium 145.
- Staff: a new account, `planner-ec@openplan.test`, signed up through the form,
  which created the workspace. Residents: a second browser profile with no
  cookies.
- Place: Sandpoint, ID, from the TIGERweb city search.
- No AI key was configured. Exports ran through the repository's
  `document-exports` worker.

## What the journey recorded

1. Staff created project "Fifth Avenue Corridor Safety Study" with Sandpoint as
   its area of record, and a proposed project decision: "Add a high-visibility
   crosswalk and curb extensions at Fifth Avenue and Cedar Street."
2. Staff created a campaign from the Corridor safety study template, linked it
   to the project, and set it Active.
3. The anonymous resident sent six contributions: a map point, a line, an area,
   a Spanish comment with no location, a keyboard-only point, and a point
   tapped at 390px. A seventh keyboard-only comment at 390px confirmed a fix.
4. Staff approved five with a note and rejected one (utility billing, off
   topic) with a reason. The seventh was approved later.
5. Staff saved the approved comments as a synthesis source and corrected the
   staff review twice, so one theme, "Walking safety on Fifth Avenue," holds
   the crossing comment (`d90d2cdc`) and the sidewalk comment (`6c08172a`).
   Staff approved revision 3.
6. Staff wrote and published the response "Walking safety on Fifth Avenue,"
   linked it to both comments, linked the theme to it, and linked it to the
   project decision, then refreshed that link to capture the theme.
7. The resident saw the published response, with "Answers these comments,"
   in English at 1440px and Spanish at 390px.
8. Staff downloaded internal and public review files (PDF, XLSX, ZIP) and
   generated the project status packet.

## Trace result

The internal review PDF, workbook and ZIP each carry contribution `d90d2cdc`
("Near misses crossing Fifth at Cedar") to theme "Walking safety on Fifth
Avenue" (staff review `8d12308c`, revision 3, approved), to response
`a836888c` (published), to decision `f9c90631` (proposed). Counts agree across
the PDF summary, the workbook Summary sheet and the ZIP manifest: 6
contributions, 5 approved, 1 withheld, 1 response, 2 decision-link actions
(link and refresh). The ZIP's PDF and workbook match the separate downloads by
SHA-256, and all 11 manifest hashes verify.

The public review copy carries the contribution and the published response.
It leaves out the theme and the decision link, by design. The project status
packet cites the campaign's counts and the decision title but not the response,
the theme or the link (KI-2026-11-02-010).

## Images

| File | Shows |
|---|---|
| `portal-1440.jpg` | Public portal, step 1, key-free map on Sandpoint |
| `portal-sheet-390.jpg` | Public portal at 390px with the sheet open |
| `public-response-1440.jpg` | Published response and the two comments it answers |
| `public-response-es-390.jpg` | The same response in Spanish at 390px, marked untranslated |
| `staff-decision-history-1440.jpg` | Retained link and refresh between response and decision |
| `staff-review-files-1440.jpg` | Completed internal and public review files |
| `receipt-focus-390.jpg` | Confirmation heading holding focus after a keyboard-only send |
