# Local artifact filesystem containment

October 8, 2026. Base `6e53cd42`. The separate containment checkout does not
serve the active T3 preview.

A real temporary-filesystem probe against the base reads synthetic foreign-run
bytes through a symlink located inside the authorized run directory. The prior
resolver checks path text, but `readFile` follows the link. The download route
also performs its own direct read after the same lexical check. No user data
was accessed in the reproduction.

The shared reader now resolves the configured root, authorized run directory and
file target before reading bytes. A run directory must resolve to its expected
location beneath the configured root. A file target must stay inside that run.
Downloads use this reader too. The final read uses `O_NOFOLLOW` to refuse a
final-component link substituted after resolution. An explicitly configured
root alias remains supported, as do links whose targets stay in the same run.
Storage authorization and remote-URL behavior are unchanged.

Thirty-five focused tests pass. Four adjacent artifact, agreement, evidence-packet
and storage-reference suites pass another 56 tests. Six use actual temporary files and links for
ordinary reads, an internal alias, a foreign file link, a foreign directory
link, a redirected run directory, a configured root alias and an out-of-root
scope. The route test checks refusal before bytes are read. Its authentication
and storage dependencies remain mocked. Targeted ESLint passes.

Harmless-comment and restored controls pass. Removing target containment makes
foreign-file, nested-directory and route refusal cases fail. Removing run-root
identity admits a redirected run directory and fails that case. Bypassing the
shared reader in the download route returns 200 instead of the expected 404.
The results are retained in `controls.json`.

The first test invocation omitted the new filesystem test because its creation
used the wrong working directory. The two existing suites also exposed an
incomplete `realpath` mock. Both were corrected before the reported 35-test run.
No passing claim relies on the first invocation.

This evidence covers Linux filesystem reads and component/route behavior. It
does not establish browser acceptance, other operating systems, resistance to
concurrent hostile replacement of parent directories, worker write containment,
deployment/attempt filesystem ownership or scientific acceptance. Those remain
separate requirements. The configured worker root remains operator-controlled.

The first standalone TypeScript check reaches the default 4 GiB heap limit and
exits 134. A separate retry uses a 6 GiB heap under a 7 GiB service memory cap,
with two CPUs and core dumps disabled. It completes with exit 0 in 57.496 seconds, using 5.1 GiB peak memory and no
swap. Unit `openplan-local-containment-types-20261008.service`, invocation
`4fad2549346b477b874aeac8e96c385e`, identifies that completed check.
