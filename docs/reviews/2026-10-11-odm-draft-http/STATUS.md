# Stop original aerial HTTP work when its owner ends

This isolated M3 candidate adds `workers/odm_worker/draft_http.py`. The actual
owned admission runtime and original draft bridge can use it for one original
initialization or image upload. It sends no processing commit or callback.
Deployed defaults, application routes and public request schemas stay unchanged.
Main merges remain held for the relaunch coordinator's dated lift.

## Exact requests and bounded ownership

The transport checks the configured original engine identity and command before
resolving its credential reference. Credentials stay outside saved plans and
failure diagnostics. A child performs blocking DNS, connection, TLS, transmission
and response reading. The parent streams source bytes through a bounded pipe,
checks cancellation and deadline, and kills and reaps its own child on refusal.
A separate lifetime pipe stops that child after abrupt parent exit. It does not
interpret image EOF as the end of ownership.

Initialization uses multipart fields and the original `set-uuid` header. Upload
uses the original filename and bytes. The child checks their hash before sending
the multipart footer. Metadata, stdout, stderr and response bodies have separate
bounds. Status and response body bytes return unchanged to the existing command
journal. The transport does not follow redirects, inherit HTTP proxies or retry.

Stopping a request does not prove the engine discarded received bytes. An issued
command without a saved accepted response remains unresolved. Restoring that
worker must hold the original command rather than upload it again. A complete
draft still leaves processing commit unissued.

## Controls and a native defect

The [source controller](verify_controls.py) exercises every HTTP test with a
harmless comment, deliberately broken behavior and exact restoration in `finally`.
The current tests check actual loopback requests, cancellation during response
reading and partial transmission, stalled DNS, abrupt owner exit, child reaping,
original credentials and form fields, malformed streams, metadata and reply
bounds, duplicate reply keys, and the actual runtime bridge. Adapter-only stop
checks are distinct from actual process and socket checks.

Early trials fail before acceptance. The first controller has invalid Python
quoting. Subsequent trials expose mismatched diagnostics for credential lookup,
multiple failing subtests and the independent engine reply guard. Tests now
observe credential calls rather than raise a sentinel that the credential
sanitizer can catch. The controller reads actual error blocks and labels
independent fallback refusals separately. None of these corrections weakens a
production guard. Failed private logs remain retained.

The first native attempt cannot allocate a Docker subnet because its automatic
address pools are exhausted. The next attempt shows that Docker does not publish
a port for this internal network. The runner therefore uses an explicitly
checked nonoverlapping subnet and direct private engine addresses, with no host
port publication. It does not remove another session's networks.

The following native run finds a transport defect. NodeODM accepts initialization
and returns the original UUID, but captures `{}` because it does not parse the
URL-encoded form. Captured-root inspection rejects the missing original metadata.
The transport now sends multipart initialization fields. The loopback test parses
the actual multipart body and requires the original name and options. Targeted
controls alter those fields or remove the multipart media type. The failed engine
root and stopped container remain retained. A UUID reply alone is insufficient.

## Current proof

All 31 tests pass [47 source controls](evidence/source-controls.json): four positive
runs and 43 targeted failures. The [source bindings](evidence/source-bindings.json)
match the restored candidate. The same 31 tests/[47 controls](evidence/python311-controls.json)
pass on Python 3.11.15, with [matching bindings](evidence/python311-source-bindings.json).
Python 3.11 controls peak at 81,047,552 bytes under 256 MiB, exit zero and stop.
Deadline or journal fallback refusals carry the
separate `diagnostic_refusal` label. These controls do not claim those fallback
paths prove the removed guard itself remains effective.

The [native result](evidence/native-summary.json) passes 28 required observations,
[87 observation controls](evidence/native-controls.json) and
[14 response controls](evidence/native-response-controls.json). It runs five
original requests across two fresh pinned NodeODM 2.2.4 instances. Captured engine
and worker roots verify original metadata, exact bytes, partial or complete
custody, relocated worker recovery and no uncertain reissue. Every owned HTTP
child and engine stops. Engines use an owned internal Docker network, no published
ports, read-only filesystems and a 512 MiB memory and swap cap, with one CPU.
This is a configured engine limit, not measured processing capacity.

[Actual native regression controls](evidence/native-regression-controls.json)
repeat a harmless and restored run, then reproduce empty captured metadata with
the old URL-encoded initialization. The oracle checks both the exact inspection
failure and the engine's captured `{}`. The controller restores original source
bytes in `finally`. This is an actual engine regression check, not a mocked
metadata response. Current [native bindings](evidence/native-source-bindings.json)
and [regression bindings](evidence/native-regression-source-bindings.json) match.

All [18 aerial suites](evidence/worker-suite-census.json) pass through the actual
YAML discovery loop. Its [five controls](evidence/ci-discovery-controls.json)
include a discovered harmless suite, a failing suite and removed fail-fast
behavior. The [new actual CI step](evidence/actual-ci-steps.json) repeats all 47
HTTP controls. GitHub exact-head checks remain separate from these local commands.

[Owned service measurements](evidence/resources.json) record zero exits and
stopped services. Source controls peak at 66,007,040 bytes, native proof at
50,458,624, actual CI at 86,269,952 and native regression controls at 60,760,064.
Each Python service uses a 256 MiB cap, no swap and one CPU. The private proof base
is `~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-draft-http-20261011/`.
It retains initial failed trials, owned stopped engines and captured roots.

All [14 nested documentation tests](evidence/documentation-checks.json) and the
[product direction check](evidence/documentation-results.json) pass from the actual
`openplan/` package. Existing direction reminders stay visible. Documentation
peaks at 341,307,392 bytes under its 1 GiB cap, exits zero and stops. This remains
an isolated unmerged candidate; no public release or full worker acceptance
follows. GitHub CI for the committed candidate is checked separately.

## Unresolved earlier CI diagnosis

The parent PR227 first fails GitHub run `38185163712` at head `e60aeaff4` in the
older engine controller's restored positive suite. The controller hides its
stderr. Diagnostic-only head `04421a6b6` exposes future failures and passes its
separate ODM check. That success does not establish the original cause or prove
a production correction.

Locally, [100 complete 25-test suite repetitions](evidence/parent-engine-ci-full-suite-repeats.json)
and [1,000 actual concurrent-call repetitions](evidence/parent-engine-ci-concurrency-repeats.json)
pass without reproducing the failure. All 44 older engine controls also pass on
Python 3.11 and 3.14. Local 3.11.15 differs from GitHub's 3.11.17. The original
cause remains unproved. No production guard changes follow from that failure.
Private investigation logs remain in the sibling `odm-engine-ci-failure-20261011/`
proof folder. This candidate does not relabel the first GitHub failure as green.

## Evidence limits

These are implementation-owner checks by GPT-6.1 Sol at high reasoning. They are
not an independent review or practicing-planner acceptance. A supplied permission
callback is not live application authority, and a supplied engine identity is
not a live installation attestation. Credential lookup runs in the parent and
requires a prompt trusted adapter; blocking credential resolution is not proved
interruptible. Ordinary local source reads also do not establish arbitrary
filesystem stall recovery.

Controlled local DNS and sockets do not prove public DNS, TLS or hosted transport
acceptance. Synthetic ordinary bytes do not prove image decoding, reconstruction,
maximum-job capacity or scientific accuracy. Processing commit, terminal results,
callback delivery, trusted application context and URL source intake remain open.
No browser, native desktop or 390px journey is claimed by this worker change.
The old native fixture intentionally omits an observed reply from the journal;
that is not actual network loss. Complete worker recovery remains unaccepted.
