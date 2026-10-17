# Preserve original migration history in a new apply17 continuation

October 16, 2026. PREPARATION ONLY. This capsule addresses P2-APPLY17-1 in
review `a846dd3f08c1ed0cfbc7f71725bf457dc873da7f`. It changes no application or
migration source. It preserves every old R6 execution and does not manufacture
new observe, allocate or restore executions. No admission ships.

## Scope and source identity remain separate

The assigned clean checkout starts at `05dd3e8da4a4572437f06e771b0a2477873e681f`.
T3 confirms branch `t3/a0-migration-history-literal-correction`, this isolated
worktree, parent `1401bb6a-70e4-42eb-a1f1-98045485f8cc`, and Sol6.1/high.
An ancestry read precedes the permitted local fast-forward to
`14bef38bd3fde0c7f06c5dad04d6b0c149113d74`. That is the preparation base, not a
replacement A0 application pin. Ownership covers this new directory and only
`/home/nathaniel/.local/state/openplan/a0-migration-history-literal-correction-20261016`.
No nested agent is used.

Actual future native source remains the frozen author checkout
`/home/nathaniel/.t3/worktrees/openplan/t3-ac91cc52`, subject
`b35dd7126939d7e1ad24e9ddbf887653275317c1`, application source
`f8a571bb0a18b8b6501870acb5ef1e760d487e1c`, app tree
`d577a9cd955018b3253f42b3d9af2a96a9a10b53`, and connector tree
`228ce912b1cf63dba408445422dc6e2b690d91f4`. The new controller deliberately
keeps that REPO. Billing source integration elsewhere grants no A0 rebind.
All 421 migration pins remain. SQL17 stays
`b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`;
SQL18 stays `655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559`.

## Hex encoding removes the history dependency

`literal_history.text_value()` reads strict original UTF-8 bytes and emits
`pg_catalog.convert_from(pg_catalog.decode('<hex>','hex'),'UTF8')`.
Only ASCII hex digits derived from those bytes enter that SQL literal.
Apostrophes, double quotes, backslashes, tabs, carriage returns, Unicode and LF
remain data. Invalid UTF-8 and NUL refuse rather than normalize. PostgreSQL text
cannot represent NUL. No E-literal, delimiter guessing, escape relaxation,
source rewrite or injection fallback exists.

`source_bytes()` compares the file's original byte SHA-256 before construction.
It does not use a newline-normalizing text reader. The actual executable raw
migration is unchanged and is separately appended to the migration transaction.
The existing fixture encoder stays unchanged because it is not used for this
new history source value. This does not certify every future use of that encoder.

The independent committed read returns the exact version and name, one row,
one dimension, bounds 1 through 1, cardinality 1, nonnull sole text, UTF-8 byte
length, SHA-256, original text and hex bytes. Python compares against the sealed
source bytes, not against a digest supplied by the insert. A separate aggregate
checks the predecessor rows excluding 17 against the pre-migration history digest.
Existing 420 version/count/latest and complete before/after row/sequence checks
remain. A failed postcommit read fences the stage even if COMMIT succeeded.

## Raw migration parsing requires an acknowledged backend

The first send contains identity guards, BEGIN, finite bounds, transaction-local
client encoding and SET LOCAL ROLE postgres on fresh physical lines. It does not
change standard_conforming_strings. The role DO guard retains actual nonsuperuser
postgres. Its admin identity DO checks the actual system identifier and OID
before SET ROLE in that same backend. Its SELECT reports database, integer OID,
session/current role, nonsuperuser flag, positive nonboolean
backend PID, application name, both UTF8 encodings and effective string setting.

The controller accepts exactly one complete JSON line, no stderr and a still-live
owned process. It requires `standard_conforming_strings=on` and the exact target.
It durably retains the returned prefix and identity. Only then does it fsync the
exact body and send intent and write the dependent body into that same pipe.
The body locks history, repeats the original digest check, executes original SQL17,
inserts hex-decoded original history and commits. A different connection cannot
supply this prerequisite. A marker or default assumption cannot supply it either.

R6 uses psql stdin, without -c/-f. Normal psql dispatches semicolon-terminated
commands separately. A Python string does not imply one whole server Query.
For a whole simple-query message, server lexical analysis precedes execution;
SET LOCAL cannot repair already lexed text. The REL_17_6 psql scanner caches
standard_strings once per physical input line and continues scanning that line
after SendQuery. Fresh lines separate the new SET terminators and guards.
SET ROLE does not apply ALTER ROLE defaults.

These timing conclusions are upstream-source inference, not observed target
behavior. Full research and source register at commit
`201ef3062be85b5747e641d6d8cd7b8f9f7c2089` are read, including retained upstream
mainloop.c 378–453, common.c 2132–2144 and psqlscan.l 1068–1085.
See [research](</home/nathaniel/.t3/worktrees/openplan/t3-989ae2bb/docs/reviews/2026-10-16-postgres-history-literal-semantics/RESEARCH.md>)
and [sources](</home/nathaniel/.t3/worktrees/openplan/t3-989ae2bb/docs/reviews/2026-10-16-postgres-history-literal-semantics/SOURCES.md>).
No native diagnostic is proposed or approved by this packet.

## The predecessor is external and explicitly admitted

