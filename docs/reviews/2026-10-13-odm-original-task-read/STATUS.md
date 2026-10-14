# Original aerial task reads and retained replies

The candidate connects one original task GET to the existing private metadata
ledger. It reads the engine and UUID from the complete original plan, requires
explicit ownership and engine-check adapters, resolves the original credential
reference, and sends credentials through the owned child pipe. It refuses
redirects, incomplete frames, encoded replies and excessive declared/body bytes.
Cancellation, ownership loss and parent loss stop the child. It issues no engine
write, processing commit, task retry or callback.

`Transport.retain` composes the read with `Observations.record`. The separate
ledger preserves exact reply bytes and their hash. A different original plan,
a rejected final engine check or mismatched task metadata refuses the record.
The retained interpretation keeps its existing unassessed claim fields and denied
publication permission. A live read does not make a saved reply current later.

## Current local checks

The source controller exercises 23 actual loopback/child cases, including exact
GET/credential encoding, preflight refusals, interrupted connections, abrupt
parent loss, output bounds, frame limits and retained reply reopening. Four
positive cohorts survive. All 29 targeted variants fail their named assertions
or error boundaries, and the source restores in `finally`. The strengthened
failure classifier also rejects wrong cases, diagnostics, kinds and success exits.
Final Python 3.14 and 3.11 checks pass. Each interpreter records four positive
cohorts, 29 targeted faults and 174 failure-oracle controls. [The retained source
controls](evidence/controls314-final-controls.json) and [failure-oracle controls](evidence/controls314-final-oracle-controls.json)
retain their actual outcomes.

The first native continuation passes against the pinned isolated NodeODM image.
It reads a committed task with three deliberately invalid ordinary inputs. The
engine reports failure, which remains failure. The supported native attestor
checks the original live container before and after the GET. The private reply
then survives selected-root capture and a relocated read after the engine stops.
This does not establish successful image decoding or processing quality.
Thirteen targeted native observation faults and four positive cohorts pass on
each interpreter. Each actual successful read launches one owned GET child and
two native-attestor children. [The native controls](evidence/native314-final-controls.json),
[final original read](evidence/native314-final-results.json) and [Python 3.11 read](evidence/native311-final-results.json)
retain those outcomes. All 52 owned engine producers from the initial and final
checks are inspected stopped, with OOMKilled false and 512 MiB limits.

[The serial check service](evidence/final-checks-resources.json) peaks at
88,764,416 bytes under its 256 MiB limit. Swap, max, OOM and OOM-kill counters
remain zero. The unit stops successfully. The [actual 35-stage aerial workflow](evidence/workflow-results.json) passes
34 worker scripts: 673 unittest cases in 27 suites plus seven custom check scripts.
All 63 worker/workflow source bindings remain exact after restoration. The
scoped application/documentation suite passes 20 cases from the nested app
directory, and product direction passes. [The new index pointer controls](evidence/workflow-pointer-controls.json)
pass baseline, harmless and restored reads, while the missing target fails the
named link assertion. [The full workflow service](evidence/workflow-resources.json)
peaks at 902,152,192 bytes under 1 GiB, with zero max/OOM events or swap. It stops
successfully.

The initial source control attempts remain in the private proof directory.
One expected diagnostic was incorrect because the final engine check still
refused the reply after the missing initial check. The actual network observation
catches that defect. A later size-limit variant survives the first test because
the body bound also rejects it. The corrected fixture advertises excessive bytes
and stalls before the body; the intended header refusal now fails when removed.
Neither failure is discarded or reported as a passing attempt.

## Calling the existing metadata service

Import `original_task_http.Transport` beside `retained_task_observation.Observations`.
Construct the transport with the original plan, a credential-reference resolver
and an engine-check callback. Call `retain(store, deadline=monotonic_deadline,
owned=ownership_callback)`. The engine callback receives the original engine and
shared deadline and must return exactly `True`. Use the existing native `Attestor`
for its supported Linux container profile. The caller owns current application
permission and the worker's lifetime; a callback that simply returns true does
not establish either fact.

The current local metadata CLI continues to record supplied files and read saved
digests. It does not silently gain network access. Normal worker polling and
processing remain unconnected to this adapter. Those joins require their own
live authority, original-task reconciliation and recovery evidence.

## Evidence limits and next boundary

The local transport fixture cannot establish public DNS/TLS operation, arbitrary
external engine identity, practitioner usefulness, imagery accuracy, callback
custody, useful long computation or whole-installation recovery. The native
producer reuses the older retained isolated RPC fixture's internal network. It
starts new owned engine containers, records their identities and stops them;
it does not turn that older fixture into current-main or hosted database proof.
Arbitrary supplied credential/engine adapters must honor their own deadline;
the transport cannot forcibly interrupt Python code inside those adapters.
Ownership is cooperative and is not a writer fence against the same operating
system account.

No schema, default activation, hosted setting or release tag changes. Continue
original task reconciliation, processing/result/callback custody and the remaining
M3 installation, capacity, separate-host and browser work. Full v1 remains open.

The contributor guide now points to the hosted cutover record instead of its
obsolete hosted-deferral sentence. Independent local releases still require no
paid infrastructure. Exact-head GitHub checks and a production turn remain
separate from these local results.
