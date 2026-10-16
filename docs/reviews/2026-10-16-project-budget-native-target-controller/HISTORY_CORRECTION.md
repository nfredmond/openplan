# Hex history encoding supersedes an unexecuted preparation candidate

October 16, 2026. Root holds both pure requests before grant. No subject,
dependency, lock, manager, native query or test runs. The full new independent
apply17 reviewa846, at t3-012fdf58, is read. Its P2-APPLY17-1 applies to the old
A0 R6 controller and fixture literal encoder, not application source.

The budget candidate already has two source differences from that old controller.
Its migration request explicitly sets standard_conforming_strings=on in the SAME
psql backend before BEGIN and before the dependent body/history statements parse.
Its independent postcommit readback compares complete version/name/statements
rows against prior rows plus the unchanged migration file. A changed history
string cannot pass that comparison merely because versions/count/latest match.
These are source observations, not observed PostgreSQL semantics or acceptance.

The unexecuted candidate still encodes history with apostrophe doubling. Root
requests independent encoding and actual statement cardinality/SHA evidence.
This superseding source now inserts the unchanged original UTF-8 bytes through
`pg_catalog.convert_from(pg_catalog.decode(ASCII_HEX,'hex'),'UTF8')`. The hex
alphabet has no backslash or apostrophe and does not depend on the session's
ordinary string-literal setting. The real migration body remains byte-identical
apart from the already reviewed exact outer transaction extraction for SQL19.
No historical statement is rewritten to fit altered text.

The same-backend guard now also checks actual standard_conforming_strings=on,
after the explicit SET and before the body. This guards body semantics separately
from the setting-independent history value. Reads likewise use the explicit SET.

Postcommit capture retains the full raw rows AND an independent actual database
projection for each version: statement-array cardinality, dimensions and ordered
SHA256 of each real stored UTF-8 statement. The expected new entry has cardinality1,
dimensions[1:1] and the pinned original source SHA. The prior actual projection
must survive exactly. Native implementation/compatibility of this projection
remains untested, as do actual native text and transaction results.

New finite inert controls cover actual backslash-containing SQL17 and supplied
on/off modes for its ASCII hex, same-backend preparse SET/guard, actual query
cardinality/SHA fields and independent postcommit wrong-cardinality/wrong-SHA
responses. Selected mutations remove each mechanism. The fake never parses PG
or establishes native setting behavior. Existing controls remain in the same
one proposed campaign; no old campaign runs and no second window is implied.

`unexecuted-before-history-correction/` privately preserves all22 public and23
private prepared files, exact modes and a manifest before this amendment. It
includes the held request14906, devnull requestb623, wrappers, source/runtime,
controls and pins. `unexecuted-wrapper-before-devnull/` separately preserves the
earlier device-binding draft. Neither request ever receives a grant or dispatch.
Fresh exact pins and a superseding request precede any future root decision.

## Fresh-line source inference stays separate from native parsing

Root supplies the REL_17_6 source reading of
[psql mainloop](https://github.com/postgres/postgres/blob/REL_17_6/src/bin/psql/mainloop.c#L378-L453)
and [scanner setup](https://github.com/postgres/postgres/blob/REL_17_6/src/fe_utils/psqlscan.l#L1068-L1085).
Its inference is that scanner setup refreshes standard_strings per physical line,
not after every semicolon on the same line. This task performs no network fetch
or native scanner experiment. It does not describe stdin as one whole server parse.

Runtime already ends the setting-changing SET with a newline before BEGIN,
then places the identity/settings guard and raw body on fresh lines. Root requests
a narrow control-only superseding seal. The new emitted-input assertion verifies
those exact delimiters and ordering for actual built SQL17 and the migration19
journey. One newline-collapse mutation fails migration-fresh-physical-lines.
The original23 faults and harmless-comment/restored baselines remain. Production
runtime is unchanged. Exact7af04 preparation is retained separately, still
ungranted and unexecuted. These controls cannot establish PostgreSQL scanning.

## Actual control outcome after the preparation seals

The earlier ungranted statements above describe the preserved preparation.
Trial01 later runs the harmless survivor but stops before the history faults.
Separately granted trial02 kills all history faults16–23 at their named
assertions, including fresh physical lines and the newline-collapse fault.
The final restored baseline passes. These are emitted-source/inert controls,
not PostgreSQL scanner, parser, same-backend or actual history acceptance.
