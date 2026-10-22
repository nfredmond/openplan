# Refuse a reply that ends before its declared bytes arrive

The original draft transport accepts a valid JSON prefix from an incomplete
HTTP response. A real local server advertises 64 bytes, sends a complete 47-byte
UUID JSON object and closes. The unchanged transport returns HTTP 200 and those
47 bytes. A valid object does not establish a complete HTTP message.

Two new regression cases fail on that source with their intended assertion,
`RuntimeError not raised`. The cases cover a valid JSON prefix and an empty
prefix when declared bytes remain. The child now checks the remaining declared
length after its bounded read. It refuses an incomplete reply before publishing
the status/body envelope. The original intent remains unresolved; this does not
prove that the remote engine discarded a request or permit a retry.

The fix preserves a complete close-delimited reply and a complete zero-length
reply. Framing completeness is separate from whether the API body acknowledges
an operation. Byte limits, deadlines, cancellation, parent-lifetime supervision,
credentials, engine binding and original init/upload command restrictions stay
in place. No processing commit, new endpoint or default is added.

Python 3.14 and 3.11 each pass all 35 HTTP tests in four positive cohorts. Six
targeted faults reach their intended failures: removing the check, accepting
unread bytes, rejecting a legal close delimiter, rejecting an empty complete
frame, dropping the short-frame fixture and losing actual request observations.
Twenty-four diagnostic controls per interpreter reject the wrong exit, test or
failure reason. Both production and fixture sources restore in `finally`.
The units stop with peaks of 67,768,320 and 68,247,552 bytes under 256 MiB,
with zero maximum/OOM events and zero swap.

[Legacy observation](evidence/legacy-observation.json),
[legacy regression](evidence/legacy-regression.json),
[3.14 controls](evidence/controls314.json),
[3.11 controls](evidence/controls311.json),
[3.14 diagnostics](evidence/oracles314.json),
[3.11 diagnostics](evidence/oracles311.json),
[restored source](evidence/source-bindings.json),
[3.14 resources](evidence/resources314.json) and
[3.11 resources](evidence/resources311.json) retain the result.

This is actual local HTTP and owned-child evidence. It does not establish every
proxy/framing variant, public DNS/TLS, current application authority, original
engine identity, whole-worker recovery or processing quality. Current main join,
complete worker recipe, native compatibility and exact-head GitHub checks remain
pending. Full M3/M5b.2, practitioner/scientific acceptance and v1 remain open.
No hosted, database, activation or release change accompanies this checkpoint.
Raw logs remain in the private `odm-reply-framing-20261013` proof directory.

## Current-main join and complete recipe

Main CLI merge `61b568d11ce2f49c335319f1d5f43d34a43e193b` joins this
checkout. The first actual 34-stage recipe fails at stage 18. Its existing census
requires a targeted control for each HTTP test and correctly identifies the four
new cases. That guard stays in place. Four targeted entries are added to the
existing controller; its 35-test census now passes four positive cohorts and
47 targeted faults. The failed first recipe remains recorded.

The corrected actual recipe passes all 34 stages, 646 cases in 26 worker suites,
20 app/documentation cases, product direction and the existing pointer controls.
All 61 worker/workflow bindings match after restoration. Its unit stops with a
928,677,888-byte peak under 1 GiB, zero maximum/OOM events and zero swap.
These checks do not establish browser, public DNS/TLS or full installation scope.

Native compatibility uses the existing retained migration-03 RPC fixture and a
real owned engine. It passes 16 RPC cases, three distinct draft tasks, six uploads,
12 predicates and 39 classifiers. Normal init/upload replies pass the new guard;
revocation and changed-engine refusals remain. A separate Python 3.11 native
cohort passes. All owned engine/RPC services stop. The controllers peak at
64,073,728 and 59,060,224 bytes under 1 GiB, with zero maximum/OOM events and
zero swap. Their engine and database service caps remain separate. This fixture
is not a fresh current-main or hosted database. No imagery decoding or processing
commit occurs. Native compatibility does not establish complete recovery.

