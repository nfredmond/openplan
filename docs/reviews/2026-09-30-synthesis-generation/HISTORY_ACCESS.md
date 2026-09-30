# Current staff synthesis history

September 30, 2026. Unreleased work after main `6b25a6d9` and published v0.65.0. Full QA, shuffled tests and the complete isolated database suite pass. This checkpoint still needs exact-commit GitHub checks after pushing. Exact-commit CI and RLS for the earlier main checkpoint `6b25a6d9` both passed. This note does not declare a release or complete M9b.

Current campaign staff can load retained synthesis choices through their own authenticated client. Migration 36 adds a history command bound to the current caller, campaign and request. The server verifies the original source, selection receipts and provider captures, then rechecks current access before returning. Receipt attribution stays with the original requester. An explicit selection sequence preserves earlier choices, including the empty sequence zero.

Cancellation or the original requester's departure does not erase retained work. The new history read does not renew execution permission, retrieve credentials, change choices or call a provider. Original-requester checks on planning and execution remain in place. This supersedes the missing current-staff reader identified in [the earlier selected-output checkpoint](SELECTED_RESULTS.md), for this internal read path only.

## Verification

Full QA and shuffled seed `481937` each pass 16,401 tests with 1,041 explicit skips across 1,363 passing and 67 skipped files. Lint, dead-code checks, provider connector checks, the dependency audit and the Next.js 16.3.8 production build pass. The audit reports zero vulnerabilities. Ordinary QA skips database fixtures. The separate complete isolated database gate passes 945 tests with 125 explicit skips across all 74 files, including the new history suite.

The two focused unit files pass 86 tests. TypeScript and focused lint pass. A harmless comment survives the unit mutation campaign; 11 targeted faults fail. Removing campaign/workspace checks exposes mismatched scope; dropping the final access check returns a result after access loss. Discarding the requested anchor or treating zero as latest fails the retained-sequence assertions. Some faults fail an earlier query/projection expectation or a later integrity check, so their failure alone does not establish that every guard independently prevents disclosure.

The installed native history suite passes all 18 cases. It includes a harmless local-variable rename and 16 permission, request, sequence and pagination faults. The complete native worker suite and trusted-table lookup suite pass 17 tests together. Those checks use PostgreSQL, Auth, PostgREST, Kong and the actual worker CLI against an isolated local stack. Only the provider is synthetic.

The authenticated case retains one original output after cancellation, requester revocation and a lost acknowledgement. A different current staff member reads the original bytes and checksum without another provider call. Sequence zero returns no selected outputs. Revoking the reading member then refuses access. A harmless comment passes this same case; dropping returned captures fails the output count, and substituting the old requester-bound read fails with an unavailable inventory. All temporary source mutations are restored.

Migration 36 applied additively to the populated isolated stack. Before and after counts match for 112 requests, 468 attempts, 440 outputs and 468 selections. Sorted ID/checksum aggregate fingerprints for outputs and selections also match. These fingerprints cover the named retained rows, not a complete restore or physical power-loss recovery.

The initial SQL fixture failed when it tried to demote the last owner. Another stale expectation assumed sequence five after the shared fixture had advanced to six. Two fault assertions needed ordering corrections. The first proposed harmless rename also changed the public JSON key, so it was not harmless. The corrected control renames only a local variable and passes. [The proof record](history-access-proof.json) retains those failures and later results.

## Remaining boundaries

No browser route or staff generation interface uses this loader yet. These tests do not establish browser navigation, language quality, planner usefulness, provider billing or representative participation. Source and output assembly remains memory resident; large-corpus capacity is unproved. Complete record/context processing, retained machine proposals, explicit import into a new staff review revision and browser recovery remain required under M9b. Published v0.65.0 and the demo are unchanged.


## Exact-commit GitHub follow-up

Main `a20346a29e12fba9b0dde97fdca62bab3099b59f` passed [CI](https://github.com/nfredmond/openplan/actions/runs/36775176542), [isolation](https://github.com/nfredmond/openplan/actions/runs/36775176785) and [populated upgrade](https://github.com/nfredmond/openplan/actions/runs/36775176673). This supersedes the pending GitHub status at the start of this note. CI QA passes 16,394 tests with 1,048 skips; native isolation passes 945 with 125 skips across 74 files. The upgrade from v0.65.0 preserves representative nonempty counts `2:2:1:1:1:1:1`. These are engineering checks for this checkpoint, not a release or a completed contextual-generation workflow.
