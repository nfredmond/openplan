# Live-ownership attempt coordinator checkpoint

The coordinator now connects the private attempt journal to claim, attempt-read,
renewal and durable mutation calls. It reuses the saved token, compares the
permanent claim returned by the two reads, and checks both current ownership
flags. An unavailable claim does not allocate a replacement token. Ready, failed
and cancelled snapshots are returned as observed history without processing,
renewal or adoption.

Before processing, the coordinator confirms a live renewal. The callback receives
the checked snapshot, an ownership-loss signal and a guarded delivery function.
Periodic renewal runs outside the parser process; parser computation must still
use the existing child supervisor so it does not block the renewal event loop.
False, malformed or unavailable renewal replies abort processing. A callback
exception does not invent a failure command.

The callback returns an explicit completion or failure request. The coordinator
clones that request, refuses unsettled work writes, closes the processing phase,
stops and joins renewal, and confirms a final renewal before terminal delivery.
Work callbacks cannot use the reserved terminal slot or send completion, failure
or adoption through their ordinary delivery method. An in-flight renewal cannot
outlive terminal delivery and incorrectly interpret the closed job as lost work.

Claim and renewal calls retain the candidate SQL's 120-second default and the
service's ten-second acknowledgement bound. Renewal defaults to 30 seconds and
accepts configured intervals up to 60 seconds. These controls do not establish
large-feed tract runtime or safe budgets for all installations.

## Verification and scope

The suite passes 29 tests using the installed Supabase SDK, controlled fetch
responses, actual private journal files and process locks. It checks exact claim,
read, initial-renewal, work, final-renewal and terminal ordering; explicit
completion and failure; unavailable and inactive claims; terminal history;
changed claim evidence; false, malformed and lost renewal replies; in-flight
renewal coordination; unfinished writes; phase and terminal bypass; immutable
terminal input; exceptions; exact terminal retry; and renewal interval bounds.

[The control record](worker-attempt-controls.json) contains 19 runs. Baseline,
harmless comment and restored source pass. Sixteen targeted variants fail
assertions. The initial and final renewal mutations use the exact call-order
test; the other variants run the full suite. An initial full-suite mutation run
timed out after removal of the initial renewal changed later race tests' timing
assumptions. The runner did not classify that timeout as a passing failure
control. No test process remained at the subsequent process inventory. The final
record names its two test filters and identifies source and test hashes.

Scoped TypeScript with the installed Node and Next declarations, ESLint and diff
checks pass. This is controlled SDK transport evidence, not a live PostgreSQL or
HTTP worker journey. The candidate migration remains unchanged and uninstalled
outside rollback proofs. No full branch CI or browser acceptance is claimed.

## Remaining worker connection

The coordinator does not poll the queue or enroll an import route. It still needs
retained-terminal inspection so an unresolved final request can be delivered
directly, without invoking the processing callback again to reconstruct its
inputs. The current exact journal rejects any reconstructed payload change. A
live terminal observation is returned separately from local acknowledgement and
does not silently mark an unresolved journal command resolved.

Then connect actual retained-archive and parser artifacts, ordered row mapping,
terminal handling and ordinary adoption. A completed import observed after
restart needs the original parser counts or a scoped native count projection for
adoption; derived service-row totals are not distinct route and stop counts.
Queue polling must distinguish a retained inactive attempt from a deliberately
allocated replacement attempt. Live HTTP/database recovery, promotion lock
ordering, concurrency, Storage writes after cancellation, operation budgets,
populated upgrade/restore and T3 desktop/390px evidence remain unfinished.
No resumable-import, scientific or v1 acceptance claim is made.
