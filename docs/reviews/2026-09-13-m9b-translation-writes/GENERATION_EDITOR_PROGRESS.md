# Generation editor integration evidence

2026-09-13. Continues `GENERATION_EDITOR_RESET_CHECKPOINT.md` from work branch
`work/translation-command-workflow`, checkout
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`.
The previous turn made progress by saving and pushing the unfinished editor at
`3253d1b2`. This increment verifies its native and React behavior and fixes two
JSX text-escaping lint errors. It does not activate or release the workflow.

## Evidence

- TypeScript completed with exit 0, rerun with a retained tool handle after the
  earlier check lost its exit status. Focused ESLint completed with exit 0.
- Five suites, 106 tests passed: generation helper/hook, actual parent integration,
  existing manual editor recovery, pending publication, and campaign authoring.
- `prove-generation-editor.py`: baseline and two harmless source changes survived;
  all 26 targeted faults failed their named assertions. The report hashes both
  source files and the test. It covers frozen source and saved revisions, request
  identity, workspace binding, exact archives, read actor/locale/fields/count,
  original history, retention before dispatch, exact retries after response loss
  and storage deletion, acknowledgement binding, and refusal to publish after a
  failed status read.
- `prove-generation-parent.py`: baseline and harmless parent edit survived;
  three targeted faults failed the actual parent test: skipping generation,
  omitting original history, and replacing the publication reason.
- The parent test uses the real generation, pending publication and manual draft
  components. It queues the snapshot's exact original source and revision, displays
  exact retained output, requires separate publication, sends references rather
  than browser-supplied generated words, and preserves an unrelated unsaved draft
  when publication is refused.
- Private logs: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/`
  `generation-editor-combined.log`, `generation-editor-controls.log`, and
  `generation-parent-controls.log`. Structured reports are beside this note.
- Fault runners restored all source edits after each case. Final diff check had
  no whitespace errors.

## Verification correction

The first history-workspace fault survived. The test changed the selected row,
which another pending-publication validation also rejected, so it did not test
this guard independently. The revised case adds a separately identified unrelated
history row in another workspace while keeping the selected original row valid.
Removing the history-workspace guard now makes that named assertion fail. The
initial fault-run configuration also refused an ambiguous replacement string
before modifying source; it was narrowed to the intended occurrence.

## Current limits and next work

These are synthetic native/React tests with mocked HTTP and safe output DTOs.
They do not establish server cryptographic verification, live database isolation,
provider/worker execution, public portal rendering, keyboard access or geometry.
The dev identity check confirms port 3260 serves this checkout, but this increment
has not rerun a real browser journey. Earlier manual and outline evidence does
not prove the new generation workflow.

Continue with the legacy staff producer route at
`openplan/src/app/api/engagement/campaigns/[campaignId]/translations/route.ts`.
Its suggest/publish-machine producers still generate inside the HTTP request.
Replace or refuse them before enabling protected commands. Assess public comment
translation separately. Keep the original source/saved baseline and distinct
requester/publisher evidence; never generate and publish unseen output.

Complete the remaining recovery cases: unreadable local requests with no server
record, quota/readback/archive failures, refusal-phase persistence, catalog
pagination and recovery, cancellation/lifecycle behavior as appropriate. Existing
safe exact retries and retained archives must remain usable without support.

Then join migrations 13 through 16 safely in the named isolated application DB,
run the actual local synthetic provider and durable worker through browser review
and publication at desktop and 390px, and complete relevant release checks.
The application stack's last verified permanent migration remains 12 and command
execution remains revoked; this increment did not alter DB state or start workers.

At this check, main was `ef16f166447ab477ea36588a5c01620f61560b19` with CI
34779793816 and RLS Isolation 34779793752 both completed successfully. Those runs
cover main, not this work branch. No new tag or main update was made. The full V1
objective remains active; no human-review release gate is required.
