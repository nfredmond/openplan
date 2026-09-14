# Next M9b seam: approval of an exact retained review

September 14, 2026. Engineering design prepared while v0.62.0 release CI ran; that release is now published. This is not implemented behavior and does not change that release's claims.

Later development checkpoint: the pure command, event, history and receipt rules are now implemented and mutation-tested in `synthesis-approval.ts`; see [protocol verification](APPROVAL_PROTOCOL_VERIFICATION.md). Native persistence, access enforcement and the browser workflow below remain unimplemented. No approval capability has been released.

## Reuse and scope

The current review schema deliberately preserves immutable `staff_draft` content and complete source membership. Do not rewrite old content to an approved status or infer approval from a saved correction. Extend this review with a separate append-only approval history, using the existing request identity, hash, staff access, native transaction and browser recovery patterns. The decision-link history already provides link/refresh/withdraw events with exact response history and reason; the translation-resolution code provides scope-bound receipt recovery. Neither is a substitute for approving a synthesis revision.

The existing role catalog exposes engagement.write for owner/admin/member, with no distinct engagement.approve permission. Keep current staff access unless a separate agency delegation policy is implemented; do not invent a role or silently let an agent approve. Existing synthesis routes refuse assistant writes. Preserve an executable refusal until the action registry has a reviewed exact-payload action.

### Existing approval mechanisms inspected

`20260909000001_work_program_review.sql` already binds workflow events to exact revision hashes and prevents old decisions from authorizing new content. Its program/revision/submission schema is specific to OWP administration. `20260826000004_governed_decision_packages.sql` retains exact project-evidence-bundle submissions and a distinct assigned approver; it is appropriate for governed project packages, not a standalone consultation with no project. Neither should receive a fabricated program, project or bundle to store a synthesis approval. Reuse their version-bound history and separation of review from adoption/publication, while preserving their existing policies.

`action-approval-server.ts` authorizes an exact agent action for a short-lived execution window. That receipt is not staff approval of a synthesis finding. `20260908000010_engagement_review_intent.sql` fences moderation changes to current item versions and fresh reasons; it does not approve an entire retained synthesis. The approval display must identify its actual actor and must not claim independent review when the author approved their own work. A project-package handoff still needs that workflow's assigned-approver rules.

## Proposed records and behavior

- An approval event names the review, exact revision ID/content SHA, source ID/SHA and preparation SHA, the authenticated staff actor, request identity, time and a reason. Its purpose is internal staff synthesis review. It does not authorize public release, submission, expenditure, plan adoption, representative-support claims or scientific accuracy.
- Keep `approve` and `withdraw` events append-only. Bind a withdrawal to the exact prior approval/event hash and require its own reason. Retain the approved content through the immutable revision rather than copying a mutable current draft. Preserve earlier approvals after later corrections, with an explicit historical/superseded display.
- New corrections do not inherit approval. Effective approval of the current view requires an unwithdrawn approval event matching that exact revision. A new source capture creates another review/source boundary and cannot inherit approval from an earlier selection.
- Approving requires the current revision and current approval-history predecessor to match the reviewed intent. The transaction locks the review head in the same order as correction writes. A correction that wins first makes the old approval request stale; a correction after approval creates an unapproved next revision. Do not erase an earlier approval to simplify this race.
- Exact request retries recover the original event before stale-head comparison, while rechecking current access. Changed payloads, actors, source hashes, revision hashes and predecessor IDs fail. An interrupted acknowledgement must not create a second approval or rewrite the original actor/time.
- The UI shows full content, unassigned/overlapping contributions, explicit unassessed interpretation and the exact version being approved. Saving a draft never checks an approval box. Unassessed source grouping remains unassessed after staff approval. Require an explicit action and reason, without pretending a checkbox validates the meaning of staff prose.
- Private staff readers/listing and service-only mutation remain the boundary. No public or anonymous approval-history access is introduced. Keep account/source-scoped pending commands, body limits, current-membership checks and original/corrected evidence.

## Checks before claiming this seam works

Use exact current/older revisions, harmless controls and targeted faults. Cover no prior approval, approval then correction, withdrawn earlier approval, approval/correction races in both orders, simultaneous identical and competing requests, changed retry after lost acknowledgement, revoked staff access, another workspace and invalid source/content/preparation bindings. Native installed tests and the production TypeScript/RPC join must prove the transaction rather than mock it. Browser journeys enter through Engagement Analysis at desktop and 390px, inspect full text, approve, correct, withdraw and recover interrupted writes; verify current approval never carries to the correction. Validate the guard with a harmless survivor and a targeted wrong-version approval.

## Following connections remain required

Approval is only the next seam. Link approved groups and their complete source membership to retained staff-response and decision versions, then retain usable reviewed PDF/XLSX/open records. Current decision response contexts enumerate comment item IDs; survey-answer membership needs an explicit supported mapping, not omission from the chain. Public derivatives require their own authorized content boundary and exact approval when wording changes. Existing consumers of legacy cached summaries cannot silently become consumers of approved reviews.

Optional model generation still needs bounded prompts over the complete retained corpus, durable batch/attempt custody, output validation, unassigned/minority-source preservation and interruption handling that does not duplicate a possibly billed call. Use the existing translation worker/lease/provider patterns; do not revive the retired 300-comment route. Keep machine authorship separate from staff approval and preserve local/free operation. Full M9b, the rest of the roadmap and the complete V1 contract remain open.
