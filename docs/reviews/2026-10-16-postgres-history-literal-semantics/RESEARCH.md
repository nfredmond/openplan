# Preserve migration history independently of ordinary string settings

October 16, 2026. Bounded technical research for **P2-APPLY17-1**, within roadmap A0 and the M11 native-history prerequisite. This supplies source facts and correction criteria. It approves no operation or new queue item.

## Findings support a small correction

Use a setting-independent representation for the history value. UTF8 bytes encoded as hex, decoded with `pg_catalog.decode`, and converted with `pg_catalog.convert_from` avoid the ordinary-literal backslash ambiguity. Keep the original SQL17 and SQL18 files unchanged. Separately require the intended string setting in the same migration backend before dependent raw SQL is parsed. Independently compare the committed history row with the pinned source, including version, name, array shape and UTF8 SHA-256. These are research recommendations, not an implemented or natively accepted correction.

R6 feeds a Python-built script to **psql stdin**, without `-c` or `-f`. It is therefore incorrect to equate its whole Python string with one server Query message. Normal psql processing sends complete commands individually. In contrast, the server lexes an entire simple-query message before executing any command in that message. A `SET LOCAL` inside such a message cannot change that message's earlier lexical analysis. [PostgreSQL 17 psql](https://www.postgresql.org/docs/17/app-psql.html), [Message Flow](https://www.postgresql.org/docs/17/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT).

There is a further **upstream-source inference**. PostgreSQL 17.6 psql reads the standard-string flag when it sets up each physical input line. It reuses that scanner flag across semicolon-separated commands on that line. If a correction sets the parameter, terminate that setting on its own line before the guard and dependent input. A same-backend refusal when the setting is off avoids needing to change it. No parser behavior has been observed on the retained target in this research.

## The inspected R6 source has the reported dependency

I read the full independent finding in `t3-012fdf58/docs/reviews/2026-10-16-a0-r6-apply17-admission-independent/REVIEW.md`, the exact R6 controller and fixture source, policy, and SQL17/18. Private copies preserve their original bytes. The three authored runtime files equal their retained R6 templates byte for byte. [Local source inventory](source-pins.json) records paths, lengths and SHA-256 values.

The relevant R6 source is under `t3-ac91cc52/docs/reviews/2026-10-16-a0-sequence-snapshot-correction/runtime/`:

- `fixture.py:6` surrounds values with ordinary quotes and doubles apostrophes. It does not encode backslashes.
- `controller.py:154–175` constructs the psql argv and supplies the identity prefix plus SQL as stdin bytes. The argv includes `-XqAt` and `ON_ERROR_STOP=1`, without `-c`, `-f`, single-line mode or a bind command.
- `controller.py:256–281` reads the migration, starts a transaction, sets local bounds and role, checks the history digest, appends executable SQL, inserts its history text using `f.literal(sql)`, and commits.
- `policy.py:58–61` checks history versions, count and latest. The postcommit snapshot comparison excludes migration history. Retaining a new digest without an independently expected value does not establish the intended stored text.

SQL17's ordinary quoted regular-expression strings contain backslashes at source lines 80, 113, 220, 221, 233, 234, 237 and 269. Its enclosing function body uses dollar quotes. Thus preserving that outer body does not establish preservation of a separate ordinary-quoted history copy. This confirms the source dependency described by P2-APPLY17-1. It does not claim a failure occurred on R6.

## PostgreSQL 17 distinguishes four literal representations

With `standard_conforming_strings=on`, ordinary single-quoted strings retain backslashes. With it off, they use escape handling. Doubling apostrophes alone is insufficient for arbitrary backslash-bearing text in that mode. The documented default is on, but a default does not establish a particular backend's effective setting. `escape_string_warning` can warn about ordinary backslash escapes; a warning does not assert byte equality. [Version and Platform Compatibility, 17](https://www.postgresql.org/docs/17/runtime-config-compatible.html#GUC-STANDARD-CONFORMING-STRINGS).

Explicit `E'...'` strings use escape handling regardless of the ordinary-string setting. An encoder using E literals must encode each original backslash as `\\` and double apostrophes. Merely adding `E` to R6's existing encoder retains the defect. PostgreSQL documents that an unrecognized backslash escape yields the following character, which explains why `\s` and `\.` need not retain their slashes. The 17.6 scanner chooses escape state for E literals and returns the following character for otherwise unrecognized escapes. [Lexical Structure, 17, 4.1.2.1–2](https://www.postgresql.org/docs/17/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS-ESCAPE), [17.6 scan.l, ordinary/E state selection and unescape_single_char](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/parser/scan.l#L559-L574).

