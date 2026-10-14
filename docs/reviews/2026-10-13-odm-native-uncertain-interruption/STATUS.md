# Native interrupted draft upload candidate

An owned process receives and checks a real NodeODM upload reply, then exits
with code 73 before `Draft.advance` can save the reply. The original intent
remains unresolved. A relocated runtime makes three recovery attempts, holds
the same uncertain upload and sends no further authorization or engine request.
Actual backend metadata, filename inventory, size and hash retain exactly the
first original upload. The second upload and processing commit remain unissued.

This continues existing M3/M5b.2 and the
[native private authority composition](../2026-10-13-odm-native-private-authority-composition/STATUS.md).
Production worker, schema, hosted configuration, defaults and scientific claims
stay unchanged. This is an actual process interruption after a fully received
response. It does not establish an acknowledgment lost in the network.

## Current evidence

The [baseline result](evidence/baseline-results.json) passes 17 predicates and
54 changed/missing/type classifiers. The retained private RPC fixture passes
17 cases, including the existing native engine refusal and restoration cases.
Three complete synthetic drafts retain six uploads. The separate interrupted
draft retains one upload and no journal receipt. The
[actual child](evidence/baseline-interrupted-child.json) exits 73, and the
[relocated recovery](evidence/baseline-interruption.json) holds three times with
zero current-access reads, engine attestations or transport calls. Original
application receipt and exact engine journal bytes remain unchanged.

The [baseline engine](evidence/baseline-stopped.json) and
[RPC services](evidence/baseline-rpc-stopped.json) stop. The owned driver peaks
at the value recorded in [accounting](evidence/baseline-resources.json) under
256 MiB with no extra swap. The engine uses 512 MiB, the owned database 1 GiB
and PostgREST 128 MiB. No host ports, new network or image pull are used.
Only verified retained fixtures and a fresh owned engine run.

The first trial fails before uploading because the new harness used `start`
instead of the runtime's existing ownership context. That failed trial and its
stopped engine remain retained. The corrected baseline succeeds. The [controller](evidence/native-controls.json) passes four positive cohorts and
ten selected faults. Bypassed uncertainty, a child returning to save its receipt,
removed original intent, unexpected saved receipt, omitted interruption cohort,
changed backend bytes/form/inventory and both weakened result classifiers fail
for their intended reasons. The [typed failure oracles](evidence/failure-oracle-controls.json)
pass 16 controls, including rejection of unrelated reasons and extra errors.
Source bytes restore exactly. The [controller unit](evidence/control-resources.json)
stops with a 110,960,640-byte peak under 256 MiB, zero max/OOM events and no
extra swap. Each complete positive retains 17 RPC cases and four distinct native
drafts: three complete drafts with six files, plus the interrupted draft with
one file. The [Python 3.11 native journey](evidence/python311-native-results.json) also
passes all 17 predicates and 17 RPC cases. All 14 selected documentation tests
and product direction pass from the actual nested package. The
[follow-up unit](evidence/followup-resources.json) stops with a 308,944,896-byte
peak under 1 GiB, zero max/OOM events and no extra swap. All
[executed source bindings](evidence/python311-source-bindings.json) match,
and every owned fixture stops. This joins the existing combined PR263 after its
CI wrapper correction. No main merge or release is claimed here.

## Evidence boundaries

The SQL fixture retains an older 405-migration synthetic schema. It does not
represent current main or the hosted database. ZIP bytes are supplied ordinary
synthetic strings with image filenames, not decoded imagery or public DNS/TLS
intake. The engine remains the cached Linux NodeODM 2.2.4 image/profile already
identified in the preceding composition report. No reconstruction runs.

The driver inspects actual current draft bytes in this owned fixture. It does
not exclude other writers or establish an atomic revocation boundary. It cannot
grant retry, repair, adoption or processing permission. It does not reconcile
uncertainty, synthesize a receipt or publish output. Complete worker recovery,
installation-wide alignment, separate physical-host recovery, long computation,
quality-reviewed imagery, browser/practitioner/scientific acceptance and v1
remain open. This evidence does not close those requirements.

Private responses, configurations, original and relocated roots and failed
trials remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-native-uncertain-interruption-20261013/`.
