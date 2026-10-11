# Map packages: what was checked, 2026-10-10

Bottom line: phase A works end to end on this computer with a stand-in for
Claude Code. No model ran. The containment recipe for a live Claude Code run is
unproven, as the [design note](DESIGN.md) says.

## Database, against a disposable local stack

Stack `openplan-map-packages-stack` (ports 53420 to 53427), all 400 migrations
applied. `src/test/project-map-packages-rls.test.ts`, 7 cases, all passing:

- Only Claude Fable 5.1 (Claude subscription) or GPT-6 Astra (Codex) at high
  effort can be stored; Opus 5.5, Haiku 5.5, GPT-6.1 Sol and medium effort are
  refused by the table constraint.
- Request to ready: claim, a second claim refused while busy, heartbeat
  progress, upload refused for a second model or another kit, retries return
  the retained record, completion refused for a mismatched stored file.
- A running package whose lease passed becomes interrupted and is never
  claimed again; an uploading package may renew its lease.
- Cancel by the requester; a viewer cannot cancel. Revoking or deleting the
  connection, or removing the requester, closes open packages.
- Viewers read packages and files; outsiders and anonymous callers cannot;
  nobody writes the tables directly.

Seven targeted breaks of the migration each failed these tests for the stated
reason; a harmless change passed. One break first survived because the test
compared a possibly NULL value with `<>`; every comparison in the test now uses
`IS DISTINCT FROM`, and the break is caught.

Schema inventory counts were read from that stack: 761 policies (510
permissive, 251 restrictive), 229 tables with policies, 309 RLS application
tables, 14 application views.

Storage: a signed upload URL accepts a PUT with no API key, a repeat PUT is
refused as a duplicate, the stored bytes read back with the same sha256, a
missing object cannot be signed, and a file type outside the bucket's list is
refused.

## Routes

`src/test/map-package-routes.test.ts`, 23 cases: bearer required; claim hands
over the frozen brief and run prompt; a brief whose hash does not match is
refused; malformed file lists are refused before any database call; upload URLs
use the package's own paths; completion records what the server measured, not
what the connector declared; a missing object is "file missing", not an outage;
viewers cannot start, finish or stop a package; Codex connections are refused
until phase C. Eight targeted breaks each failed for the stated reason.

## Connector

`workers/planner_agent_connector/test/map-package.test.mjs` and
`connector-cli.test.mjs` (16 map package cases), with a stand-in for Claude
Code: the skill copy matches its manifest; credentials and the connection
folder are denied to every tool; no API key reaches Claude Code; every model
alias is pinned; another model, an API-key session, the step limit and a
cancelled package all stop without uploading; a run cut off mid-way is never
started again; only an upload resumes; previews shrink to 1,600 pixels. Twelve
targeted breaks each failed.

## The app, in a browser

Dev server from this worktree on port 3290 (process working directory checked),
pointed at the disposable stack. Chrome through Playwright. Everything was
created through the product's own routes and screens.

1. Sign-in, workspace and project through the app's routes.
2. Maps, Make maps, all five steps, Connect this computer (file downloaded),
   Start. The package page said "Waiting for your computer".
3. The real connector: `configure` from the downloaded file, `maps-check`
   (QGIS 3.40.15, bubblewrap and socat present), then `maps --once`. The
   stand-in copied a package the kit built on 2026-10-01 (55.5 MB ZIP, three
   figures). The page showed progress lines, then Ready: 110 of 110 checks,
   seven review gates pending, three figures loaded, download 55,533,656
   bytes through a five-minute signed URL.
4. A hand-built ZIP through the flow became Ready.
5. The project page's Map packages link opens that project's list.
6. At 390 by 844 the list and package pages have no horizontal overflow.

Browser console: no errors; two development-server font preload warnings.

Defects this pass found and fixed: the setup commands disappeared the moment a
computer was connected; the long configure command was cut off; "1 need a
decision"; and the receipt dropped review gates because a built package lists
them as an array, which the stand-in had not modelled.

Screenshots: [flow, connected](evidence/06-flow-connected.png),
[building](evidence/10-package-building.png),
[ready with gates](evidence/17-second-package-gates.png),
[ready at 390 px](evidence/12-package-ready-390.png),
[hand upload](evidence/16-upload-ready.png). The figures shown are from the
2026-10-01 practice package.

## Not checked

- A live Claude Code run, or any part of the containment recipe under a real
  model.
- Phases B to E in the design note.
- Grant application entry point in a browser (the link is in place; no grant
  application was created for this pass).
- The browser pass streamed previews at full resolution (3,300 to 5,400
  pixels wide). After it, the connector began shrinking each preview to 1,600
  pixels with the kit's Pillow, keeping the original when that fails; a unit
  test covers it, a browser pass has not.
