# Commands are prepared text, not execution authorization

Every command below is UNRUN. Root must first fill the pending fields, review
exact source, publish a finite request and issue its explicit grant. No current
window is requested. Use NEW private working copies and outputs, never old packet
paths. The commands supply no allocation, transport, SDK, manager or lock runner.

## Input shapes

Emitter allocation input has sourceCommit/appTree, target.clusterSystemId,
target.databaseName, positive integer target.databaseOid,
target.allocationReceiptSha256, target.exclusiveSynthetic=true and canonical
workspaceA/workspaceB/writer UUIDs. Use the exact source pins in
admission.pending.json, but its pending target values must refuse. A harmless
supplied allocation for a later TEXT-only grant must carry a separate unmistakable
NONNATIVE label. It cannot authorize a target or be promoted to native evidence.

The independent seed/rows/lines context contains case, workspaceA and workspaceB.
For scalar context use case, workspaceId, workspaceLabel (`A` or `B`), engagementId
(null for workspace scope, otherwise the literal engagement UUID), and
excludeInvoiceId (null or the first primary invoice UUID). Actual recorder must
bind workspaceLabel to the exact admitted UUID and actor. The scalar comparator
cannot authenticate that label by itself. Context carries no credentials.

The root-reviewed oracle is oracles.json. Source codes and pending JSON remain
unparsed in this preparation. A later grant must pin the exact final bytes and
interpreter, not assume syntax or behavior acceptance from this document.

## One finite emitter and text readback, after a pure grant only

Commands below use symbolic paths. They are not a runnable controller:

```text
python3 -B NEW_PRIVATE_COPY/emit_fixture.py --allocation ROOT_REVIEWED_INPUT --case ordinary501 --out NEW_ORDINARY_OUTPUT
python3 -B NEW_PRIVATE_COPY/readback.py --mode seed --raw NEW_ORDINARY_OUTPUT/seed.sql --oracle PINNED_ORACLES --context ORDINARY_AB_CONTEXT
```

Repeat exactly once for maximum90 and maximum1001 only if the same explicit
finite grant names those cases. Do not dispatch SQL. The new output directory
must be absent. Native target identity remains external to a text comparison.
Use CONTROLS for harmless survivors, named faults and restoration, only when
root's request includes them. No automatic retry after syntax or harness failure.

## Read already captured native bytes, after a separate grant

The actual target/helper recorder is not implemented here. It must bind source,
cluster/DB, actor/JWT custody, request arguments, timestamps, committed fixture,
HTTP status/content type, safe headers, raw decompressed bytes, length and SHA
before parse. It enforces 1 MiB during capture, not after unbounded allocation.
The reader bounds local file reads but cannot validate transport provenance.

```text
python3 -B NEW_PRIVATE_COPY/readback.py --mode scalar --raw ACTUAL_RAW_SCALAR_BODY --oracle PINNED_ORACLES --context EXACT_REQUEST_CONTEXT
python3 -B NEW_PRIVATE_COPY/readback.py --mode rows --raw ACTUAL_INVOICE_SELECTION_BODY --oracle PINNED_ORACLES --context EXACT_AB_CASE_CONTEXT
python3 -B NEW_PRIVATE_COPY/readback.py --mode lines --raw ACTUAL_LINE_SELECTION_BODY --oracle PINNED_ORACLES --context EXACT_AB_CASE_CONTEXT
```

The SQL scalar and JSON aggregate selections in selections.sql are distinct from
PostgREST HTTP. A native SQL recorder may have to retain its protocol envelope
and extract the selected JSON with a reviewed source transformation; never
silently strip wrappers and call the output raw HTTP bytes. Row/line selections
cast NUMERIC to text deliberately. They cannot replace actual invoice-list SDK
serialization evidence. SQL20's actual scalar body and actual SDK call remain
separate receipts, with exact type/text comparisons through production code.

Every emitted label says MATCH_ONLY, not native success. Supplied JSON produces
supplied-only evidence even if its file name says native. Production reader,
actual SDK, route/browser/PDF, faults, locks/commits and upgrade/restore require
their own concrete source and stage admission described in DESIGN.
