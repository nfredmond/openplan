# Queued proposal through staff response and export

October 7, 2026 Pacific time. Synthetic acceptance against application build
0270e9cb, owned production service on port 3505 and isolated database API 29821.
T3 preview supplies the browser interactions and downloads. No public campaign,
agency adoption or real participant outcome is claimed.

## Staff review and decision history

The retained thematic proposal has zero groups and two unassigned contributions.
Staff review 32058354-525b-4a69-9b3e-108bac5dfaac imports that proposal at revision
2, then records separate groups for the shaded-crossing request and contrasting
objection. Revision 5 assigns both contributions without overlap. Its digest is
`eb021014f8e7665fd061043f47030628d58e1dbdbe79e84ebde464026c4ccb9a`.
The explicit synthetic staff approval does not change the machine proposal.
Reopening revision 2 preserves its original digest and unapproved state.

Both groups are linked through the interface to the existing draft response.
The earlier manual-review citation remains unchanged. A reviewed correction to
the decision context creates refresh event dad37265-4ed9-4904-99f5-b5f4aa633c47.
Its context digest is
`f88ed77bae2e6189e1ccf13b54a06b8653b4f0a5df72d4b5fe1ffc8ab93bdf61`.
The earlier link and withdrawal remain in history. The decision stays proposed;
the response stays draft. This is a software record, not agency approval.

## Actual downloaded files

The internal export job fc04d8e7-05a7-46e5-bf94-120d8163ff0b completes through the
existing report processor. Browser downloads of PDF, XLSX and ZIP match the
worker files by length and SHA-256. The ZIP passes CRC checks; its embedded PDF
and workbook match the separate browser downloads.

All 21 PDF pages were visually inspected. No clipped or overlapping source text
was observed. The workbook retains three decision events. Six context/command
values reconstructed from its Longtext sheet equal the exact snapshot strings
and their recorded digests. The current context includes both new review groups
and retains the earlier manual history. Native Excel or Calc review remains open.

The public review copy, job 8dfe1e19-bd1f-4aa7-8d93-7a27e40c879c, also completes.
Its three browser downloads match the worker files. The five PDF pages were
visually inspected. Its snapshot contains two approved contributions, zero draft
responses and zero private decision-history rows. Its eight-member ZIP excludes
the private decision-history CSV files. The workbook excludes the private
Decision and Synthesis sheets and checked private history markers. The two
contributions remain labelled staff-authored notes. A public review copy does not
publish the campaign or establish resident authorship.

Private evidence remains under
`/home/nathaniel/.local/state/openplan/synthesis-queue-acceptance-20261007/`:
`response-handoff-artifact-checks.json`, `response-handoff-downloads.json`,
`public-response-handoff-downloads.json`, original downloads and rendered pages.
Raw snapshots and source text are not added to the repository.

## Unresolved observations

Three HTTP 503 console entries occur during the return to Analysis at
00:41:22–00:41:23 UTC on October 8. Later reads succeed. The cause is not yet
established, and this is not a clean-console acceptance claim.

At 390 by 844 CSS pixels, repeated pointer activation of the Projects rail link
does not navigate during the observed attempt. Focusing that same anchor and
pressing Enter does reach Projects. The cause remains under investigation.
The Projects header also places New project beyond the viewport in the observed
layout. These findings remain open; successful file downloads do not resolve them.

Observed human usefulness, interpretation quality, native spreadsheet operation,
host-loss recovery and the complete V1 contract remain separate requirements.

## Mobile diagnosis and source correction

A subsequent T3 event probe identifies the pointer failure. Before focus, Projects
occupies x=150.959 to 221.444 CSS pixels, with width 70.485. Pointer-down reaches
that anchor at x=186.201. Desktop short-height focus rules then restore six group
heading margins. The anchor moves to x=100.571 to 127.866, width 27.295; pointer-up
and click reach a DIV instead. Keyboard activation does not depend on that pointer
position and succeeds.

A temporary phone-only style keeps those heading margins and heights at zero.
The same pointer interaction then reaches the anchor for all three events and
navigates to Projects. The source correction adds that rule to the existing phone
bar stylesheet. Desktop heading rules remain scoped as before.

The Projects action container already wraps, but its intrinsic width is 568.222
CSS pixels inside the 390-pixel viewport. A temporary maximum width of 100 percent
and minimum width of zero bounds it to 352.845 pixels. All three actions then fit
on separate lines. The source correction adds these constraints to PageHeader's
shared action container. The existing six safety-map rail tests and targeted
PageHeader lint pass. No test or guard changes in this layout correction.

The diagnostic screenshot is retained privately as
`browser-screenshot-openplan-history-localhost-muyttgjj-0d5cb937.png`. It shows
injected diagnostic styles, not a rebuilt candidate. These causal checks do not
replace desktop and 390px acceptance against the next identified production build.
The three earlier HTTP 503 entries remain unexplained.

## Rebuilt layout acceptance

Build 9dfbeaa4 compiles in 29.5 seconds and finishes TypeScript in 19.6 seconds.
The bounded build exits 0 on October 8 at 01:04:35 UTC. The replacement owned service
`openplan-synthesis-queue-prod-9dfbeaa4.service` uses port 3505. PID 965166 has the
expected isolated application cwd; health names commit 9dfbeaa4a8f3 and version 0.67.0.

T3 navigates from the campaign Record tab through the real Projects rail link at
390 by 844 and 1440 by 900 CSS pixels. Both pointer activations reach Projects.
There is no injected diagnostic stylesheet. At 390px all six rail headings retain
zero height and margin after focus. The three header actions fit between x 15.991
and 262.780. New project opens its dialog; Escape closes it without creating a row.
The desktop header retains its single action row and visible navigation labels.

Both screenshots were visually inspected:
`browser-screenshot-openplan-history-localhost-muyu46fe-baf792ac.png` and
`browser-screenshot-openplan-history-localhost-muyu4dhj-3aed3456.png` in the private
T3 browser-artifacts directory. The compact Projects snapshot includes the console
history and shows no new entries after 01:05 UTC during this bounded check.
This does not erase earlier errors or establish whole-app mobile acceptance.

Database logs at 00:41:22.564,00:41:22.727 and 00:41:23.371 UTC identify the earlier
three 503 responses as request-lock contention in
`lock_synthesis_generation_request_scope`. Direct inspection later reads the
interrupted request successfully, preserving one selected attempt without output
and three unselected tasks. A tab-return probe also records review and approval
reads returning 503 then 200 through existing retries. No locking, dispatch or
retry behavior changes here; console-visible transient read contention remains.
