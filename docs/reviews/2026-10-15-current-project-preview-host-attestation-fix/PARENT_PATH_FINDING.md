# Parent finds a second attestation issue before host execution

The host-context runner candidate `384314aa2f7aff8a3c0e3093f52e1d164d63f423`
remains unexecuted. Parent readback confirms its 23 manifest, file and absence
checks. The parent reads its complete report, recipe and runner. Its context
change addresses process visibility, but the unchanged attestor has another
incorrect expectation for the actual npm-launched server.

[Read-only process comparison](parent-path-diagnosis.json) finds one mismatch
among 22 expected environment keys: `PATH`. Every sealed application value
matches. npm adds the package's and ancestors' `node_modules/.bin` directories
and its node-gyp directory before the supplied `/usr/bin:/bin`. The existing
attestor compares the child server to the pre-npm environment and would refuse
at `attest-process-environment`. The parent does not execute it to reproduce a
failure already established by the exact comparison.

The installed primary implementation is
`/usr/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/set-path.js`.
The parent reads that source. It walks project ancestors through the filesystem
root, appends its node-gyp-bin path, then the original PATH. The evidence pins
those source bytes and the actual process comparison. No application environment
values or credentials are published. Actual-helper parity and fault controls
remain correction work.

Both old runners, original attestor, v3 sealed inputs, accepted build and web
invocation remain unchanged. The first wrapped attestation failure remains
retained. No new build, restart or actual host attestation occurs.

The next bounded correction must retain exact PATH enforcement. It must derive
the npm-expanded value from the fixed application path and inspected, pinned npm
implementation, without trusting an arbitrary observed PATH or skipping that key.
A new versioned attestor and host runner must preserve the other identity,
environment, resource, input, HTTP, preservation and exclusive-receipt checks.
The parent will review the context and PATH corrections together before execution.
The first host-runner candidate and its controls remain historical preparation
evidence, not runtime acceptance.
