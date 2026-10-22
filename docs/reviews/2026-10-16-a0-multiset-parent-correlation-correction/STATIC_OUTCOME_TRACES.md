# Static outcome traces, no execution

Each trace below describes source control flow. No intact refusal, mutant kill, import or syntax result has been observed. The actual shared reader must see the full named AssertionError, not a substring or a generic exception.

## 1. wait-header-inventory

The second foreign header enters the recognized marker inventory. The intact count gate refuses before selecting a header. Omitting only that gate selects the first valid header and accepts the stream.

Intact expectation: `parent-wait-header-count`. Exact mutant expectation: `AssertionError:parent-wait-all-headers`. Anchor occurrences: one.

## 2. wait-whole-header

The trailing literal remains on the single recognized header. Fullmatch refuses. The selected re.match relaxation accepts the valid prefix without introducing a None/index error.

Intact expectation: `parent-wait-header`. Exact mutant expectation: `AssertionError:parent-wait-whole-header`. Anchor occurrences: one.

## 3. wait-result

The recognized result line says failure. The entire result-list equality refuses. Removing it leaves a valid header and main line.

Intact expectation: `parent-wait-result`. Exact mutant expectation: `AssertionError:parent-wait-result`. Anchor occurrences: one.

## 4. wait-main

The recognized main line reports status1. The full main-list equality refuses. Removing it leaves the other exact markers valid.

Intact expectation: `parent-wait-main`. Exact mutant expectation: `AssertionError:parent-wait-main`. Anchor occurrences: one.

## 5. wait-zero-suffix

The direct grammar call contains exactly32 zero hex digits. Removing its zero check accepts at this function boundary. Whole-parent ACK validation remains an overlapping zero-INV boundary and is not bypassed or counted here.

Intact expectation: `parent-wait-zero-suffix`. Exact mutant expectation: `AssertionError:parent-wait-zero-suffix`. Anchor occurrences: one.

## 6. wait-ack-join

The wait suffix is well-formed and nonzero but differs from the valid independent raw ACK. Both grammar and ACK remain valid. Omitting only their join allows correlation.

Intact expectation: `parent-wait-ack-invocation`. Exact mutant expectation: `AssertionError:parent-wait-ack-join`. Anchor occurrences: one.

## 7. ack-recorded-properties

Recorded MemoryMax drifts; raw properties, entry resources and raw custody remain valid. Raw binding passes, then recorded-properties equality refuses. No later guard compares this dictionary independently.

Intact expectation: `parent-ack-properties`. Exact mutant expectation: `AssertionError:parent-ack-recorded-properties`. Anchor occurrences: one.

## 8. ack-raw-entry

Raw and recorded MainPID co-change together. The independent entry PID stays fixed. Raw-binding equality refuses. After its removal the recorded dictionary and raw hashes agree.

Intact expectation: `parent-raw-manager-binding`. Exact mutant expectation: `AssertionError:parent-ack-raw-entry`. Anchor occurrences: one.

## 9. ack-custody

Only the recorded stdout hash in ACK custody is wrong. All raw001 fields are valid. Omitting the custody equality permits the otherwise valid request.

Intact expectation: `parent-ack-custody`. Exact mutant expectation: `AssertionError:parent-ack-custody`. Anchor occurrences: one.

## 10. entry-resources

The entry-only tasksMax changes to63. Raw and recorded manager properties remain exact. The dedicated full resource comparison refuses; other raw property gates cannot establish this separate entry record.

Intact expectation: `parent-entry-resources`. Exact mutant expectation: `AssertionError:parent-entry-resources`. Anchor occurrences: one.

## 11. request-intent

Request004 intent timeout changes to44, while terminal timeout and fixed spec remain45. Removing intent equality exposes acceptance; the unchanged terminal-timeout gate still sees its valid value.

Intact expectation: `parent-request-intent`. Exact mutant expectation: `AssertionError:parent-request-intent`. Anchor occurrences: one.

## 12. request-input

Request004 input bytes append a literal drift marker while its source pin and intent hash remain fixed. The exact source-byte comparison refuses. Removing it does not silently change the source descriptor.

Intact expectation: `parent-request-input`. Exact mutant expectation: `AssertionError:parent-request-input`. Anchor occurrences: one.

## 13. request-helper-pid

Request002 helper PID is integer zero. Its fieldset and ack string remain exact, and zero differs from all three positive actors. Removing the positive guard therefore exposes acceptance.

Intact expectation: `parent-request-helper-pid`. Exact mutant expectation: `AssertionError:parent-request-helper-pid`. Anchor occurrences: one.

## 14. manager-clean-terminal

A coherent collected/stored terminal retains code0 but records cleanup and UNKNOWN classification. The whole logical clean-status equality refuses. The mutant removes that equality as one shared logical boundary, not one scalar check.

Intact expectation: `parent-manager-clean-terminal`. Exact mutant expectation: `AssertionError:parent-manager-clean-terminal`. Anchor occurrences: one.

## 15. terminal-record-durability

The process terminal file exists, but the returned and stored collection result explicitly says terminalRecorded=false with an error descriptor. Omitting the combined durability gate permits the remaining exact file joins. This is not proof of actual durability.

Intact expectation: `parent-terminal-recorded`. Exact mutant expectation: `AssertionError:parent-terminal-record-durability`. Anchor occurrences: one.

## 16. ready-prefix

Only saved ready.stdout appends a drift marker. Actual raw stdout and saved JSON remain valid. Removing the raw-prefix equality exposes acceptance before unchanged identity and dependent-input guards.

Intact expectation: `parent-phase-ready-raw`. Exact mutant expectation: `AssertionError:parent-phase-ready-prefix`. Anchor occurrences: one.

