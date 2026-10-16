# T3 preview capture remains unavailable; the stalled substep is unresolved

Date: October 15, 2026. Scope: read-only diagnosis of existing capture failures.

The installed T3 code explains two misleading symptoms. `includeImage:false`
does not skip screenshot capture, and `visible:false` means no viewer connects
to the tab. Neither identifies the substep that stalls. The code also permits
an unfinished snapshot to hold the tab's operation queue after the broker
returns its timeout. This gives a concrete explanation for the subsequent
stalled visible-open attempt, but the retained logs do not prove that sequence
for an exact tab.

No documented snapshot argument fixes the blocker. Keep capture and desktop
and 390px acceptance open. Do not repeat the same snapshot or visible-open
attempt on the strength of this report.

## Evidence and custody

The diagnosis owns this new directory and the private directory
`/home/nathaniel/.local/state/openplan/project-preview-capture-diagnosis-20261015`.
It starts from a clean `t3/project-preview-capture-diagnosis` checkout at
`05dd3e8da4a4572437f06e771b0a2477873e681f`. Local commit
`8a9ede996a22b31bf68933b3f1f869d0fc837be9` exists and descends from that base.
No fetch or fast-forward was necessary for this report-only diagnosis.

The active T3 process names the mounted application archive
`/tmp/.mount_T3-CodjcgBBf/resources/app.asar`. Its package records version
`0.0.46-nightly.20261014.3132` and T3 commit `5a4e99805337`.
Relevant source excerpts and bundle hashes are retained privately in
`source-excerpts.txt` and `source-manifest.json`. Source line references below
refer to `apps/server/dist/binCli-CoSutiQf.mjs` inside that archive.

Two frozen root receipts were read without modification:

- `project-geography-preview-final-20261015/browser-tool-probe-01.json`, under
  the root's `gtfs-managed-ingestion-proof-20261009` evidence directory, records
  `2026-10-15T08:55:54.334889+00:00`. Tab
  `tab_5_04ad8e8d-007b-4300-817b-9cf70f5c64bd` opens against the old port 3584
  preview with `available:true`, `visible:false`, and accepted 1280 by 800
  freeform resize. It records `Preview automation snapshot timed out after
  15000ms.` and an unresolved stalled `show:true` retry. This is a receipt
  timestamp, not an independently established snapshot start time.
- `project-map-integration-20261015/browser-attempt-04` exists and contains
  one 552-byte `result.json`. At `2026-10-15T08:15:56.407804+00:00`, it records
  tab `tab_4_04ad8e8d-007b-4300-817b-9cf70f5c64bd`, the same snapshot error,
  and `Preview automation recordingStop failed: No recording is active for
  this thread.` Recording-start outcome remains unestablished because its
  raw result was not preserved. No capture or candidate acceptance is claimed.

This diagnosis made no preview calls. It did not inspect a parent or human tab,
open a tab, request any OpenPlan URL, or start an application build or service.

## Installed code explains the tool behavior

1. **Image flags change delivery, not capture.** The snapshot handler removes
   `includeImage` and `save` before dispatch (lines 323768–323771). The server
   snapshot runs page evaluation, an accessibility snapshot, and PNG capture
   together with `Promise.all` (lines 299890–299939). PNG capture sends
   `Page.captureScreenshot` (lines 299868–299889). The later MCP response
   handler applies `save` and `includeImage` after capture (lines
   325188–325205). A text-only snapshot request therefore still depends on
   image capture.
2. **A missing viewer is not a documented capture prerequisite.** Status sets
   `visible` from `tab.viewers.size > 0` (lines 301558–301605). The inspected
   snapshot path has no explicit visible-pane or animation-frame gate.
   Capture first waits for its capture lock and pauses connected screencasts,
   then evaluates the page, collects accessibility data, and captures the
   viewport (lines 301636–301644, 301691–301705, 301930–301933). No code here
   establishes that hidden Chromium content will produce a compositor frame.
   Hidden-frame starvation remains a hypothesis, not a demonstrated cause.
