# Original worker coordination candidate, October 14

This candidate connects already committed original tasks to the retained
observation, product, download-lease and terminal-delivery components. It does
not connect admission, input preparation, engine commit, queue polling or the
default worker. It adds no migration or production setting.

## Original selection and recovery

A saved terminal command takes precedence over another engine observation.
Before the command exists, recovery reads the selected observation from the
earliest output-intake plan and later original plans, manifest, lease or terminal
context. Their original engine, limits and application bindings must agree.
Output records require reported completion. Terminal context requires a reported
terminal state. Conflicting selections and canonical orphan receipts are refused
before another engine GET. Valid unpublished temporary files remain recoverable.

For a new unselected task, the supplied observer reads one original response.
Completed observations advance the original product stages and create or resume
the original lease. Failed or canceled observations skip product preparation.
Running observations remain pending. The coordinator uses the existing terminal
journal to prepare and deliver the exact original callback.

## Local failures

Local stage failures retain their original reported engine facts in a separate
private record. A product, authority or transport failure cannot turn reported
completion into a fabricated engine failure or terminal callback. Records bind
the original installation, target, request, actor, dispatch and started context.
They retain the stage and error class, without raw exception messages. Equal
replays keep the original record; successful recovery preserves prior failures.
Loss of worker ownership prevents further private publication.

## Current checks

Four 34-case cohorts pass on each of Python 3.14 and Python 3.11. Each interpreter
detects 35 intended faults. The harness restores original bytes in `finally`,
checks the expected test and diagnostic, and challenges its result classifier.
The tests include new lease creation, actual supplied observation transport,
pre-command interruption, partial manifest/lease recovery, incompatible producer
states, orphan records, exact callback replay and current authority refusal.
Application authority and receiver responses in these source tests are fixtures.

Independent read-only review identified and prompted the saved-selection,
producer-state and orphan-record corrections. Earlier 14-case and 27-case proofs
remain historical. Failed trials include incorrectly encoded or non-private
fixture files and a malformed temporary filename; none counts as acceptance.

Native coordination against the isolated restored415 database passes four
two-case cohorts and two SQL faults. It uses the copied original output,
actual PostgREST authority, a supervised callback socket and the explicit
download handler. Lost acknowledgement recovers through the exact original
callback body; a revoked actor sends no second callback and receives no product.
The original local failure record remains intact after successful recovery.
Its callback fixture writes the callback ledger directly, so it cannot establish application receiver-route
acceptance. The 19 nested documentation, direction and release-order checks pass. Fresh
branch CI and complete input/commit/default integration remain required.

## Limits and next work

Existing components keep their own finite stage limits. This candidate does not
establish a hard whole-coordination deadline. Native source/RLS, callback transport,
private record recovery, application receiver behavior, publication and human
acceptance protect different boundaries.

No public TLS, hosted/default operation, planner browser journey, photogrammetry
quality, map placement, practitioner, independent-host or V1 acceptance follows
from these checks. Continue the original input/commit/progress connection and
the complete callback/Storage recovery journey before default activation.
