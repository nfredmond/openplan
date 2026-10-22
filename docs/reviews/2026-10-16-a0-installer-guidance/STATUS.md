# Installer guidance is implemented; independent review remains

October 16, 2026. This bounded T1 increment adds a read-only, user-invoked
installation inspector. Its parent is the reviewed CLI registry at
`bbbcfcc56e293cbf5fad105d0bfaf3ce94da1ffc`. It changes only the new helper,
new command, focused test and this evidence directory in `t3-e04f0f77`.
The preview's exact607 application and other agents' files remain unchanged.

The helper accepts an operator's explicit npm declaration and absolute global
package root. It checks the Linux `prefix/lib/node_modules` layout, bounded
regular package metadata, provider package name and the package's exact binary
entry. Linked package metadata, escaping entries, unrelated binaries, unsupported
layouts and unknown installers produce no update command. It does not infer
installer ownership from a directory name alone. The result says
`operator_declared_entry_verified`; it does not authenticate the declaration.

The returned command is an inert executable/argument object. It names npm,
binds `--prefix` to the inspected installation, and targets the existing tested
version for that provider. It never chooses `latest`. The metadata's package
version remains separate from the registry's tested version. Package metadata
is not an observed native binary version or compatibility result.

The inspector runs no binary, npm process, model, account, network request or
update. It reads no provider profile or connection file. Only a person can run
the suggested command after confirming ownership and stopping affected sessions.
Other installers and platforms remain explicitly unknown or unsupported.

From the repository, an operator can request help with:

```sh
node workers/planner_agent_connector/installer-guidance-cli.mjs --help
```

For an npm-owned installation, the command takes `--provider`, `--binary`,
`--installer npm` and the root obtained separately with `npm root --global`.
It prints the installation prefix only inside the structured command arguments,
where the person needs it. Invalid command arguments emit a fixed refusal,
without raw errors or paths. The tool does not run the returned command.

The package identities follow the providers' official installation guidance:
[Codex](https://github.com/openai/codex),
[Claude Code](https://code.claude.com/docs/en/setup#install-with-npm) and
[OpenCode](https://opencode.ai/docs/). Binding a global command to a prefix follows
[npm's global installation layout](https://docs.npmjs.com/cli/v11/commands/npm-install/#global).
The version pins come from OpenPlan's reviewed registry, not these current docs.

## Focused checks detect their intended faults

The final baseline and restored runs pass eight named tests with zero skips.
They cover all three provider package names and version pins, explicit installer
and platform declarations, prefix binding, binary ownership, entry escape,
bounded metadata, metadata symlinks and strict CLI arguments. Synthetic binary
fixtures are executable shell files; the baseline's before/after file inventory
stays equal. No installed provider binary runs.

Two harmless source comments survive. Thirteen targeted variants fail the named
assertion, with exact source restoration. Twelve detect changed behavior:
`latest`, omitted prefix, unsupported layout, inferred installer, wrong platform,
unrelated binary, escaped entry, crossed provider metadata, metadata symlink,
duplicate arguments, unknown arguments and execution of the synthetic binary.
The size-check variant changes the refusal diagnostic; a secondary read-size
guard still refuses. It is diagnostic sensitivity, not an acceptance bypass.

The mutation driver requires a nonzero exit, the intended failing test name and
`ERR_ASSERTION`. Import errors or generic runner failures cannot count as kills.
Every variant restores exact bytes in `finally`. Forced process termination or
host loss during a mutation remains outside that restoration claim.

Checks run serially under the shared compiler flock, in a 1 GiB cgroup with zero
swap, CPU 50 percent and a 256 MiB Node heap. The final campaign takes 4.127 seconds;
the manager reports 43.5 MiB peak memory. Node syntax and repository whitespace
checks pass. No dependency installation, broad suite or build runs.

The first test request omits the systemd working directory and fails before
finding the test file. Its log remains. A corrected invocation passes. The first
successful campaign and its exact sources remain privately retained. Parent
inspection then identifies that an unqualified npm command could update another
prefix; this candidate adds the prefix binding and two controls before review.
Those earlier results do not establish the final prefix behavior.

Private evidence is in
`/home/nathaniel/.local/state/openplan/a0-installer-guidance-20261016`.
[Controls](controls.json) retain selected assertions, log hashes and source pins.

## T1 remains partial

The main connector and planner panel do not yet consume this new inspector.
Independent source review, integration, installed-CLI acceptance and the broader
T1 usage-limit, recorded-frame and desktop/390px outcomes remain open. This
candidate does not update an installed binary or widen accepted native versions.
It establishes neither actual npm ownership beyond the explicit declaration nor
update availability, native compatibility, provider access, browser usefulness,
hostile filesystem-race protection, hosted operation or release acceptance.
