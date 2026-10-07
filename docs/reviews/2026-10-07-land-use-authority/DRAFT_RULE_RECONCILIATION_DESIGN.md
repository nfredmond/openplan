# Reconcile an older working plan with current rules

October 7, 2026. This is the next implementation step within roadmap M1, not a
new queue or a completed capability. The connected plan-kind readers and guards
do not by themselves repair drafts created under the earlier family checklist.

## Staff outcome

An older specific-plan draft can contain authored general-plan sections. Staff
must be able to review the current checklist and add its missing sections without
losing that earlier work. OpenPlan must not infer that text written for one
requirement satisfies another requirement.

The working view will list missing current sections, newly required applicability
keys, and earlier sections whose keys are absent from the current checklist.
Staff explicitly confirms the selected rules before applying the change. The
action adds blank sections and the checklist's non-conditional default keys,
including required and locally defined content. It preserves every existing node,
title, body, evidence link, policy relationship, map designation, implementation
action and earlier version. Earlier sections remain editable and visibly labeled.
This action makes a draft ready for further writing; it does not complete its
content or establish statutory sufficiency.

The workbench must refuse this action while local edits are unsaved. Refreshing
after the response must not discard unsaved text, evidence selections or plan
context. Historical views remain read-only. An original draft and an amendment
use the same operation, scoped to their actual working version.

## Command and transaction

Use a dedicated command with an immutable command ID, working version ID,
expected draft revision and expected selected-descriptor hash. The browser
retains exact request bytes before sending. Account, workspace and plan scope
remain explicit. Reading a saved request never sends it. A lost reply offers an
explicit exact retry and a downloadable recovery copy.

Follow the existing creation and freeze command patterns. The server checks
origin, current staff access and expected account/workspace headers, and refuses
agent writes until an approved action exists in the action registry. A scoped
receipt lookup precedes current-rule preparation, so an exact retry still works
after the installed rules or current draft changes.

The database transaction rechecks current membership and locks the plan and
working version. It verifies the selected descriptor, expected revision and
command bytes before changing anything. It appends only missing keyed sections
and unions non-conditional defaults with existing applicable keys, matching new
plan creation. Locally defined content remains distinct from a configured legal
requirement. Conditional sections stay
visible without becoming applicable automatically. It does not change plan
identity, frozen snapshots, existing section text or map/evidence records.

An append-only command journal retains the exact request, selected descriptor,
before/after revisions, added section identifiers and resulting applicable keys.
The receipt binds actor, workspace, plan, version, command and descriptor hash.
Current write permission remains necessary for replay. A repeated command with
different bytes or attribution conflicts. A concurrent draft edit, freeze,
reconciliation or permission change must either serialize safely or refuse with
the original request preserved. Every new section, applicability update and
receipt must commit or roll back together.

## Required evidence

Tests must cover a fresh draft, an older authored draft, an amendment, missing
and already-present sections, retained older applicability keys, changed rules,
changed revision, exact retry, lost response, storage refusal, account changes,
another actor/workspace/version, and read-only historical views. Harmless controls
must survive; targeted faults must fail the intended assertions.

Native checks separately prove permission rechecks, duplicate/concurrent command
handling, rollback, draft-counter behavior and byte-for-byte preservation of
existing text, relationships, maps, evidence and frozen editions. An identified
build then needs desktop and 390px navigation, console review, interrupted-request
recovery and usable downloaded recovery files. Mounted tests and native HTTP
requests do not substitute for that rendered evidence.

This design adds no migration or product behavior by itself. Full amendment,
reporting, public/export agreement, practitioner observation and the remaining
M1 requirements retain their existing open boundaries.
