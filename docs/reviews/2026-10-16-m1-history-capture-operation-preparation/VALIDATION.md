# Validation accepts only the supplied window

ROOT runs one exact window. The author checks saved data afterward and does not import or rerun a subject. A PASS below means the control met its declared expectation, including an expected typed refusal. FAULT_DETECTED means the named wrong behavior reached its intended AssertionError. Neither means native acceptance.

The exact ROOT acceptance SHA256 is `f1df49d991d2a5eae2e969ca0bfe1e0b53f4504c96c82ba8bb97984b33d09536`. The private saved-data outcome audit and evidence manifest retain full traces and all 186 permission/hash descriptors.

## The 17 operation observations retain one population

| Case | Actual outcome | Supplied raw/caller status |
| --- | --- | --- |
| `harmless-first` | SURVIVED | 0 / CAPTURED_UNASSESSED / manager 0 |
| `baseline` | PASS | 0 / CAPTURED_UNASSESSED / manager 0 |
| `admission-source-held` | PASS | No terminal |
| `primary-plus-finalization` | PASS | 7 / FAILED / manager 1 |
| `close-only` | PASS | 0 / FAILED / manager 1 |
| `admission-expired` | PASS | None / FAILED / manager 1 |
| `expiry-after-capture` | PASS | 0 / FAILED / manager 1 |
| `invalid-raw-status` | PASS | 0 / FAILED / manager 1 |
| `stream-bound` | PASS | No terminal |
| `terminal-record-only` | PASS | 0 / FAILED / manager 1 |
| `preparse-hash-failure` | PASS | None / FAILED / manager 1 |
| `replace-primary` | FAULT_DETECTED | 7 / FAILED / manager 1 |
| `skip-final-source` | FAULT_DETECTED | 0 / CAPTURED_UNASSESSED / manager 0 |
| `ignore-close-issue` | FAULT_DETECTED | 0 / CAPTURED_UNASSESSED / manager 0 |
| `promote-assessment` | FAULT_DETECTED | 0 / CAPTURED_UNASSESSED / manager 0 |
| `disable-stream-cap` | FAULT_DETECTED | No terminal |
| `restored-baseline` | PASS | 0 / CAPTURED_UNASSESSED / manager 0 |

Exactly 15 caller invocations and two direct chunk checks produce these 17 observations. Real tool calls and kernel signals are zero. The actual archive comparison definitions read only the eight-byte owned fixture. Production entry refuses before callbacks or opens. Both production approvals remain None. All 17 case restorations report zero forced closes, empty owned FD sets, exact fixture bytes/metadata and restored archive globals.

## Five operation faults reach exact named assertions

All five errors have full class `builtins.AssertionError`. Their complete messages, suffixes and original source locations match the frozen CASE_MAP. The source directory C is `/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-control-preparation-r1`. Copies preserve the same line numbers; execution uses C.

| Mutation case | Complete AssertionError message | Original location |
| --- | --- | --- |
| `replace-primary` | `operation-control:primary-preservation` | `C/controls.py:17` |
| `skip-final-source` | `operation-control:missing-final-source-readback` | `C/controls.py:19` |
| `ignore-close-issue` | `operation-control:cleanup-only-refusal` | `C/controls.py:22` |
| `promote-assessment` | `operation-control:absent-oracle-assessment` | `C/controls.py:24` |
| `disable-stream-cap` | `operation-control:missing-refusal:stream-cap` | `C/controls.py:26` |

The in-memory mutations replace the primary, skip final source readback, ignore a close issue, promote assessment 2 to 0 and disable the stream comparison. Generic exceptions, wrong classes, other reasons and unrelated setup failures do not count as these faults. Full original traceback prefixes and final suffixes remain pinned.

## Six reader calls use the same actual report

| Reader call | Exact outcome or full typed error | Source location |
| --- | --- | --- |
| `harmless-copy-first` | SURVIVED | Original or restored full-report reader |
| `baseline` | PASS | Original or restored full-report reader |
| `wrong-message` | `_m1_operation_reader.ReportRefusal: operation-report:message:replace-primary:fault` | `File "/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-control-preparation-r1/strict_reader.py::reader-original", line 21,` |
| `wrong-origin` | `_m1_operation_reader.ReportRefusal: operation-report:trace:replace-primary:fault` | `File "/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-control-preparation-r1/strict_reader.py::reader-original", line 23,` |
| `message-bypass` | `builtins.AssertionError: operation-reader-control:missing-refusal:message` | `File "/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-control-preparation-r1/reader_controls.py", line 41,` |
| `restored` | PASS | Original or restored full-report reader |

