# Supervise the existing synthesis workers

This Linux user-service recipe runs the existing preparation or execution
worker. It does not create an execution allowance, replace an uncertain attempt,
approve a result or publish a record. Apply the migrations and configure the
worker described in the [runbook](RUNBOOK.md#explicit-synthesis-execution-queue).

Use Node 24, systemd user services, installed application dependencies and a
private environment file for the intended database. The service runs as the
operator who installs it. Do not use a different account or journal root to
bypass a pending attempt. Back up the database, private configuration and journals
together. This recipe is not a production Supabase installation.

## Generate and inspect a unit

From the nested `openplan/` package, identify the private environment file and
existing journal root. The generator checks ownership and permissions without
reading or printing credentials. It requires an existing directory with no
group/other access and an environment file with the same restriction.

For execution, the default journal root used by the existing CLI is
`~/.local/state/openplan/synthesis-generation-worker`. If your workers already use
another root, supply that exact root instead. Creating an empty replacement is
not recovery.

```bash
synthesis_unit_dir=$(mktemp -d)
mkdir -p "$HOME/.local/state/openplan/synthesis-generation-worker"
chmod 700 "$HOME/.local/state/openplan/synthesis-generation-worker"
chmod 600 .env.local
node scripts/ops/synthesis-service-unit.mjs \
  --worker execution --app-dir "$PWD" --env-file "$PWD/.env.local" \
  --state-dir "$HOME/.local/state/openplan/synthesis-generation-worker" \
  > "$synthesis_unit_dir/openplan-synthesis-execution.service"
systemd-analyze --user verify "$synthesis_unit_dir/openplan-synthesis-execution.service"
cat "$synthesis_unit_dir/openplan-synthesis-execution.service"
```

For preparation, use `--worker preparation`, its existing
`OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR` directory, and the filename
`openplan-synthesis-preparation.service`. Its default root is
`~/.local/state/openplan/synthesis-preparation-worker`.

The generated unit pins the resolved application, Node and environment-file
paths. Spaces, quotes, dollar signs and systemd percent specifiers remain literal.
Application paths ending in whitespace or a backslash are refused. The selected
journal directory is set in the process environment, which takes precedence over
the file's value. Confirm it matches existing worker commands.

The initial limits are 1 GiB MemoryHigh, 2 GiB MemoryMax and no swap. Review these
against the host and measured workload. They limit the service, not a software
entitlement. A memory kill is an interruption, not permission to repeat a call.
Three rapid failed starts exhaust the five-minute start limit. Continuous workers
also retry reported pass failures internally; an active service is not evidence
that its database or provider is healthy.

## Install, start and inspect

After reviewing the generated paths and pending work:

```bash
mkdir -p "$HOME/.config/systemd/user"
install -m 600 "$synthesis_unit_dir/openplan-synthesis-execution.service" \
  "$HOME/.config/systemd/user/openplan-synthesis-execution.service"
systemctl --user daemon-reload
systemctl --user enable --now openplan-synthesis-execution.service
systemctl --user status openplan-synthesis-execution.service
journalctl --user -u openplan-synthesis-execution.service -n 50
```

Inspect the saved request and task history in OpenPlan as well as the log.
An execution pass can leave unconfirmed schedules or wrap its cursor without
draining all work. Do not run an extra worker against a new directory to clear a
warning. The preparation service uses the same installation sequence with its
own unit name.

User-service enablement starts the worker when that user's manager starts.
Unattended startup before login requires the host administrator's chosen user
manager and lingering policy. This generator does not change that policy.
Boot and power-loss acceptance remain separate checks on the actual host.

## Stop and recover

```bash
systemctl --user stop openplan-synthesis-execution.service
systemctl --user show openplan-synthesis-execution.service \
  -p ActiveState -p MainPID -p Result -p NRestarts
```

An explicit stop does not trigger automatic restart. The service sends SIGTERM
to its process group and allows 30 seconds before forced termination. Keep the
same journals after either kind of stop. Inspect unresolved requests before
restarting. Fix a repeated startup failure before using `reset-failed` and
starting the unit again.

For an application upgrade, stop the service, prepare and verify a separate
checkout, regenerate the unit against that checkout with the same environment
and journal paths, install it, reload the user manager and start it. Do not
replace source files while that checkout's worker runs. Rollback retains the
database/migration compatibility and journal requirements of the release.

To stop automatic user-manager startup, use `systemctl --user disable --now`
with the unit name. Disabling the service does not remove its journals.

## Evidence boundary

The initial disposable supervisor probe verifies literal paths, one automatic
restart after SIGKILL and an explicit stop that stays inactive. It runs a synthetic
process without database or provider access. It does not prove real worker
dispatch, reboot, host power-loss recovery, unattended commissioning or capacity.
The existing worker's separate queue and interruption records remain applicable
only to their tested processes and inputs.

Systemd behavior follows its upstream
[service reference](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml)
and [execution-environment reference](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml).
The local probe uses systemd 259 and Node 24.21.0. Verify your host's units before
starting them.
