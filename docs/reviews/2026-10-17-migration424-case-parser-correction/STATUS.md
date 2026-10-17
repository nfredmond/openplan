# Migration 424 parser correction passes the isolated compiler check

The corrected migration compiles on the same immutable PostgreSQL 17.6.1.156 image used by CI. The comment-only variant survives, the fixed and restored full migrations compile, and the original fails with SQLSTATE 42601 and the exact saved parser message. The new fixture confirms subtransaction and outer rollback. Full predecessor restore and production guard behavior remain unassessed.

## The CI failure and source correction

PR332 restore-drill run 39016643937 fails at migration 424. PostgreSQL reports syntax error at end of input at the first THEN within the bbox guard's unparenthesized SQL CASE. Migration 425 is not reached. The original failed run remains failed. [CI job](https://github.com/nfredmond/openplan/actions/runs/39016643937/job/117350013879).

The correction inserts two parentheses around CASE at migration line 58. It preserves the intended 180/90 threshold operands, trigger, role grants and data-write scope. A later migration cannot repair this earlier compilation failure, so the unreleased candidate is corrected in place. Original source and review packets remain historical evidence. The original 6,500-byte source hashes to b083241e879913afe93e848f4bb81191acf5439569c8226a86e14852bf3ee002; the corrected 6,502-byte source hashes to 1c0e7cf422b0668d8ebcb9ef29df87a88f3ee6e69498b9c88012bdaf90c42947.

PostgreSQL 17.6 reads an IF condition until a THEN at parenthesis depth zero. Enclosing CASE keeps its inner THEN below that depth. The independent source review accepts this bounded correction. Native validation below separately establishes compilation. [REL_17_6 parser source](https://github.com/postgres/postgres/blob/REL_17_6/src/pl/plpgsql/src/pl_gram.y), [independent source review](INDEPENDENT_SOURCE_REVIEW.md).

## What the native fixture establishes

TEST04 runs once in a new container and fresh initdb directory. It opens no network connection or listening server. Its only host bind is the new read-only fixture input directory. The inherited healthcheck is disabled. The image has no declared volumes. No A0, budget, demo, source or hosted database is contacted.

The fixture creates three NOLOGIN roles and one empty synthetic table within an outer transaction. It executes each full migration under a nested exception block. Successful compilation raises the test's ZP001 rollback sentinel; the old source must produce 42601 with the exact C-locale message. The four ordered notices and both completion and rollback notices are retained. TEST04 exits 0, the new container exits 0 without OOM, and owned removal returns 0. The completed controller exits its shared compiler-file context. This does not claim that nobody else acquires that file afterward.

The controller service and container each have512 MiB memory, zero swap, CPU 50% and 64-task limits. These are separate ceilings, not one combined 512 MiB cap. Service runtime is 1.697 seconds, CPU 129 milliseconds, reported rounded peak 18.8M and swap 0B. Container peak and aggregate host memory are not captured. Docker daemon/runtime overhead remains outside both caps. The container has its own 120-second timeout with 2-second kill escalation; the service limit is 180 seconds. Native stdout and stderr each have a 1 MiB retention/refusal bound. Parent manager streams are not independently byte capped.

[Native result](NATIVE_RESULT.json) records the actual invocation, source and stream hashes, exact case messages and limits. [Exact compiler input encoded as UTF8 JSON](compiler-input.json) and [executed shell source](container-compile.sh) preserve the executed test inputs. The JSON text decodes to the exact compiler.sql bytes, including its final blank-line command delimiter. The shell's preparation-only comment describes its original snapshot; this result records its later exact TEST04 execution. EVIDENCE.json binds the four full migration inputs. The old input comes from commit0895af82; fixed and restored inputs equal the corrected migration. The harmless input changes only the opening comment.

## Earlier harness failures remain failed

TEST01 uses an unsupported docker start option. Its container stays created and PostgreSQL never starts. TEST02 reaches the image's BusyBox timeout, which rejects GNU long options before PostgreSQL starts. Each owned container is removed. TEST03 runs PostgreSQL and exits 0, but the required notices are absent. The strict reader rejects it. No case acceptance is inferred from that zero exit.

The corrections remove the unsupported Docker option, use BusyBox's declared short options, and add explicit log_min_messages=notice to the new fixture's shell. Single-user mode uses DestDebug, while client notice delivery requires DestRemote; the default server threshold is WARNING. The NOTICE setting makes the planned producer visible without relaxing the reader or changing SQL expectations. Each change receives a distinct one-use ROOT authority and new test identity. Old authorities are not reused. All three failures and raw streams remain private and separately sealed. [Docker start options](https://docs.docker.com/reference/cli/docker/container/start/), [PostgreSQL logging](https://www.postgresql.org/docs/17/runtime-config-logging.html), [REL_17_6 message routing](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/utils/error/elog.c).

## Evidence still required

The full restore CI must run on the corrected branch. This test does not apply migrations 1–423, exercise real retained rows or other triggers, establish RLS/Auth behavior, preserve production migration history, or replace the selected-history predecessor proof. Single-user implicit superuser powers establish no production authorization. No browser, artifact, practitioner, hosted or release acceptance follows. Existing A0 failures and all full V1/scientific holds remain unchanged. No migration is applied to hosted services by this work.
