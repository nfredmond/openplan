# Fresh request, permission recovery and worker handoff

Recorded October 6, 2026 Pacific time on production build
`8ca7dc23d332b9a6a500d61afcdef1a29c21d18e`, version 0.66.0. Health identity,
Next process 1168582 and its cwd identify the execution-controls worktree on
port 3479. The owned restore-target database uses API port 29821. The normal
demo and benefit-cost checkout remain untouched.

## Historical fixture correction

The earlier [permission recovery](EXECUTION_BROWSER_00B849.md) uses request
`a0a2c622`. A later read-only worker preflight refuses that request because its
retained plan differs from reconstruction. This is the preserved initial
October 2 failure, already described in the
[producer findings](../2026-10-02-thematic-ui/PROGRESS.md#native-producer-and-browser-findings).
Commit `e2b0472f` fixes source-field insertion order. The original failed plan
remains unchanged. The later historical `54c0e22b` plan still reconstructs
exactly. No dispatch occurs during the failed preflight.

The earlier no-dispatch observation is valid, but that fixture cannot establish
a permission-to-working-worker handoff. The fresh case below supplies that
separate evidence. No old plan, source or output is repaired in place.

## Fresh browser request and execution

Through the current saved-source UI, staff selects the existing synthetic local
API and model, saves request `3ebc394b-35de-48c2-b65d-65dce0d7c0cb`, and queues
preparation. The existing preparation journal consumes only this selected
request. It seals four tasks and 43,932 bytes. No unfiltered queue is drained.

The execution UI shows the exact local destination, original model, task count
and resource limits. Explicit acknowledgement saves permission
`6be8af02-f007-4343-826e-6ed8bdbe5f59`, with four attempts, 2,048 output tokens
and 65,536 response bytes per call. Expiry remains `2026-10-07T08:18:00.000Z`.
An injected transport failure withholds the real HTTP 200 reply after commit.
The UI retains the unconfirmed original command.

Worker preflight reconstructs the fresh source and sealed plan exactly. It
checks the selected account, workspace, campaign, permission hash, expiry and
local unauthenticated synthetic destination. The synthetic provider accepts
only the four pinned canonical tasks. The existing CLI executes this permission
and retains four outputs, with no unobserved or omitted task. It does not create
another request or allowance. The current authenticated history reconstructs
all four original outputs and reports `ready_for_record_consolidation`, with
interpretation `not_assessed`.

Repeating the same CLI command and private journal leaves all native attempt,
dispatch and output IDs and hashes unchanged. A second repeat uses a provider
request log that records every incoming request. It remains empty. The four
earlier accepted calls remain separately recorded. Both synthetic provider
processes are stopped after the check.

The saved source, request and execution review reopen in a second owned T3 tab.
Recovery sends no automatic POST. Explicit retry sends the identical original
body and returns the same permission ID, intent bytes, checksum and expiry,
including after its tasks completed. Native inventory remains one allowance,
four attempts, four dispatches and four outputs. Historical context and theme
inventories remain unchanged. This case uses synthetic wording and no paid API.

## Browser and acceptance limits

The separate attempt-limit check on this build confirms that a chosen limit of
one survives refresh and close/reopen. Refresh clears charge acknowledgement.
No POST occurs in that check. The production build and TypeScript pass.

T3 evaluation operates observed DOM controls and receives actual application
responses. Some evaluation calls time out and one transport connection fails.
Snapshot capture continues to fail at desktop and mobile sizes. No complete
pointer, keyboard, visual or console acceptance is claimed.

Resizing an existing tab to 390 pixels initially leaves the surface at a
240-pixel offset and clips the retry control. Inspection finds the `left`
transition still running at time zero more than 30 seconds after resize,
despite the mobile media query matching. This observation remains retained;
it does not establish the cause of T3's rendering failure. Reloading at 390
pixels gives a zero surface offset, a 390-pixel document and a retry button
from x=42 to x=320.08. The original allowance remains recoverable. Reload DOM
geometry does not replace visual acceptance or prove resize behavior works.

The UI still lacks worker progress and complete dependent context/theme request
creation. Local operator execution here proves the existing handoff, not a
complete staff-only generation journey, semantic quality, public publication,
practitioner usefulness or the full M9b case.

The [evidence directory](execution-browser-8ca7/) excludes credentials, raw task
source and private worker journals. Its comparison script checks original
permission bytes, native custody, exact restart results and mobile reload
bounds. Harmless evidence reordering survives; targeted faults fail. These
comparisons cannot establish independent rendering or human usefulness.

Main `176feca8` has passing QA and live RLS checks. On `8ca7dc23`, GitHub shuffled
tests, focused workers and all three Python checks pass at the last read.
QA and live RLS remain running. This note does not merge PR #117 or declare
a release. Final visual and console acceptance remain open.