Wrong structured message preserves the otherwise valid traceback suffix/origin. Wrong origin preserves the class/message/suffix. The omitted message guard accepts the wrong structured message and reaches only its independent missing-refusal AssertionError. Three reader definitions serve six calls, with no caller replay. The fingerprint binds compact sorted `[operationReport, CASE_MAP]`. Other internally consistent fabricated reports and unselected malformed variants remain blind.

## Fifteen new wrapper entries remain separate

The wrapper cohort uses only supplied data and in-memory source projections. It has harmless-first and baseline, six intact refusals, six omitted-fence assertions and restored. Nine projection namespaces make 30 guard calls. It does not replay the old ROOT six or resource three.

| Fence | Intact full error | Omitted-fence full error |
| --- | --- | --- |
| `budget_policy` | `builtins.RuntimeError: pure-write-budget` | `builtins.AssertionError: pure-guard-control:missing-refusal:budget` |
| `runtime_policy` | `builtins.RuntimeError: pure-runtime-closure-unresolved` | `builtins.AssertionError: pure-guard-control:missing-refusal:runtime` |
| `mount_policy` | `builtins.RuntimeError: pure-unexpected-rw-mount` | `builtins.AssertionError: pure-guard-control:missing-refusal:mount` |
| `null_setup_policy` | `builtins.RuntimeError: pure-null-target-before-root-ro` | `builtins.AssertionError: pure-guard-control:missing-refusal:null` |
| `named_readonly` | `builtins.RuntimeError: pure-named-readonly` | `builtins.AssertionError: pure-guard-control:missing-refusal:named-readonly` |
| `owned_writable` | `builtins.RuntimeError: pure-owned-writable` | `builtins.AssertionError: pure-guard-control:missing-refusal:owned-writable` |

All intact refusal traces include `File "SUPPLIED_NEW_GUARD::baseline", line 3,` in the exact need definition. Every omission trace includes `/home/nathaniel/.local/state/openplan/m1-history-capture-operation-preparation-20261016/pure-window-preparation-r1/guard_controls.py`, line 88. The full GUARD_MAP pins prefixes, suffixes, anchors and mutant hashes. The actual namespace/security observations are separate evidence; receipt-shaped supplied data provides no ROOT authority. Compound runtime-condition variants and the whole outer failure matrix remain unproved.

## Saved-data audit and restoration

* All 186 runtime evidence descriptors match, totaling 1,737,661 bytes. They stay indexed in place.
* The original 48-file packet, 52-file preparation seal and 54 preservation references match. ROOT separately verifies the 1,247 runtime files and 32 aliases.
* All 101 events rejoin: 25 definition intents, 17 case entries, 17 observations, 17 case restorations, 17 rows, one global restoration, six reader rows and one reader restoration.
* All 25 definition identities join their source/map pins, including four initial support/reader definitions, core/archive, 17 callers and two additional readers.
* Complete callback files retain exact raw lengths/hashes and parsed pre-write values. Three 37-byte files retain exact partial prefixes/hashes and have no complete counterparts.
* Raw before/after mountinfo is byte-identical. All 1,276 records satisfy the four-path writable allowlist; named probes return errno 30. Resource and namespace observations stay separate from ownership or general ABI claims.

The author audit first encounters sorted saved dictionary keys, then the nested issue-error schema. Both reader errors and corrections remain sealed. Saved dictionary membership/values and raw record hashes are compared separately; original in-memory insertion order is not reconstructed. Ordered operations, issues, cases and events remain exact. The strict reader is unchanged. No runtime repeat occurs.

## Limits carried to the checkpoint

This unit exercises supplied admission/transport/source/mount callbacks and real owned tiny FDs. It does not run the held capture helper, copied tool, archive extraction, parser, history decoder, native SQL/Auth/roles/races, restore or browser. No arbitrary storage durability, complete watchdog/outer fault matrix, service cancellation, namespace owner equivalence or exact final whole-unit byte/PID peak is proved. Kernel NBEX closes before final artifact/terminal metadata; ROOT keeps its reservation through supervisor terminal. All native M1, history, practitioner, scientific and V1 holds remain.

The checkpoint uses no dependency, test, compile, direction, manager or signing hook. Git blob readback binds review copies to the exact executed private byte hashes. Fresh independent exact-checkpoint SOURCE review remains ROOT-owned.