3. **The broker timeout does not cancel the underlying page operation.**
   The default is 15,000 ms, except preferred-host `open`, which receives
   660,000 ms (line 299164). The broker grants another 1,000 ms, then disconnects
   the host and returns a timeout (lines 299250–299257). The server request
   handler starts `runOperation(request)` without wiring an abort signal into
   it (lines 301958–301982). The inspected PNG command has no local deadline.
4. **An unfinished snapshot can obstruct later work on the same tab.**
   `SessionControl` chains actions through a promise tail (lines
   299670–299745). An owner's snapshot enters that queue (lines
   301880–301892), and a reused `open` enters the same queue before requesting
   reveal (lines 301800–301851). A never-settled snapshot can therefore leave
   a later `open` waiting even after the snapshot's broker timeout. The
   separate capture lock also waits for the preceding capture promise.
   This is a source-proven failure mechanism, not a reproduced assignment
   of the original stall to PNG, accessibility, evaluation, or screencast pause.
5. **The corrected arguments already match the protocol.** Native metadata
   documents `resize({mode:'freeform',width:1280,height:800,tabId})` and
   `open({open:true,tabId})`. Source normalizes `show` to `open`; sending both
   does not add a second reveal mechanism (lines 323655–323674). Snapshot
   metadata exposes `tabId`, `includeImage`, and `save`, with no timeout option.
   Passing an undocumented timeout is not an established remedy.

The desktop CDP relay forwards page commands to Electron. The inspected relay
does not replace `Page.captureScreenshot` with an alternate native capture
path (`apps/desktop/dist-electron/main.cjs`, lines 86893–86985).

## Logs confirm broker failures, not the stalled capture component

Five trace files were inspected. One provided only its top-level field schema;
the others used preview-specific filters and bounded timestamp windows.
No SQLite history, renderer history, profile contents,
credentials, or provider transcripts were read. Sanitized excerpts are private;
raw logs are not part of this report.

- `server.trace.ndjson.8:15365`: `PreviewAutomationBroker.awaitResponse`,
  October 15, 08:53:58.822445–08:54:14.823323 UTC, duration 16,000.878019 ms.
  Error: `Preview automation snapshot timed out after 15000ms.` Trace
  `2d6db1e5eb4b5333c30068f62ff453bb`.
- `server.trace.ndjson.7:20773`: the same broker span type,
  08:54:18.117708–09:05:19.118177 UTC, duration 661,000.468667 ms.
  Error: `Preview automation open timed out after 660000ms.` Trace
  `36da2553fb0f3b886874f17b312f1439`.

The timing and errors agree with the retained sequence. These spans contain
no tab ID or request ID, so their exact association with tab 5 remains
unproved. The later timeout is useful retrospective evidence. It does not
establish when the root's terminated tool cell stopped, whether reveal ran,
or whether any underlying promise subsequently settled.

Tab disappearance also remains unresolved. Code closes unwatched agent tabs
after 30 idle minutes and checks once per minute (lines 300811–300812 and
301517–301521). Broker timeouts remove host assignments. Neither observation
proves that ending a root turn closes its tabs. This child's tab state cannot
answer that question, and this diagnosis did not query it.

## Root next action and limits

Keep the OpenPlan application binding and capture blocker as separate findings.
The retained failures concern the old 3584 build, not the prepared 678 candidate
or the unstarted 3585 server. API 29948 success is not browser evidence. This
report does not establish desktop, mobile, screenshot, or recording acceptance.

For the next T3 investigation, use the two trace IDs above to locate an existing
per-operation or CDP completion record, if one exists. The missing fact is which
await remained pending: capture-lock acquisition, screencast pause, page
evaluation, accessibility collection, PNG capture, or screencast resume. No such
completion record was found in the bounded excerpts. Exact tab/request
correlation is also missing. If existing telemetry cannot supply those facts,
capture remains unavailable under this read-only scope. A T3 product repair or
new instrumented reproduction requires a separately scoped task.

No tests, guards, parsers intended for reuse, application changes, or T3 changes
were introduced. Source inspection can establish control flow, but cannot prove
the runtime behavior of an uninstrumented Chromium command. No live capture,
queue recovery, visibility fix, or tab-lifecycle explanation was verified.
