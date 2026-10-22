# Stop original aerial source downloads with their owner

This isolated M3 and M5b.2 candidate adds `url_transport.py`, an explicit callable
for retained URL source custody. It supervises actual source GETs without
changing the legacy fetcher, deployed defaults, routes, public schemas or
migrations. It sends no engine command, processing commit or callback.
Main merges stay held for the relaunch coordinator's dated lift.

## URL policy and exact bytes

The caller declares allowed ports and any installation-approved address ranges.
Defaults permit public unicast addresses on ports 80 and 443. Every URL rejects
credentials, fragments, control characters, unsupported schemes and unapproved
ports before DNS. Every resolved address must pass policy. The connection uses
a validated address without another lookup and preserves the original Host
header and TLS hostname checks. Translated IPv4 aliases and multicast refuse.
This configuration is not live application authority or installation attestation.

Redirects have a ceiling of five hops, repeat all checks and refuse HTTPS
downgrade. Redirect cleanup closes without waiting for a stalled body. The
transport sends neither authorization headers nor cookies and inherits no HTTP
proxy behavior. Signed URL values travel through private pipes and retained
private plans; diagnostics do not reproduce them.

An owned child performs blocking DNS, connection, TLS and response reading.
The parent checks deadline and explicit cancellation while delivering bounded
frames to the existing counted writer. A separate lifetime pipe ends the child
after abrupt owner exit. Cleanup awaits only that child. Actual received bytes
stay within the limit, and the final child count and hash must match delivered
bytes. Incomplete, encoded, ambiguous or unsuccessful responses refuse. Source
receipts still require the existing independent durable local validation.

Only the first validated DNS address is connected. This candidate does not
establish address failover or arbitrary local filesystem stall recovery. A source
caller must supply its actual cancellation signal; an unrelated callback is not
worker ownership fencing.

## Controls that exposed test weaknesses

The first [controller](verify_controls.py) catches a surviving downgrade mutation.
The redirected plain HTTP request hits a TLS-only listener and fails for an
unrelated reason. A separate available plain HTTP listener now makes the removed
downgrade guard observable. An available unapproved redirect listener similarly
prevents connection refusal from masking the address policy.

A second mutation removes explicit child stop but survives because closing the
independent lifetime pipe still ends that child. The tests now separately check
that cleanup awaits the child. A variant omitting both stop signals actually
allows a late DNS request and fails at that assertion. These trials remain
retained and are not reported as passing controls.

The failure oracle checks every actual error block against its declared reasons,
including explicitly named independent fallback refusals. Its
[eight controls](evidence/failure-oracle-controls.json) use an actual failing run,
a harmless note and restored copy, then wrong exit/test/reason, missing error
block and an extra unrelated failure. This prevents one matching subtest from
masking an unexpected second failure. `diagnostic_refusal` cases do not establish
effectiveness of the removed guard itself.

All 33 tests pass [59 source controls](evidence/source-controls.json), with four
positive runs and 55 targeted variants. [Bindings](evidence/source-bindings.json)
match restored source. The same [33 tests and 59 controls on Python 3.11.15](evidence/python311-controls.json)
pass with [matching bindings](evidence/python311-source-bindings.json).
Actual local HTTP/TLS, DNS cancellation, header/body interruption, pinned sockets,
redirects, child reaping, parent death, exact framing and source/preparation
composition are distinct from supplied-child framing probes.

The local TLS fixtures use freshly generated synthetic certificates. They check
explicit trust, untrusted certificates, wrong hostname and an available downgrade
target. They do not establish public certificate, DNS or hosted acceptance.
Source cancellation leaves the original plan and unaccepted object, with no
complete receipt or source-set manifest. Complete receipts prevent another GET.

## Actual process interruption and restored source intake

The [native runner](native_recovery.py) performs actual loopback downloads. After
the first complete receipt, a fixture wrapper flushes and synchronizes nine bytes
of the second response and exits its owner with status 19. This selects the crash
boundary; it does not change production writes. The original HTTP child exits
97 through its lifetime watcher, is reaped by the owned harness and closes the
actual peer. The selected child PID and start time bound cleanup.

The existing CLI captures and verifies the stopped runtime and separate source
root. Fresh restored copies keep the first receipt and original partial orphan.
Only the unfinished second URL downloads. The first URL would now return changed
bytes, so retained replay must avoid it. Actual preparation copies the original
complete bytes, engine permission stays false and no engine intent exists.

The [native result](evidence/native-summary.json) passes 28 observations,
[87 observation controls](evidence/native-controls.json) and
[14 durable-root comparison controls](evidence/root-comparison-controls.json).
[Native bindings](evidence/native-source-bindings.json) remain unchanged. Original
durable assets and packages stay unchanged; documented reader-created empty WAL
and transient SHM are checked through the existing stable-source comparator.
This is two selected root packages, not an installation-wide atomic recovery cut
or power-loss proof.

## Integration and remaining boundaries

All [20 aerial suites](evidence/worker-suite-census.json) run through actual CI's
discovery loop, with [five discovery/fail-fast controls](evidence/ci-discovery-controls.json).
The [two new YAML commands](evidence/actual-ci-steps.json) repeat source controls
and actual interrupted network recovery. GitHub checks for the committed head
remain separate from these local commands.

[Owned resource records](evidence/resources.json) retain exits, measured memory
peaks and stopped services. Python work uses a 256 MiB limit, no swap and one CPU.
Private failed trials and selected roots remain under
`~/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-url-transport-20261011/`.
These measurements are not largest-source, image-processing or whole-worker
capacity acceptance. The [14 nested documentation tests](evidence/documentation-checks.json)
and [direction check](evidence/documentation-results.json) run from the actual
`openplan/` package, preserving existing direction reminders.

These are implementation-owner checks by GPT-6.1 Sol at high reasoning. They
are not independent review, public network commissioning or practicing-planner
acceptance. Synthetic bytes do not prove image decoding, reconstruction or
scientific accuracy. Live application authority, trusted dispatch/context and
engine attestation, processing/results/callbacks, installation-wide recovery,
browser journeys and full worker acceptance remain open. M3, M5b.2 and v1 stay
unfinished.
