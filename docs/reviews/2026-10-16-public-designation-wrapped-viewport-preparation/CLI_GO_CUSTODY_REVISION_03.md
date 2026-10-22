# CLI custody source revision 03

This packet prepares the two custody corrections requested by ROOT. It grants no operation. No runner, manager, CLI, lock, namespace, application import, runner syntax parser, compile, test or subject control ran. Shell file metadata, byte hashes, diffs and JSON data formatting support this source packet. The six application files, four tests, SQL review template and 425 migrations remain frozen. The earlier Bun bootstrap failure remains failed.

## Custody and exact source

The assigned checkout remains `t3-dd1f8bad`, branch `t3/public-designation-wrapped-viewport-design`, HEAD `d264d69149ae2f9d589840e5a543b798ae4718ec`. The live T3 catalog identifies this delegated thread and `gpt-6.1-sol`. The injected runtime identifies high reasoning. The catalog's provider default option reports low; that option is not evidence of this run's reasoning. Other active ROOT, A0 and M1 threads remain separate owners. No nested agent was created.

Before revising the runner, this lane preserved the exact previous four packet files, previous packet hash manifest, public request, public supersession, small static metadata and modes under:

`/home/nathaniel/.local/state/openplan/public-designation-wrapped-viewport-preparation-20261016/cli-go-source-preparation-02/superseded-runner-preparation-01/`

That archive contains only this lane's existing preparation files. Original request 02, disabled template 02 and public supersession remain historical and unchanged. The previous runner hash is `f56ebff3ee89920cfe1c1fb936e8890d7d6d91be27d47578c4185937a4a216a4`; previous request hash is `b4a13bd49746232e7fc4bd27565c0e8256181944ad28bd32b78fbec776fedf56`.

The full revised source and request are available, without execution:

- Private `cli-go-source-preparation-02/packet/runner.py`, SHA-256 `2729cd68e5d0e42ac11105dea411765cb5a441e8dba668ac9388480de5fbd9b2`.
- [Full new request](CLI_GO_REQUEST_03.json), also private `packet/request-03.json`, SHA-256 `e3f1c289dce5936fd182110a6238c49399c812c28eb08d13b68cd0560175c4c4`.
- Private `packet/GRANT_TEMPLATE_03.json` is disabled, SHA-256 `db37b97db8e09f8e3eb0a218e47c5ed2f397f9effd121d212197fd8a3b442136`. Its future grant location is `packet/GRANT-03.json`; no such grant is created.
- Private `packet/runner-03.diff` contains the full source delta from the preserved runner, SHA-256 `71d825e0d17ded0ee5dfe2b67f37314ea5bf4ff1d04f9352da60094ed630c90a`.
- Private `packet/packet-03.sha256` and `source-static-03.txt` contain byte pins and the final metadata readback. These are preparation data, not a runner result.

The frozen application/test manifest remains `1a20624ae7ddd4edc5da0c03c6a98b258266b038b1fc26238ee2bb689a654af0`. The SQL review template remains `d55e046384efd84cb5066d8a4a0e504ad649a48cec0af3a25a6b41d2506d0332`. No SQL or migration authoring occurs in this revision.

## Exception precedence and recording

| Situation | Primary outcome | Independent attempts and retained evidence |
| --- | --- | --- |
| Intent, Popen, PID receipt, selector, registration, read, capture wait or deadline fails | Preserve the first exception object, class, message and traceback | Returned PID is assigned immediately after Popen returns. PID receipt precedes stream setup. Setup/capture share the protected block. Partial buffers and observed-prefix counters remain available. |
| Primary failure plus kill, wait, drain, close or record failure | Reraise the original exception with operation-specific secondary details | Poll, verified own-session kill at most once if needed, one-second wait and separate one-second drain, selector close, each pipe close, each raw stream and terminal record are independently attempted. Drain failure cannot skip later closes or raw records. |
| Cleanup or record failure without a capture exception | Explicit nonzero helper failure | A new failure carries every secondary operation, class, message and traceback. It cannot return a successful capture. |
| Popen attempted but no returned process object or no observed status | `UNKNOWN`, null exit code | No invented PID, exit zero or signal authority. If no returned process identifies ownership, no signal is sent. |
| stdout raw write fails | Failure remains explicit | stderr raw write and terminal record are still attempted. The reverse also holds. Each receipt independently attempts descriptor closes after write/fsync failure. |
| Terminal write or its later close fails | Helper fails; no self-attested terminal durability | The write failure becomes secondary to a prior primary, or causes failure by itself. The existing terminal bytes cannot certify that their own final close succeeded. Phase and parent outcomes remain necessary. Missing terminal is ROOT STOP. |
| Phase failure record or parent lock close fails | Original phase/parent exception wins | Each failure is retained separately. Parent finalization attempts an additional failure record and exits nonzero. Closing the lock never proves unit liveness. |

