# Original uncertain processing commit inspection

This M3/M5b candidate lets an explicit recovery caller inspect the original task
after a commit acknowledgment is lost. It composes the original commit journal
with the existing current-access observer. It sends no new POST and keeps
reported task metadata separate from an exact command reply.

## Behavior and custody

The caller supplies the original Commit and Observer on the same owned runtime.
Inspection rechecks that relationship at invocation. Retained-source and
prepared-plan validation still apply. Incomplete drafts, an unissued commit and
an acknowledged commit return without a task GET.

An unresolved commit requires its saved processing dispatch and takes the same
writer lock as the commit coordinator. A fresh observer uses the remaining
commit budget. Current application access surrounds the supervised GET and
private task-record publication. Native engine checks surround the GET. The
observation must bind the original engine-plan hash.

An exact reply that arrives separately remains an exact reply. The final journal
snapshot reports that arrival without claiming processing completion. Otherwise
the commit stays unresolved, even if the task reports failure or completion.
The job hook preserves its prior state. Retry, callback and publication
permissions remain false. Processing quality remains unassessed.

## Checkpoint and limits

The source cohort uses actual original journals, the actual application reader
with supplied RPC receipts and a supervised loopback GET. It covers lost reply,
early holds, original dispatch, observation hash, current revocation, runtime
binding, ownership, expiry, a separately arriving exact reply, the remaining
read budget and original job identity. Source controls and native composition
remain in progress.

The first fault runner stops before baseline on a duplicate source anchor.
Later runtime-alias trials expose an incompletely prepared fixture and an
incorrect failure diagnostic. These failed trials do not count as accepted
controls. Their private logs remain. The fixture now issues a lost original
commit under ownership before replacing the observer runtime.

The native producer sends one real original commit to the retained pinned
engine, deliberately discards its reply, then inspects through actual private
RPC and native engine checks. Its two invalid ordinary inputs can prove reported
task failure and custody; they cannot establish useful reconstruction or
measurement quality. Native acceptance remains pending.

No default worker, migration, setting, public callback or artifact path changes.
These cooperative checks are not an atomic remote revocation fence. Supplied
source fixtures do not prove public network behavior, current hosted schema
recovery, complete installation backup, physical-host transfer, browser use or
practitioner acceptance. Useful processing, result/callback custody and the full
M3/M5b/V1 outcome remain open.

## Current source controls

Python 3.14 and 3.11 each pass 15 cases in four positive cohorts, including
harmless edits and restored source. Fifteen targeted faults fail at their
intended assertions; 105 oracle controls reject wrong cases, exits, diagnostics
and failure kinds. Both source files restore in finally. The serial service
stops successfully, peak 57,765,888 bytes under 256 MiB, with zero swap/max/OOM
counts. The first native composition is running. Its final outcome and full
workflow, GitHub and integration checks remain pending.

## First native lost-reply composition

The first actual native composition passes the retained 17-case RPC lifecycle.
It sends one supervised original POST under two current application reads and
three engine checks, then deliberately loses the exact reply. Replay stays held.
Inspection uses three further application reads, two engine checks and one task
GET. The task reports failed with two images. The commit reply remains absent,
and another commit advance remains held. No callback, publication, retry or
quality permission is promoted. The private copied task record remains exact.

The owned engine is inspected stopped without an OOM kill or published port.
The serial parent service stops, peak 62,685,184 bytes under 256 MiB, with zero
swap/max/OOM events. Native harmless/fault controls are now running serially on
both interpreters. The fixture uses retained synthetic schema, not current main
or hosted restore evidence. Useful processing remains unproved.

Python 3.14 native controls now pass four positive cohorts, 14 deliberately
broken variants and 13 failure-oracle controls. Each wrong byte hash, child
census, reported state, acknowledgment or permission stops at its intended
assertion. The driver restores in finally. Python 3.11 remains running.

Both native interpreter cohorts now pass four positive controls, 14 faults and
13 failure-oracle controls. All 37 current native engines are independently
inspected stopped without an OOM kill, with exact owned proof labels. Restored
client, controller and producer bindings match. The candidate joins merged
PR293 main 790ca2d9e without changing its source bytes. The full current worker
recipe runs next; new branch and main/public acceptance remain separate.

## Complete local checkpoint

The actual 41-stage aerial workflow passes all 40 worker scripts: 772
unittest cases across 33 suites plus seven custom scripts. All
74 source/workflow bindings restore. The 20 nested-app documentation
cases, direction check and baseline/harmless/broken/restored pointer controls
pass. The service stops successfully, peak 934,776,832
bytes under 1 GiB with zero swap/max/OOM counts. Source and native evidence is
linked through the evidence folder. This is bounded fixture evidence, not
spare-capacity or useful long-computation acceptance.

Fresh branch GitHub checks, then main/public integration, remain separate.
No default activation, quality, callback, publication, current-schema recovery,
physical-host or browser/practitioner acceptance is declared.

## Shared validation deadline review correction

The PR review exposes fresh timeouts inside source preparation and engine
snapshots. Two actual slow-validation regressions fail before the fix: each
40 ms inspection takes about 400 ms. The shared deadline now reaches runtime
preparation, remaining source/ZIP validation, the effects constructor and each
snapshot. Deadline type checks occur before source validation. Actual journal
lock waits use the same bounded deadline. Original source timeout types remain
validated before clamping.

The 96 affected baseline cases pass. Both current source-control cohorts pass
21 cases, four positive cohorts, 21 faults and 147 oracle controls. An older
expiry mutation survives because the new journal fence also rejects it. That
survivor remains recorded; the corrected overlapping-fence variant removes
both final protections and fails at the intended assertion. Source edits restore
in finally. Fresh full recipe and native composition are running next.

These are cooperative validation and lock budgets. A blocking filesystem call
or arbitrary supplier callback is not preempted by this Python deadline.
No old-head CI, quality or full-worker acceptance substitutes for current checks.

The current 44-stage recipe passes 796 unit cases across 34 suites, seven
custom scripts, 76 restored source/workflow bindings and 20 documentation
cases. Direction and baseline/harmless/broken/restored pointer controls pass.
The service stops successfully at 882,700,288 bytes under 1 GiB, with no swap
or max/OOM events. The prior recipe trials retain their stale-anchor failure
and overlapping processing-permission mutation survivor. That permission
probe now breaks both the local check and shared Effects fence; it fails at
the intended no-intent assertion. No survivor counts as a killed fault.

Fresh native composition on the corrected source is running serially on both
interpreters. New-head GitHub and main/public integration remain pending.

Both fresh native interpreter cohorts now pass four positive runs, 14 faults
and 13 failure-oracle controls. All 36 current owned engines are independently
inspected stopped, with exact image/proof labels, no published port and no
OOM kill. Every current worker-source hash matches its saved binding. The
parent service stops successfully at 170,356,736 bytes under 256 MiB, with
zero swap/max/OOM events. These actual lost-reply fixtures still use invalid
ordinary inputs and older synthetic schema. They establish no useful output,
quality, current-main restore or physical-host acceptance.

The corrected local checkpoint is ready for fresh GitHub checks. Earlier
81809b5 checks do not establish this correction's acceptance. Main/public
integration and the default worker path remain open.