## 17. dependent-source

Request004 dependent bytes and their own intent hash co-change. The accepted external source and descriptor stay fixed. Removing only exact source-byte equality allows the otherwise coherent dependent intent.

Intact expectation: `parent-phase-dependent-input`. Exact mutant expectation: `AssertionError:parent-phase-dependent-source`. Anchor occurrences: one.

## 18. dependent-backend

Only the recorded dependent backendPID changes. Actual readiness, dependent bytes and hash stay valid. The combined dependent-intent comparison refuses. No same-backend claim follows from this model.

Intact expectation: `parent-phase-dependent-intent`. Exact mutant expectation: `AssertionError:parent-phase-backend`. Anchor occurrences: one.

## 19. retained-map

All three supplied maps co-change their census value, retain383 labels and preserve valid inventory. Stored outputs and request hashes co-seal. Removing the retained-oracle loop exposes the fresh-current-map substitution; unchanged current-inventory checks cannot repair it.

Intact expectation: `parent-retained-output-map`. Exact mutant expectation: `AssertionError:parent-retained-r-not-fresh-d`. Anchor occurrences: one.

## 20. output-custody

Only stored catalogue.json unknown-function identity metadata changes. Raw catalogue stdout remains valid. The combined parsed-object/canonical-byte output guard refuses. Removing it exposes the divergent stored output.

Intact expectation: `parent-output-record-custody`. Exact mutant expectation: `AssertionError:parent-output-record-custody`. Anchor occurrences: one.

## 21. current-inventory

Only the after inventory has a new unique positive OID for an existing label. Each individual inventory still passes its count/type/kind/name gates. The full before-versus-after equality is the intended refusal.

Intact expectation: `parent-current-inventory-after`. Exact mutant expectation: `AssertionError:parent-current-inventory-after`. Anchor occurrences: one.

## 22. complete-exact

Only fixtureLaunchable changes to true. The shared complete equality refuses. Removing it exposes this false-flag violation while the independent unresolved list checks still pass.

Intact expectation: `parent-complete-exact`. Exact mutant expectation: `AssertionError:parent-complete-exact`. Anchor occurrences: one.

## 23. unknown-definition

One unreviewed function carries the nonsecret INERT_UNKNOWN_LABEL value instead of null. Other fields and its complete unresolvedOID list remain coherent. Removing no-wire equality exposes acceptance.

Intact expectation: `parent-unknown-definition-no-wire`. Exact mutant expectation: `AssertionError:parent-unknown-no-wire`. Anchor occurrences: one.

## 24. collector-primary

A supplied real-pipe read raises OSError, then output fsync also raises. The intact collector retains the read primary and separate fsync cleanup. Removing primary assignment violates the direct original-primary assertion.

Intact expectation: `direct return diagnostic equality`. Exact mutant expectation: `AssertionError:parent-collector-primary-preserved`. Anchor occurrences: one.

## 25. collector-primary-overwrite

The same supplied failures occur. Replacing cleanup append with primary assignment overwrites the original read diagnostic. The direct primary assertion fails before a secondary cleanup assertion.

Intact expectation: `direct primary/cleanup separation`. Exact mutant expectation: `AssertionError:parent-collector-primary-not-overwritten`. Anchor occurrences: one.

## 26. collector-owned-close

The second output open fails before Popen. The first real output descriptor must close in source finally. Removing its close leaves exactly one output-kind stream open at the direct oracle; enclosing restoration has not run yet.

Intact expectation: `direct owned-FD close observation`. Exact mutant expectation: `AssertionError:parent-collector-owned-close`. Anchor occurrences: one.

## 27. collector-terminal-attempt

The supplied read plus fsync failures still require a terminal record attempt. Omitting that call leaves no terminal event/file. The direct attempt oracle fails even though the local return would otherwise claim terminalRecorded=true.

Intact expectation: `direct terminal-attempt observation`. Exact mutant expectation: `AssertionError:parent-collector-terminal-attempt`. Anchor occurrences: one.

## 28. record-primary-close

A write error precedes a supplied close error. Replacing cleanup append with primary assignment changes RecordFailure.primary to record-close. The direct primary type/reason/phase assertion fails with the exact chosen name.

Intact expectation: `direct RecordFailure primary equality`. Exact mutant expectation: `AssertionError:parent-record-primary-preserved`. Anchor occurrences: one.

## Additional intact selections

These selections retain overlapping guards and make no separate mutation-kill claim. Readiness type/off cases co-seal the saved prefix with altered JSON. Authority preflight changes co-seal admission and root-intent hashes before reaching the exact boolean guard. Admission binding drift reaches its join before the root-intent equality. A wrong risk old-attempt list reaches the explicit old-attempt comparison. Complete unresolved bool/wrong-positive cases reach the shared complete equality, not a fictitious independent list kill. Child unknown terminal and parent stream-hash cases retain their actual return/error/hash custody gates.

Collector-only terminal-record failure leaves the already captured process row terminal-zero but returns terminalRecorded=false with a nested RecordFailure. The direct oracle preserves this distinction. The parent durability gate refuses it. Cleanup-only code0 and partial setup remain UNKNOWN. Record-write plus close/sync preserves primary and both independent cleanup attempts.

Additional current-format cases cover missing final LF, non-ASCII input, mixed recognized markers and unreviewed resource text. The actual all-marker parser rejects them. No wildcard or alternate systemd-format acceptance is introduced.

The source construction, Popen and journal counts are fixed in control-cases.json and CONTROL_PREPARATION.md. No stage repeats automatically after a failure. Arbitrary I/O failures may prevent record durability; they remain failures and cannot count as named kills.
