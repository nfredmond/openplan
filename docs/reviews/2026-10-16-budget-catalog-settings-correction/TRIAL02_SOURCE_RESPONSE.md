# Trial02 changes one mutant qualifier and resumes the unaccepted remainder

October 16, 2026. SOURCE ONLY. No import, test, dependency, compiler, lock,
manager, Docker, SQL, native operation or commit runs. Root must separately
grant the exact [TRIAL02_REQUEST.json](TRIAL02_REQUEST.json). The old grant
remains consumed and is not a fallback.

## Trial01 remains failed and permanently sealed

Root's actual pure01 terminates1 in session4414. Parent2472883 returns
wrapper2472885 after8.297596669 seconds. Manager invocation
`cf41198ca3e943f699417db9a20804fb` reports main1, runtime8.261s, peak49,213,440
bytes and zero swap. Complete is absent. Controls status remains RUNNING.
Root classifies the result HARNESS_MUTATION_ORACLE_MISMATCH, with no runtime
or native finding.

Baseline PASS, harmless SURVIVED and the first two exact named faults are
accepted partial evidence. The third fault is not accepted. Its raw-output
SQL used `ORDER BY setrole`; the earlier row-coverage assertion required
`ORDER BY s.setrole`. Actual stderr therefore records
`scope-all-setting-rows-covered`, followed by the exact mismatch refusal.
The intended raw-output reason remains `scope-no-setting-values-on-wire`.

Root retains the failure disposition, terminal seal, actual streams and
parent receipts under `/home/nathaniel/.local/state/openplan/budget-settings-pure-root-decision-20261016`. No failed unit, old pure-attempt, case, grant,
request, source file or report is edited, chmodded, cleaned up or replayed.

## The source delta is limited

Only mutation index2 edits[0].new changes:

```diff
-SELECT jsonb_agg(to_jsonb(s) ORDER BY setrole)
+SELECT jsonb_agg(to_jsonb(s) ORDER BY s.setrole)
```

The complete fragment still projects raw settings, deliberately. The hypothesis,
old anchor, mode and intended exact AssertionError remain unchanged. Every
other mutation tuple matches trial01 exactly. The correction lets this fault
reach its intended raw-output oracle after satisfying the earlier coverage
oracle. It does not weaken that oracle or make raw output acceptable.

Runtime4, capture, query, collector and builder bytes remain unchanged. Fixture,
assertion and typed ValueError reader logic matches the original after the
necessary input/output path normalization. [TRIAL02_READER.diff](TRIAL02_READER.diff)
shows all reader/runner/wrapper changes.

The NEW private trial is `/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/trial02`. Seven byte-identical work copies support
the existing mutation/restoration mechanism. Immutable plan, capture inputs
and source originals are read from the old root. Old evidence/case contents
are referenced by metadata rather than recursively copied.

## Reuse is checked before any remaining control runs

The pre-edit seal covers2,050 unique original files:1,966 original private files,
29 public prepared files,10 root-decision files and the remaining preserved
references. All original35 private inputs,71 preserved records, source manifests
and11 failed-terminal-seal entries match. The seal records SHA-256, length,
mode, UID and GID. Its private path is `trial02/original-seal.json`, SHA-256
`31eaedab4ba52aaf7a0212a9a1e96d89740265320eb62d05e6ac1918954d6386`.

The fixed resume check requires that entire seal, current old/new reader and
runner pins, the unchanged mutation tuples, exact accepted partial results,
all106 finally checks and the actual failed parent/stream/disposition proof.
It requires the old failure status and absence of complete. It cannot
reclassify pure01 as success.

Trial02 runs only indices2 through8, requiring nine exact named assertions
across seven faults, then ONE restored baseline. It does not repeat the initial
baseline, harmless annotation or the two accepted faults. Exact finally source
bytes/modes restoration and before/after preservation checks remain required.

Static inspection confirms eight unique remaining edit anchors and every
unchanged exact assertion reader. For the corrected raw-output fault, the
earlier row-coverage text gates are satisfied and the unchanged summary-field
gate is the first intended failure. The remaining first-failure paths are
recorded in [TRIAL02_REUSE_PINS.json](TRIAL02_REUSE_PINS.json). These are static
observations; no control, SQL expression or parser executes here.

## One new finite pure window is proposed

Request SHA-256:
`972e3e88479b88b6f4e8b0d2503e87caf7dd3a7b1b2dbb511e13c3831a7e0648`.

The request seals15 NEW trial inputs and2,052 preserved records. Unit
`openplan-budget-settings-v2-pure-20261016-02` retains120s/512MiB/zero swap/
CPU50/Tasks64, parent145s and1MiB per stream. It keeps one nonblocking
EXCLUSIVE global-file lock across manager wait and fixed show. Network is
unshared, Python uses-B, only /dev/null is device-bound, and there is no donor.

The original parent root and failed proof root are explicitly RO. Only the
NEW nested trial02 receives RW. Inherited writable submount limitations remain.
Post-show defaults stay unbound, with no extra manager query. Root must create
NEW trial02 grant and outer intent files. Neither exists now. A fresh grant
cannot be inferred from free capacity or the old grant's continued presence.

Find availability, native PostgreSQL digest semantics, live manager behavior,
backend death and operating acceptance remain unproved. Source3f/app44e/422,
current423 distinction, original native failed capture and all native/OBSERVE/
target holds remain unchanged. No source checkpoint follows this preparation.
Root owns the fresh independent byte review after applicable controls.
