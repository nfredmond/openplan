# Configured connector installation inspection

October 16, 2026. Local candidate for roadmap A0b and milestone T1. Independent
review and native acceptance remain open. No update command runs.

## Change and ownership

The ordinary connector now accepts `install-check --config PATH`. It uses the
saved provider and binary path, then calls the reviewed installation inspector.
The command returns before connector locks, polling, native account inspection
or model work. It prints guidance without the connection token or profile path.
Legacy version-one connections keep their Codex provider interpretation.

An operator may supply `--installer npm --npm-root PATH` together. The command
keeps `npm` as a literal declaration and resolves the supplied path. Other
declarations, incomplete pairs, duplicate flags and unknown flags refuse.
Without a declaration, the installer stays unknown and no command is offered.
The existing inspector checks package metadata and the selected binary entry.
It returns an inert npm command pinned to OpenPlan's tested version and the
inspected global prefix. The operator reviews and executes that command.

Root resumes the three existing changes in the owned
`t3/a0-tested-cli-version-registry` worktree at base
`82d33de8d3d2d901e2feddad757ee9aaaec9daba`. Ownership covers `connector.mjs`, its
new focused test, the README subsection and this new review packet. The three
unrelated canonical entries remain intact. Separate agents own usage-limit and
native transport corrections. No application source, database, provider or
preview changes occur here.

The product-direction check passes with its existing dated review reminders.
This work continues the tested-version lane. It does not alter product scope.

## Checks and controls

The final focused run passes 15 tests, with no failures or skips. It includes
the three new command cases, four existing connector CLI cases and eight
installation-inspector cases. Tests invoke the real Node command against private
synthetic connections and package entries. Their shell binaries leave a marker
if executed. Content and mode inventories include directories and files.
The ordinary CLI tests also retain their bounded local HTTP fixture.

The command cases cover all three saved providers, exact pinned npm arguments,
token/profile disclosure, file changes, unknown installers, legacy Codex,
incomplete or unsupported declarations, duplicate flags and write flags.
Help text discloses the read-only boundary. No native provider executable runs
in the unmodified cases.

The control campaign has 14 trials. Baseline, harmless comment and restored
source pass all three new cases. Eleven source faults fail selected assertions:

| Fault | Observed assertion |
| --- | --- |
| Remove command enrollment | Configured command fails with `connector_command_invalid`. |
| Resolve installer declaration as a path | Configured command fails with `connector_arguments_invalid`. |
| Replace the saved provider with Codex | Saved Claude provider differs from returned provider. |
| Print the saved connection | Connection token enters guidance. |
| Infer npm ownership and root | Undeclared installer returns npm instead of unknown. |
| Remove paired-declaration check | Incomplete declaration unexpectedly succeeds. |
| Allow unsupported declaration | Unsupported declaration unexpectedly succeeds. |
| Allow unknown flags | `--update yes` unexpectedly succeeds. |
| Allow duplicate flags | Duplicate declaration unexpectedly succeeds. |
| Create a connector directory during inspection | Directory inventory changes. |
| Remove read-only help disclosure | Expected disclosure is absent. |

Each fault restores the saved source in `finally`. Final connector and test
bytes match their saved hashes. The test source stays unchanged throughout the
campaign. Node syntax checks and `git diff --check` also pass.

Both runs use one worker, the shared compiler flock, a 1 GiB memory cap, zero
swap and 50 percent CPU. The Node heap limit is 256 MiB. The manager reports
55.6 MiB peak for the final focused run and 57.6 MiB for controls. No Vitest,
dependency cache, full suite, build or long-running service runs.

`controls.json` records each trial's exit, selected assertion and log hash.
`verification.json` binds source files, commands, unit identities and the final
completion output. Private proof lives under
`/home/nathaniel/.local/state/openplan/a0-installer-cli-integration-20261016`.
The final focused output file contains its completion chunk and aggregate counts;
the first two test output lines remain in parent tool activity. The earlier
focused run remains retained and predates the added directory inventory and
write-flag value assertion.

## Evidence limits

Synthetic package metadata does not authenticate installer ownership. A matching
entry and a declared npm installation do not establish native compatibility,
account access, model availability or successful updating. Tests do not observe
every filesystem read or network syscall at the kernel boundary. They do not
cover concurrent hostile filesystem changes, browser presentation or other
installers and platforms. No installed provider recording or account allowance
is used. T1, T15 and full v1 remain incomplete.

This checkpoint has no push, PR, merge, migration, hosted operation or release.
Independent review precedes integration of this source candidate.