Every bounded intent/process/exit record carries the exact argv, cwd, timeout and role. Exit records retain actual returned PID, actual observed return code or UNKNOWN, kill-attempt/return flags, retained bytes/hash, observed-prefix bytes/hash, EOF state, primary failure and secondary failures known before terminal writing. Observed bytes mean bytes actually read, not the unread total emitted by a child.

File and parent-directory fsync are attempted. Storage failure may prevent raw or terminal evidence from becoming durable. The runner does not promise hard bounded filesystem I/O, survival of interpreter termination, allocation failure or storage loss. ROOT must stop on missing, partial, contradictory or unknown custody. No earlier successful CLI evidence is regraded by this source finding.

## PID and invocation join

| Role | Actual measurement | Join and limit |
| --- | --- | --- |
| Manager client, outer PID namespace | `Popen(systemd-run).pid`, recorded immediately in `manager-client.process.json` | This PID belongs to the client, not the unit entry process or a measured systemd MainPID. Manager wait stdout/stderr are retained without `--quiet`; suffix text has no invocation authority. |
| Unit entry, outer PID namespace | Same pinned runner `--manager-entry` reads its actual PID, UID, PID/net/user namespaces, unified cgroup and native unit | Reads only actual inherited `INVOCATION_ID`, requiring nonzero 32 lowercase hex. Requires the exact unit cgroup and the completed manager-client process receipt in the same PID namespace. Writes `manager-entry.json` before execve. No post-show query or extra manager runs. |
| Inner process, fresh PID namespace | Inner independently reads its actual PID, UID, namespaces, cgroup, native unit, capabilities and NoNewPrivs | Requires a different PID namespace, unshared net, exact entry cgroup/unit, zero effective/permitted/inheritable/ambient caps, NoNewPrivs=1 and exact resource limits. Uses the hash-joined read-only entry receipt as invocation evidence. It does not claim an inherited inner INV environment value or equal entry/inner PIDs or UIDs. |
| Five possible CLI children, inner namespace | Each actual returned `Popen` PID is recorded before selector setup; successful generation terminal lists the five returned PIDs | Every command receipt joins the actual invocation, entry receipt hash and measured entry/inner context. Fewer receipts after failure remain fewer; missing PIDs are never invented. |

The runtime receipt is mounted read-only at both `/manager-entry.json` and `/work/manager-entry.json`. The manager-client process receipt also has a read-only `/work` overlay. The inner admission checks those mount options. This avoids an admitted writable alias to the invocation receipt. The private runtime itself is the only general writable mount; `/dev/null` is the only device.

The parent writes the manager-client process receipt after Popen returns. An unusually fast entry could read before that receipt is complete. The chosen fail-closed behavior is to stop on missing/partial input, without polling, retrying or running a CLI. Unit/cgroup visibility that cannot establish the exact join also stops. Those relationships remain unobserved until a separate grant.

## Exact dispatch proposal and bounds

The [new request](CLI_GO_REQUEST_03.json) contains full `outerArgv`, `managerArgv`, `namespaceArgv`, environments, read-only binds and grant fields. Outer invocation is fixed `/usr/bin/python3 -I -S -B` with this exact host runner and `--grant` pointing to future `GRANT-03.json`. The single manager starts that same fixed Python/runner with `--manager-entry`. The entry performs one execve of the reviewed bwrap argv. No command substitution, wrapper or alternate tool path is selected.

Only exact official Go CLI 2.75.0 bytes `ede7713ac26a4e8bd8ebdfad93676d9652b254d4d6bc163a003a6493f4b3302b`, 95,027,384 bytes, mode 0700, UID/GID 1000 are selected. This lane independently reread metadata and hashed bytes without executing them. ROOT's PT_INTERP-free ELF metadata remains attributed to ROOT. No installed CLI support or project version change is implied.

Bounds remain one unit, 59 seconds active plus one second stop allowance, 256 MiB memory, zero swap, CPU 50%, TasksMax 64, core zero, 128 KiB per stream and RLIMIT_FSIZE, GOMAXPROCS 2, existing compiler file opened read-only with one nonblocking exclusive lock, manager-client capture 70 seconds and parent alarm 75 seconds. Each CLI capture has at most ten seconds, then independent one-second wait and one-second drain cleanup attempts. The manager subject bound remains the outer stop. Filesystem I/O is not given a hard deadline. The planned artifact scope is 8 MiB, not an enforced aggregate filesystem quota.