Dollar quotes retain their contents literally, including apostrophes and backslashes. A history encoder must choose a valid, case-sensitive tag whose complete delimiter does not appear in the source. An unexamined fixed `$$` delimiter is unsuitable for these migrations, which already contain `$$`. Dollar quotes avoid backslash escaping, but still require correct delimiters and text encoding. [Lexical Structure, 17, 4.1.2.4](https://www.postgresql.org/docs/17/sql-syntax-lexical.html#SQL-SYNTAX-DOLLAR-QUOTING).

The minimal preferred history expression is conceptually `pg_catalog.convert_from(pg_catalog.decode('<hex of exact UTF8 source bytes>', 'hex'), 'UTF8')`. The placeholder is explanatory and is not SQL to execute. Its generated literal contains only ASCII hex digits. Neither ordinary-string mode gives those digits escape meaning. `decode` yields the original binary value; `convert_from` interprets UTF8 and returns text in the database encoding. The converse `convert_to(value, 'UTF8')` supplies the byte representation for comparison. PostgreSQL also provides `sha256(bytea)` and hex encoding without requiring a new extension. [Binary String Functions and Operators, 17, Tables 9.12–13](https://www.postgresql.org/docs/17/functions-binarystring.html).

**Source inference and limits:** For valid UTF8 source text without NUL, in the intended UTF8 database, this composition preserves its bytes, including whitespace, newlines, quotes and backslashes. The 17.6 conversion implementation validates the source encoding before conversion; the hex decoder reconstructs pairs of nibbles. This is not a blanket promise for arbitrary binary data, malformed UTF8, a lossy pre-encoding reader, or unrepresentable text in another database encoding. [17.6 mbutils.c, pg_convert_from/pg_convert](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/mb/mbutils.c#L520-L610), [17.6 encode.c, hex_decode_safe](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/adt/encode.c#L189-L240).

The inspected SQL files round-trip through strict UTF8 without changed bytes. Neither contains carriage returns or NUL. This source observation supports using their byte hashes as UTF8 history expectations. It does not demonstrate PostgreSQL conversion on the target. Encode from pinned file bytes; do not trim, normalize newlines, reformat, replace regexes or rewrite migration history to match a changed result.

## psql and one simple-query request have different timing

The psql manual distinguishes `-c`, which submits its command string as one request, from normal input processing, which dispatches each command at its terminating semicolon. Semicolons within quoted bodies do not end the outer command. Explicit `\;` can instead combine commands in a request. These exceptions mean a source reviewer must inspect the actual input path, not infer it from the size of a shell write. [psql, 17, command option and backslash-semicolon](https://www.postgresql.org/docs/17/app-psql.html).

The **17.6 source inference** follows these specific calls:

1. `mainloop.c:378–394` sets up the current line with `standard_strings()`, then scans for command boundaries. At `420–453` it sends a command at a semicolon, consumes the result, clears the query buffer and continues the line without resetting the scanner.
2. `common.c:2132–2144` implements `standard_strings()` through `PQparameterStatus`. `psqlscan.l:1068–1085` stores that argument in scanner state; its ordinary-quote rule at `485–495` reads the stored flag.
3. `common.c:1465–1468` uses `PQsendQuery` in this normal path. libpq receives ParameterStatus messages and saves their values. The server marks `standard_conforming_strings` as user-settable and reportable in `guc_tables.c:1745–1753`.

These calls support two distinct conclusions. A completed SET can affect the server's parsing of the next separately submitted command. The psql client's quote-boundary scanner gets the updated flag at the next input-line setup, not automatically between commands on the same line. This cached flag concerns client command recognition; it does not cause the backend to retain its old GUC for a separately sent statement. [17.6 mainloop.c](https://github.com/postgres/postgres/blob/REL_17_6/src/bin/psql/mainloop.c#L378-L453), [common.c](https://github.com/postgres/postgres/blob/REL_17_6/src/bin/psql/common.c#L2128-L2144), [psqlscan.l](https://github.com/postgres/postgres/blob/REL_17_6/src/fe_utils/psqlscan.l#L1068-L1085), [fe-protocol3.c](https://github.com/postgres/postgres/blob/REL_17_6/src/interfaces/libpq/fe-protocol3.c#L1462-L1486), [guc_tables.c](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/misc/guc_tables.c#L1745-L1753).

The libpq manual documents automatic reports at connection startup and when relevant values change, including this parameter. Its `PQexec` interface permits multiple commands in one call. The protocol manual states that the whole Query undergoes initial lexical and syntactic analysis before execution. In 17.6 `exec_simple_query` calls `pg_parse_query` before iterating its parse trees. The scanner snapshots the GUC during scanner initialization. A SET later executed from that same parse cannot rewrite already parsed literals, including literals textually after the SET. [Connection Status Functions, 17](https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPARAMETERSTATUS), [Command Execution Functions, 17](https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC), [Message Flow, 17](https://www.postgresql.org/docs/17/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT), [17.6 postgres.c](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/tcop/postgres.c#L1056-L1100), [scan.l](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/parser/scan.l#L1268-L1278).

## A role change does not establish the string setting

SET affects the current session. SET LOCAL lasts through the current transaction and restores the session value when the transaction ends. Outside a transaction, SET LOCAL has no effect beyond a warning. Rollback to an earlier savepoint can undo it. A function's SET option also has entry/exit scoping that differs from an ordinary session setting. [SET, 17](https://www.postgresql.org/docs/17/sql-set.html).

SET ROLE changes permission identity, subject to the session user's authority. It does not load the target role's ALTER ROLE configuration defaults. R6's SET LOCAL ROLE postgres and nonsuperuser guard therefore do not establish string semantics. Nor does a check on a separate backend establish them for the migration connection. [SET ROLE, 17](https://www.postgresql.org/docs/17/sql-set-role.html).

For this bounded correction, a same-backend guard that refuses an effective value other than on is sufficient to establish the prerequisite as a design requirement without changing cluster, database or role defaults. Place it before dependent raw statements, with its own safe delimiters and physical line boundaries. If the author elects to set the value locally, require completion before dependent parsing and a same-backend assertion. The history representation should still be setting-independent. A transaction-local setting does not persist into later function invocations; the captured function's proconfig must not be silently expanded to promise that.

## Independently compare the committed row with original source

Keep the existing prior-history lock and custody checks. They protect a different boundary. The committed result should independently establish each following fact against the sealed migration source, rather than deriving the expected value from the inserted history value:

- Exactly the expected row/version exists, with the exact migration name.
- `statements` is nonnull and has the intended one-element shape, one dimension and lower bound 1. Its sole element is nonnull. Cardinality alone does not establish those bounds or reject a null element.
- The sole text element's UTF8 byte length and SHA-256 match the original file bytes. Exact UTF8 equality or returned hex can strengthen the comparison; a hash remains a collision-resistant custody check, not mathematical identity proof.
- Predecessor history remains unchanged, and no unrelated history row appears or changes. Versions/count/latest cannot detect a changed name, source text, array shape or predecessor content.

Array cardinality, dimensions and lower bounds describe different properties. [Array Functions and Operators, 17](https://www.postgresql.org/docs/17/functions-array.html).

This is a correction criterion, not a proposed diagnostic run or query script. Readback after commit needs its own independently evaluated expected values and retained outcome. A postcommit mismatch or lost acknowledgement leaves uncertain or changed state and preserves the existing no-retry fence. It does not authorize rewriting history, retrying, dropping a target or advancing to SQL18.

## Preserve migration bytes and the preceding function descriptor

SQL17 remains 15,938 bytes, SHA-256 `b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`. SQL18 remains 9,284 bytes, SHA-256 `655e625878b3e62f332a7f17d6e126879813cc2bf881ca745593978d8eed6559`. Private byte copies and [source pins](source-pins.json) retain both files, plus textual body-slice hashes. Slicing `$$` delimiters is a source-byte operation, not a PostgreSQL parse or installed-body observation.

The preceding retained finish definition file remains SHA-256 `51ee25e367f5b665a090011c6b8a173b6c0bb5db6d3f2a731ae6a5fab4a1808a`. Its descriptor retains definition SHA-256 `62bc6dee9f86785dcd05c399a75ffba562632e89730d291c64f48ad269cc00df`, owner postgres, SECURITY DEFINER true, volatility `v`, and the full proconfig `['search_path=pg_catalog, public, pg_temp']`. The independent review reports the predecessor body SHA-256 `ea3f215555523082142f0506ad3e40be28279d3b79778f7d9b05ed691f4c4c91`. That body-match conclusion is attributed to that review, not regraded as new native evidence here.

The preserved expanded ACL has two nongrantable EXECUTE entries. Both grantors are the string `16384`; grantees are `16384` and `16445`. No named mapping is inferred. Named-role and default-ACL acceptance remain unestablished. The encoding correction supplies no reason to edit function bodies, proconfig, ownership, ACLs, roles or grants.

## Research does not admit native work

The target PostgreSQL 17.6 image remains pinned. The R6 restoration completion and never-admitted apply17 status are task context supported by the independent finding, not new live observations. The failed R5 target stays permanently fenced. R7 history-author preparation remains separate under `sol-a0-migration-history-literal-correction-20261016-round1`.

Only new research documents and a new private source/custody directory are written. No subject imports, tests, native parser, SQL, psql, sockets, Docker, manager, flock, archive parsing, admissions, dependency changes, target queries, push, PR, main change or release occur. No native diagnostic execution is proposed. No guard or test is implemented here, so no mutation campaign runs. Source-text comparisons cannot establish runtime parser behavior, installed binary identity, commit outcome, durability, privileges or later stored-function behavior. This is technical source analysis, not operational approval.