[Full recipe](evidence/workflow-results.json),
[stage names](evidence/workflow-steps.json),
[restored bindings](evidence/workflow-bindings.json),
[resources](evidence/workflow-resources.json),
[35-test control summary](evidence/complete-http-control-summary.json) and
[failed first stages](evidence/failed-workflow-stage-results.json) retain the run.
[Native predicates](evidence/native-results.json),
[native classifiers](evidence/native-classifiers.json),
[native bindings](evidence/native-bindings.json),
[native controller](evidence/native-resources.json),
[3.11 predicates](evidence/native311-results.json) and
[3.11 controller](evidence/native311-resources.json) retain compatibility.
[Engine stop](evidence/native-engine-stopped.json),
[RPC stops](evidence/native-rpc-stopped.json),
[3.11 engine stop](evidence/native311-engine-stopped.json) and
[3.11 RPC stops](evidence/native311-rpc-stopped.json) record cleanup.
New-head CI and exact production verification remain separate.

The new index pointer passes six documentation cases in baseline, harmless and
restored cohorts. Its changed target fails the named link-resolution assertion.
[Pointer controls](evidence/pointer-controls.json) and
[pointer resources](evidence/pointer-resources.json) retain exact restoration.
The pointer unit stops at 220,659,712 bytes under 1 GiB, with zero maximum/OOM
events and zero swap. [Complete HTTP control bindings](evidence/complete-http-control-bindings.json)
and [47 targeted outcomes](evidence/complete-http-controls.json) retain the
updated census. Report link checks do not establish report semantics or a rendered
workflow. The earlier failed recipe and initial legacy behavior remain visible.

## CI correction: observe a reset as actual peer closure

Exact-head aerial CI38404499525 fails in the existing composed cancellation
fixture. Its peer `recv` raises `ConnectionResetError` after the child ends;
the EOF-only observer throws before setting its closure event. The request is
already at the stalled body boundary. This is an observed fixture error, not
proof that cancellation left the connection open. The failed run remains.

The test observer now accepts EOF or a connection reset. Four real TCP cases
observe FIN, forced reset, available bytes and an idle timeout. The reset case
records the actual socket exception through a passive wrapper. Received bytes
do not count as closure; other I/O errors still propagate. Cancellation deadlines,
peer-wait bounds and production transport bytes stay unchanged.

The existing composed-control census adds a targeted behavior for each new case.
Six tests pass in four positive cohorts, with six targeted faults per interpreter.
Python 3.14 and 3.11 pass. Both fixture and runtime sources restore in `finally`.
The unit stops at 56,606,720 bytes under 256 MiB, with zero maximum/OOM events
and zero swap. No additional transport command or API acceptance follows.

[Failed CI summary](evidence/failed-ci-peer-reset.json),
[3.14 peer controls](evidence/peer-controls314.json),
[3.11 peer controls](evidence/peer-controls311.json),
[peer bindings](evidence/peer-bindings.json) and
[peer resources](evidence/peer-resources.json) retain this correction.
The earlier 646-case recipe keeps its original source boundary. The corrected
complete recipe and new-head CI remain required.

The corrected fixture joins main evidence merge
`af3effe22d449716951f36610d4ef9e4b2eda8d2` without changing the production
framing guard or deadlines. The actual 34-stage recipe then passes 650 cases
across 26 worker suites, 20 app/documentation cases, direction and pointer
controls. All 61 worker/workflow bindings restore exactly. The unit stops at
904,409,088 bytes under 1 GiB, with zero maximum/OOM events and zero swap.
[Corrected summary](evidence/reset-corrected-summary.json),
[corrected recipe](evidence/reset-corrected-workflow-results.json),
[worker bindings](evidence/reset-corrected-workflow-bindings.json),
[composed controls](evidence/reset-corrected-composed-controls.json),
[composed bindings](evidence/reset-corrected-composed-bindings.json) and
[resources](evidence/reset-corrected-workflow-resources.json) retain the run.
This is a new local checkpoint. It does not turn the failed4505 CI run green;
the corrected head requires its own GitHub checks.
