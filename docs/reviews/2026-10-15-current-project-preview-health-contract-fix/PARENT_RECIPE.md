# Prepared v2 recipe resolves R1 and R2; no application step has run

The parent must finish a new independent review before consuming any one-shot
intent. Compare the public manifest with the installed private files first.
Retain sole operational ownership. The REST transition is already complete;
do not repeat it, recreate helpers or recapture a source anchor.

[run_stage_v2.sh](run_stage_v2.sh) is the fixed, reviewed POSIX entry point.
Its checksum check runs before systemd. The public manifest pins the checksum
list, runner and controller bytes. Keep that external manifest comparison;
the private checksum list alone is not an independent trust anchor.

```bash
APP_PACKET=/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v2

# Compare this checksum list's SHA-256 with the independently reviewed manifest.
sha256sum "$APP_PACKET/operation-files.sha256"
sha256sum --check --strict "$APP_PACKET/operation-files.sha256"

sh "$APP_PACKET/run_stage_v2.sh" active-check
sh "$APP_PACKET/run_stage_v2.sh" checkout
sh "$APP_PACKET/run_stage_v2.sh" build
sh "$APP_PACKET/run_stage_v2.sh" start

# Collect once after the actual web unit is ready. Start acceptance alone is insufficient.
sh "$APP_PACKET/run_stage_v2.sh" attest
```

The actual web unit remains
`openplan-current-project-preview-app-678-v1-web.service`.
`start` returns the status of systemd's asynchronous unit-creation request.
That status does not establish that Python or the web process stays running.
The attestor must acquire the actual unit, listener, process, environment,
resources, build bytes, health response and preservation checks afterward.
Build uses `--wait --pipe`; its nonzero controller status propagates through
POSIX `exec`. The composed fixture observes both the request and child result.

## One filesystem boundary surrounds the npm payload

`build` and `start` run the trusted, hash-pinned Python controller directly under
systemd. Build retains 10 GiB, zero swap and 50 percent CPU; start retains 512 MiB,
zero swap and 50 percent CPU. The command clears the interpreter environment before Python loads, using a
private HOME and fixed PATH. The controller performs the unchanged app/env/head,
source/active receipt, resource, intent and preservation checks before invoking
the actual inner bubblewrap command. No outer bubblewrap encloses these two
controllers. This avoids the reproduced namespace refusal without changing a
host protection or dropping npm confinement.

The controller has the user's ordinary filesystem and Docker permissions.
It is not protected by an outer read-only filesystem. Its reviewed fixed Python
paths, argv and code limit intended writes to the new candidate/execution root.
The installed controller and helpers remain trusted. This does not protect
against a controller defect, altered host tools or a hostile same-user actor.

The original helper CLI is never dispatched. Its imported readiness and
preservation functions read frozen bindings, inspect fixed Docker identities,
make fixed HTTP checks and use read-only SQL sessions. They do not call its
mutation/failure-record entry points. The v2 controller writes its own intents,
logs, receipts and result files in the new root. It does not append to old packets.

The actual npm payload still enters the unchanged inner constructor. It mounts
the whole host read-only, allows only owned candidate/execution/tmp writes,
mounts resolved dependencies and `.env.local` read-only, hides `/run`, supplies
private HOME/npm cache/log/XDG/tmp paths, disables build networking and retains
local network access at startup. These are kernel-enforced payload restrictions,
separate from the trusted controller's source-level write limits.

`active-check`, `checkout` and `attest` retain one outer read-only wrapper.
They do not launch an inner bubblewrap. The checkout controller uses a fixed
local shared/no-checkout clone into the absent new root, with durable intent
before creation. Its source object store remains read-only while the new clone
uses alternates. It detaches at the full app SHA and writes the environment and
dependency link only in that clone. No real checkout runs during preparation.

The corrected health comparison requires exactly `67828c17c4c2`, plus 419
expected migrations and latest `20261017000016`. Full checkout, environment,
build and process identity remain `67828c17c4c270529468eef1edd144e4a52b693a`.
Preserve all intent/partial state after a refusal or lost acknowledgement.
Do not retry creation, remove an intent, swap receipts or build the old `06a`.
No actual app execution, capacity, browser, native or human acceptance follows
from the fixture results.
