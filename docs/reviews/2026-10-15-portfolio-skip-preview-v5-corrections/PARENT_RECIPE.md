# Root executes one stage at a time after fresh independent ROUND2

This v5 packet corrects the accepted R1, R2 and R3 findings in review
`b037efc892359dcbd5350eb64438604610713ca5`. That review rejects v4. Do not use it
as an approval token. Root reads a new independent ROUND2 in full and resolves its
findings before any actual stage. Commit existence in the script checks syntax and
custody, not review content or approval. The application stays exactly APP49.

Private root:

```text
/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5
```

Use the [literal parent script](parent_recipe.sh). It pins the final checksum list
and v5 runner externally. It takes the accepted full ROUND2 commit and exactly one
stage. It uses the shared compiler lock, fixed user-bus environment and append-only
review admission. The runner reserves each request. No stage automatically starts
the next one. Read actual exit, unit invocation, resources, private diagnostics and
domain receipt before proceeding. Preserve every failure or lost acknowledgement.
Never delete a request or intent to retry.

The exact command shape is:

```bash
/bin/sh /home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections/parent_recipe.sh ACCEPTED_ROUND2_FULL_COMMIT STAGE
```

Both uppercase arguments are visible placeholders. Root replaces the first only
after accepting that fresh review. Replace STAGE with the next single name below.
Do not paste a loop or queue later commands before inspecting the current result.

| Order | Exact stage argument | Actual result root must inspect |
| --- | --- | --- |
| 1 | `preflight` | Original source fingerprint; complete V4 bytes/modes; earlier input, helper, Storage, global and protected old-state facts; actual host observation of old web; exclusive proposed names/ports; retained-dump hash; protected baseline and `preflight-ready.json`. No fresh dump or refreshed source oracle. |
| 2 | `restore` | Root allocates only the proposed new database, restores the retained 16,232,305-byte dump with one worker and transaction, preserves original 419 data/history/sequences/properties and copies Storage into the new root. Read exact new OID/owner and `clone-ready.json`. |
| 3 | `upgrade` | Exact candidate-17 bytes, original v2 body and locked 419 history guard. One transaction applies candidate and history. Fresh 420/latest-17, original 419 row digest, exact versions/body/stored SQL and both complete fixed CHECK definitions precede `upgrade-ready.json`. Different normalization stops for review. |
| 4 | `services` | Four NEW v5 Auth/REST/Storage/Kong IDs, images, environments, resources, networks, mounts, publications, DB bindings and actual readiness/CORS. REST uses the successful percent-encoded libpq URI. Old helpers remain unchanged. |
| 5 | `active-check` | Actual new-helper readiness plus original source/global/old helper/Storage/DB/packet and host-observed old web preservation. Outer read-only wrapper remains. |
| 6 | `checkout` | New local shared clone at exact APP49; clean app; sealed env; original 419 migrations plus exact 17; read-only donor; fresh `execution/checkout-ready.json`. No old cache or `.next` copy. Outer read-only wrapper remains. |
| 7 | `build` | One fresh webpack build, 6 GiB heap, 10 GiB memory, zero swap, CPU 50 percent, private caches, original inner wrapper and no build network. Actual generated 420 manifest, new BUILD_ID, inventory, tool/resource/input guards and accepted build result. |
| 8 | `start` | One new v5 web request, 512 MiB, zero swap, CPU 50 percent, 320 MiB heap and original inner wrapper. Request acceptance is not running-process evidence. Inspect actual readiness without another start. |
| 9 | `attest` | Root first confirms the new listener is ready. The unchanged strict host attestor checks new full APP49 process identity, exact npm PATH, actual PID/cwd/cgroup/environment, build bytes and health `49e3fa2004c1`, 420/latest-17. Read new `runtime-start-attestation.json`. |
| 10 | `post-journey` | Run ONLY after the actual root-owned desktop/390px journey. Fresh new-helper verification and all protected preservation oracles must complete before durable `post-journey-result.json`. New preview planning/auth/import rows intentionally differ from restore and are not compared with its initial dump. |

The literal final command is:

```bash
/bin/sh /home/nathaniel/.t3/worktrees/openplan/t3-9eeec4ad/docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections/parent_recipe.sh ACCEPTED_ROUND2_FULL_COMMIT post-journey
```

Read and hash the retained result. A before-journey attestation, `verify-services`
alone, a successful request, or a stale observation receipt cannot substitute for
this final acquisition. Its phase label does not itself establish journey success.
The root must also retain the actual browser and artifact evidence.

The proposed database remains
`openplan_project_portfolio_preview_8f43260b95a071cc4e6d2b90`, API
`http://127.74.19.11:29949`, web `http://127.74.19.11:3586`. This child allocates
nothing and makes no current database-name/port-absence claim. Root must reacquire
exclusive absence and bindability immediately before allocation. Collision means
stop, not rebinding a sealed packet. New helpers use the `openplan-portfolio-v5-`
prefix; the web unit is `openplan-portfolio-skip-preview-49e3fa200-v5-web.service`.

## Root collects the corrected import journey

Root remains the sole driver of the documented Playwright fallback tab. Preserve
the original T3 timeouts, old namespace/PID failure, failed import, original build,
source bytes and downloads. This child opens no browser.

Navigate through the new front door and normal sign-in, then sidebar Projects to
Import. Use the frozen mixed CSV or a byte-identical retained copy. Confirm one
selected valid create and one invalid skipped row in the real review UI. Inspect
the success response, created project, both audit rows, original source/preview
hashes, retained invalid classification, cost `125000 EUR`, null price year and
actor/source custody applicable to the fixture. Do not alter the source to avoid
the defect or seed rows through SQL. Repeat import must preserve existing identity
rather than create a duplicate.

At desktop and 390 by 844, retain navigation, decisions, visible counts, success
and readback states, scroll width, console errors/warnings, downloads and inspected
artifact bytes/hashes. Attach exact new DB identity, migration census, APP49, fresh
BUILD_ID, web invocation and attestation hash to provenance. Health build metadata
is not a live database census. Old 215 evidence is not a new 420 build or journey.

## Host observer is narrow trusted transport, not hostile-host confinement

Every preservation acquisition runs a new fixed, hash-pinned Python transport.
It accepts only a 64-hex request nonce, supplies fixed UID-1000 user-bus variables,
and asks the user manager for the one fixed read-only observer script in the
bounded `openplan-portfolio-v5-preserved-web-observer` unit. There is no selectable
command, script path, target, unit, DB or provider argument. The observer reads only
old web unit/socket/proc and its immutable receipt, checks strict identity and
actual resource limits, and returns hashes and identifiers. Nonce and code hash
bind fresh returned stdout; no stale boolean file supplies preservation.

The active-check/checkout controller retains its outer read-only wrapper. Actual
R1 tests demonstrate protected paths refuse write-open with EROFS while the host
observer can read the original listener PID and environment. npm's environment
and inner wrapper remain unchanged. The user manager starts the observer outside
the caller's user namespace; fixed bus variables alone would not solve `/proc`.

The controller, same-user files, host tools/Python/loader, user bus and user manager
remain trusted. A user-bus connection is a control-plane capability, and resource
limits do not confine a hostile controller. The fixed transport is reviewed code,
not an OS broker that restricts every possible same-user bus action. Namespace,
UID or bus-path changes require refusal and a new reviewed binding. No host
security setting, privilege, service restart or paid credential changes here.