The only commands remain version, top help, migration help, migration-new help, then one `migration new public_designation_query_viewport`. There are at most five actual CLI invocations and one generation, no retry. The minimal project starts with an empty migrations directory. The CLI's actual returned filename is inspected and compared with `20261017030608_land_use_plan_publication_transaction.sql`. No filename, slot, copy, rename, SQL writing or application is authorized here.

## Static traces and control limits

These are manual source traces, not executed controls:

1. Popen returns a PID; PID-record fsync fails. The protected capture saves that failure, recovers both owned pipe objects, attempts owned-session cleanup, each raw record and terminal. It reraises the original fsync failure, with cleanup/record errors secondary. If persistence is unusable, absent records remain absent.
2. Selector registration fails; verified kill also fails; stdout close fails. Registration remains primary. Wait and drain are separately attempted, stderr close and both raw streams still receive their attempts, then terminal receives an attempt. No zero exit is substituted for unknown wait state.
3. Capture exits zero; stdout raw persistence fails. stderr raw persistence and terminal are attempted. A terminal recording exit zero cannot turn the helper green because secondary failures force a raised failure. Parent/inner phase failure remains explicit.
4. Terminal construction/write/close fails. The whole terminal operation is protected. A prior primary wins; otherwise the terminal failure causes nonzero. The terminal may be missing or partial and ROOT stops.
5. Inherited invocation is missing/zero/malformed, cgroup unit differs, or manager-client receipt is incomplete. Entry fails before execve and first CLI. Failure receipt is attempted without replacing that primary if its own write fails.
6. Entry succeeds but inner cgroup/capability/namespace/read-only admission fails. Inner failure is recorded if possible, then exits without CLI. It does not invent an invocation or silently loosen admission.
7. All five commands return known zero status and generation passes. Only actual returned PIDs populate the terminal. This is a prospective path. No success is claimed from this source trace.

The retained source control plan remains prospective. A later separately authorized control window would need a harmless survivor, named wrong behavior, intended failure reason and finally restoration for every changed guard. Suggested custody wrong cases are setup-registration failure, kill/close failures after a primary, one raw-write failure, terminal-write failure, missing invocation and mismatched cgroup. None is executed or bundled into the proposed CLI generation grant. Static inspection cannot establish timeout enforcement, durable storage, namespace support, installed Python/bwrap closure, actual invocation inheritance, CLI behavior, native SQL/RLS or desktop/390px identified-build behavior.

| Prospective control | Harmless survivor | Named wrong behavior and intended refusal | Finally and blind category |
| --- | --- | --- | --- |
| Primary and cleanup precedence | Change receipt JSON key ordering without changing fields | `replace-primary-with-close`: substitute a close exception after a registration failure; expected refusal detects wrong primary class/message and missing registration traceback | Restore exact runner bytes in a finally path and compare pins. Pure injected operations do not prove real OS cleanup. |
| Independent raw/terminal attempts | Change retained text bytes while keeping declared counters/hash consistent | `skip-stderr-after-stdout-write-failure`: force stdout persistence failure and omit stderr/terminal attempts; expected refusal detects missing operation attempts and helper success if fabricated | Restore exact source and remove only control-owned scratch files in finally. An operation-attempt recorder does not establish disk durability. |
| Unknown status and owned kill | Use a different positive synthetic returned PID in a pure operation adapter | `unknown-to-zero` and `signal-without-owned-session`: erase UNKNOWN or signal without matching owned session; expected refusal detects invented status or unauthorized target operation | Restore source/adapters in finally; no real process is signaled by a pure control. Real PID/session races remain native evidence. |
| Invocation and PID roles | Reorder JSON keys and use distinct valid synthetic entry/inner namespace identifiers | `invent-invocation` or `entry-equals-inner`: accept missing inherited invocation or relabel an entry PID as inner; expected refusal detects absent provenance, missing independently measured context or incorrect role join | Restore exact fixtures/source in finally. Synthetic invocation data cannot prove actual systemd inheritance or namespace identity. |

These controls require a separate finite authorization and concrete assertions before execution. They are not implied permission to import the runner or start a test harness now.

ROOT alone decides the next finite CLI grant. No actual grant, runtime directory or attempt is created by preparation. Full V1, native, browser, release and preview holds remain unchanged.
