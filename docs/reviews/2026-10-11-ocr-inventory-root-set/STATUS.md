# OCR configuration and root-set continuation, October 11

This isolated M3 proof joins the existing explicit configuration inventory,
selected-root set and native OCR saved-result recovery. It changes no operator,
worker runtime, schema, hosted configuration or application interface. Base
commit is `1e941f5c296fc9abe3543ee7bf42f914bcd1e636`, above PR210. The relaunch
owner retains hosted coordination and the main merge hold.

## Current executed proof

[The design](DESIGN.md) and [native integration driver](native_integration.py)
use only the retained synthetic text-layer job from
[the earlier native OCR proof](../2026-10-11-ocr-worker-recovery/STATUS.md).
The original extraction and first successful callback are prior evidence.
This run performs one new continuation, without another extraction or source
download. It does not repeat the original recognition stage.

The private profile declares one configured OCR fixture with one local root and
one synthetic environment file. All other 14 known families remain unassessed.
The configuration is a selected fixture recipe, not a complete captured process
environment, a discovered installation or the hosted OCR configuration.

The actual inventory CLI retains exact configuration/profile bytes and source
catalogue, then verifies its package. The actual root-set CLI captures and
verifies the selected OCR root. Independent comparisons cover every ordinary
byte, directory and private mode, plus complete SQLite schemas and logical rows.
Recognized SQLite layout and transient WAL/SHM differences remain distinct from
ordinary byte identity. The selected root and both new packages stay unchanged.
The earlier immutable single-root package also stays unchanged.

An owned consumer binds the original retained loopback callback address. If that
port has another occupant, the driver refuses rather than changing saved URLs,
killing its occupant or substituting a host. The consumer starts with the exact
retained original successful callback. Its measured, persisted ledger retains
one callback ID/hash before acknowledgment. It is a synthetic seeded consumer,
not the live OpenPlan Documents callback or a cross-process application database.

A fresh root-set runtime starts unchanged `main.main()` using the retained
loopback wrapper. Dispatch and proxies are disabled. The source endpoint returns
410, and native `pdfinfo`/`pdftotext` probes refuse any extraction reentry. One
new native delivery matches the original callback bytes, pages, blank middle
page, request and job identity. There are zero new source requests and no probe
execution. The copied journal reaches `succeeded`; original admission replay
returns 200 with its original receipt and a changed request receives 409.

## Controls and resource accounting

[Thirty-three observation controls](evidence/observation-controls.json) repeat
the earlier independent oracle on these newly measured observations: three
positive and 30 targeted broken cases. They alter observations, not worker code.

[Twelve integration controls](evidence/integration-controls.json) include six
positive outcomes and six intended refusals. A harmless manifest key-order
change and a copied inventory verify. Changing configuration/profile bytes fails
both the independent exact-byte comparison and inventory CLI. Removing selection
or corrupting the retained PDF fails root-set verification. A changed same-ID
callback body receives 409; a wrong bearer receives 403. All mutations target
disposable copies and restore in finally. Restored packages verify again.

[Eight loopback-policy controls](evidence/callback-policy-controls.json) include
two survivors and six intended refusals for foreign host, wrong scheme/path,
absent port, zero port and out-of-range port. These call the preflight policy
without network work. Together, all 53 controls pass: 11 positive outcomes and
42 intended refusals. This does not prove each underlying runtime branch.

[The current native result](evidence/native-result.json) records 1.089 seconds
for the driver, 0.715 seconds CPU and 35,713,024 bytes peak memory under a 512 MiB
cap, zero swap, one CPU and 128 tasks. Invocation
`af9af6a9a1a24b67a361659c109ee3fa` exits zero. The service is stopped.
[Cleanup evidence](evidence/cleanup.json) records the owned child exit and closed
listener. [All 39 executed-source bindings](evidence/executed-source-hashes.json)
remain unchanged. Python parsing and changed-file whitespace checks pass.
The unchanged six OCR test scripts passed at the prior checkpoint; this proof
does not relabel them as new runtime coverage. Exact-head GitHub CI remains a
separate check.

## Preserved trials and limits

`native-01` completes the operator and continuation path but reports a fixed
expected logical-result count. Review finds that weakness, so it is superseded
and is not accepted as measured deduplication evidence. `native-02` reads the
persisted ledger and passes its smaller control set. `native-03` is current and
adds the configuration and loopback-policy controls. All three executed source
copies, receipts and logs remain retained; none is silently relabeled current.

Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/ocr-inventory-root-set-20261011/`.
It retains exact synthetic profile/configuration, catalogue, inventory package,
root-set package, fresh runtime, disposable controls, ledger, callback bytes,
source bindings, logs and service properties. Private payloads are not published.

This proves a selected synthetic fixture path. It does not establish all installed
workers, a live database/Storage cut, scanned OCR quality, OpenPlan Documents/RLS,
useful 45-minute work, separate hardware, independent commissioning, browser or
public readiness. No geographic, scientific or practitioner requirement changes.
M3 and the complete v1 floor remain open; the roadmap remains the only queue.