The new private plan is byte-identical to the actual R6 plan. It proposes only
continued use of successful target `openplan_a0_limit_c730358675ac8bb47ac15fdd`,
OID 6227945, system 7683856985084612646. It does not allocate, reset, reclone or
silently adopt it. `external-predecessor.json` names the literal old root and
restore stage, actual target, completion, exact retained manifests and a finite
allowlist of actual input/stream/returned-process/exit/manager/outer records.
Every selected hash, length, mode, UID and GID must still match. New admission
must contain that entire exact binding. Changed predecessor or target refuses.

Actual external restore completion is
`fc590a9ed0285dbfcb3de75137ffc627efbe4398446995eddfa58407475cca0f`.
Its manager-terminal acknowledgement remains separate. R6 observe has 12
controller requests plus manager0 and 89 proof entries. Allocation has 19 plus
manager0 and 131 entries. Restore has 25 plus manager0 and 169 entries, manifest
`f20a33fde59c4af5042bb0f1cb4eaab548240fbdb5b9694afbedb06d318e8ae5`.
Parent 43534 terminal0 records 15.408639802946709 seconds, invocation
`fad2f959cc9f47c2a64dad08fd31ecfb`. These remain R6 executions, never renamed R7.

Retained history has 419 versions/latest16/digest
`0ee645e79fb8431bb116c30a673f8775`; 376 ordinary table maps and pg_sequences
`d906d887079dd69d2b018752258ca3b5` match. Six explicit sequence states are
captured without an independent source log_cnt/is_called comparator. Original
catalog scope contains 615 identities and global-role/settings digests. This is
not protected-row, locale/owner, cancellation or whole-installation acceptance.

The preceding finish descriptor retains definition hash `62bc6dee9f86785dcd05c399a75ffba562632e89730d291c64f48ad269cc00df`,
owner postgres, definer true, volatility v, full one-entry proconfig and raw
expanded EXECUTE ACL grantor 16384/grantees 16384 and 16445. Full review a846
finds the body equal to source12 plus migration14 search path. Its conditional
preservation support does not establish named-role or default-ACL acceptance.
This capsule compares the complete descriptor before and after 17, without edits.

The rejected proposal `3c88370b4874ec6a623dda06ab5433ec288c0a24e9825a723eb8574acd5c0385`,
prior pins 2832c3, actual definitions 51ee25 and outer e4687a remain unexecuted.
New sources refuse if old R6 apply17 admission/stage appears. There is no actual
new admission or stage. The prepared proposal has a null independent review pin.

## Earlier objections and source boundaries remain

The original full A0 task at d20e587 requires additive SQL18; actor/owner/exact
payload/hash/model/window custody; terminal versus pending and reported versus
unknown reset distinctions; independent installed operation. It remains within
the existing Planner Agent workflow. Source corrections and indexed full reports
remain in the R5 HANDOFF and current R6 STATUS/HANDOFF/PARENT_RECIPE. This report
adds P2's correction without replacing that brief or regrading older findings.

Rounds 332925/response3c79ca retain manager/child namespace, provider FK/model/mode
and qualified caller corrections; 857453/53e17b retain manager-only UID runtime
location; 7468c58 retains source-only approval and later failed R3 observation;
root9c9/e71352 retain the main OID cast; 6c12e7/133e195 retain strict case OID,
ordinary zero/shadow888 and restored continuity. Current source688, observe714,
allocatefb77 and restore7c7f reports retain their conditional scopes. Full current
reports and new a846 are read. Historical R5 and R3 failures remain failures.

R5 OID6212363 stays permanently fenced, without retry, adoption, repair, reuse,
drop or cleanup. Protected419 DB6072103, frozen607/215, canonical3, inherited404,
demo3000, application trees, archives, helpers and proofs receive no writes.
Existing role, native positive nonboolean OID/PID/system, actor/provider/model/
mode/tuple/exact payload, owner/full proconfig/ACL, ordinary0/shadow888, future
case restoration and noReplay requirements remain. Only apply17 is launchable.
Unchanged inherited fixture/case/race methods remain source, without new admission.

## Checks establish finite composition only

The one granted pure window has 180 seconds, 512 MiB, zero swap, CPU50, Tasks64,
one nonblocking shared compiler flock, unshared network and named read-only
source/old-evidence roots. Only new private state and the shared lock are rebound
writable. The final devnull-only dev-bind precedes env. Python uses -B; npm uses
private HOME/cache/logs and no donor or install. Direction runs from this actual
assigned nested app; its result cannot rebind the A0 source.

The campaign invokes real new Controller.apply/native/scope/history/snapshot/
definition/argv/identity and journal.Transport code. Only Popen and its stdin/
stdout/stderr file behavior are inert. It includes a harmless source survivor,
named encoding, NUL, byte-hash, history cardinality/exact row, on/off, PID,
identity, ambiguity, predecessor binding, early-send and newline-collapse faults,
unknown commit, replay refusal and exact finally restoration. A small resource
guard control includes its own survivor/fault/restoration.

The fake has finite emitted-SQL recognition and fabricated responses. It cannot
prove PostgreSQL scanning, parser/encoding, real ACL/RLS, OID serialization,
commit, concurrency, cancellation/backend absence or physical durability. Selected
metadata equality cannot detect every transient effect or hostile same-user
tampering. Named read-only mounts do not prove host-wide absence of inherited
writable submounts. Source review and a local commit supply no native acceptance.

The granted window now terminates0 with all four prepared steps0. STATUS records
actual receipts, exact reader correction,18 main trials and reader/resource
survivor/fault/restoration. No runtime source changes after those checks.
