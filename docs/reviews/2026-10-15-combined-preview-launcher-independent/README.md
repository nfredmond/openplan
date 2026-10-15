# Independent review finds one launcher execution blocker

Reviewed October 15, 2026 using GPT-6.1 Sol at high reasoning. No delegation.

**Disposition: correct finding F1 before operational execution.** The current
health oracle refuses the response produced by the pinned gateway configuration.
This is a launcher correctness finding, not an observed access-control breach.
The parent owns the correction, execution decision and runtime evidence.
A corrected or green packet does not receive automatic approval from this review.

## Exact reviewed source and ownership

The preparation commit is `c636b7eecbd66970217421da7bead960f262323b` in
`/home/nathaniel/.t3/worktrees/openplan/t3-04a45cb6`, under
`docs/reviews/2026-10-15-combined-preview-configured/`.
The reviewed files are `README.md`, `preparation.json`, `controls.json`, and
`templates/{launcher,policy,controls}.py`. I extracted templates with `git show`
from that commit into my own private probe directory. Their hashes match the
public preparation manifest and configured private launcher files.

The app candidate remains `b4dbcac21a58f61bd480ccade4dec69383dacbc7`.
The source remains
`openplan_jurisdiction_native_3d281df106064b8cbb9e0c82_up` in container
`a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce`.
The intended new database is
`openplan_project_combined_preview_02edd1c162e1c09a5d05b95c`.
The intended API and web origins are `http://127.74.19.10:29948` and
`http://127.74.19.10:3585`.

My assigned tree is `/home/nathaniel/.t3/worktrees/openplan/t3-43740634`, branch
`t3/review-combined-preview-launcher`. It started clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`.
I fetched `origin/main` and fast-forwarded only this tree to
`4ea6a8ca3b43c6712952fc4e527a8538237a9adb` before the review.
`npm run product:direction:check` exits zero at that base. It retains expired
registry/matrix dates and review-version/intervening-change reminders; I did
not redate or amend those records. I read the operating instructions, product
direction records, and planner-writing, prove-it and Supabase/Postgres skills.

I own only this report directory and its ignored `.private/` probe directory.
The parent QA process was running in `t3-0f743997`; I left it alone. Neither
source checkout was edited, built, served or reused for probe execution.

## F1: the old-origin CORS assertion rejects the pinned Kong response

Priority: **P1, operational execution blocker**.

Location: reviewed `templates/launcher.py:267-271`; corresponding synthetic
expectation at `templates/controls.py:43` and configuration at
`templates/policy.py:129`.

The configured Kong CORS plugin has one literal origin,
`http://127.74.19.10:3585`. The pinned gateway image is Kong 2.8.1. Its CORS
implementation handles a single literal origin by setting
`Access-Control-Allow-Origin` to that configured value and returning, before
reading the request origin. This behavior appears in the
[versioned upstream implementation](https://github.com/Kong/kong/blob/2.8.1/kong/plugins/cors/handler.lua#L71-L83).

I confirmed the pinned image is present and that the earlier gateway uses the
same image. A read-only `docker exec <exact earlier gateway ID> cat
/usr/local/share/lua/5.1/kong/plugins/cors/handler.lua` reads the same branch at
local lines 76-87. The local plugin SHA-256 is
`11d9a79ee102d14076d00184414f7122df839d84d334bc8e1250572d035e3e0b`.
This reads public implementation code. It changes no helper configuration and
sends no request to a service.

For the preflight from `http://127.74.15.10:3583`, the response therefore carries
`Access-Control-Allow-Origin: http://127.74.19.10:3585`. That header does not
match the requesting origin. The browser does not grant that origin access.
However, `health()` requires `oldOrigin` to be `None`, so its typed comparison
raises `ValueError('health:oldOrigin')` on this correctly restricted response.

The defect is reachable through `services() -> verify_services() -> health()`.
Independent `verify-services` repeats it. Both `build()` and `start()` also call
`app_check() -> verify_services()`, so waiting for startup cannot resolve it.
If the earlier helper phases succeed, all four helpers can already be running
when this refusal occurs. There is no claim that those phases have run.

A private probe replaces only the file reader and HTTP opener. It supplies 200
health responses, the correct allowed-origin header, and the pinned plugin's
old-origin header. The unmodified `health()` raises exactly `health:oldOrigin`.
No HTTP, SQL, Docker creation, service startup or application execution occurs.
The probe also accepts the current oracle baseline and an equivalent harmless
response, rejects a wrong allowed-origin response as `health:ownOrigin`, and
accepts exact restoration.

**Requested correction:** assess whether the returned header grants the
requesting origin access. Keep the exact allowed-origin assertion. For the
old origin, reject a reflected old origin and a wildcard, while accepting the
pinned gateway's different allowed origin or an absent header. Add acquisition
coverage through the real `health()` response-processing path, with a harmless
survivor, a targeted permissive-CORS fault and restoration. Do not widen the
configured origin list or edit the earlier gateway.

## Commands, probes and observed results

I ran only read-only inspection and synthetic checks, apart from updating my
assigned branch base and writing this report and private probes.

- `git fetch origin main` and `git merge --ff-only origin/main` establish the
  assigned review base above. No other checkout changes.
- `npm run product:direction:check`, from this tree's `openplan/`, exits zero
  with the dated reminders stated above.
- `git show c636b7eecbd66970217421da7bead960f262323b:<reviewed path>` supplies
  the exact public templates. Python AST parsing accepts all three templates.
- Programmatic private reads compare each bound file hash, both manifest
  hashes, all three template hashes and the captured source snapshot digest.
  All agree with `preparation.json` and the pinned source anchor. This checks
  retained bytes, not current live database state.
- The configured-source reader and configuration guard accept the current
  private inputs. The three authorized optional keys are retained. Local
  anon/service tokens have the expected roles, valid signatures under the
  configured signing secret, and future expiry at review time. No key, private
  environment value, source row or raw private log is printed or committed.
- `systemd-run --user --wait --pipe --collect
  --unit=openplan-launcher-independent-controls-20261015-01
  -p MemoryMax=1G -p MemorySwapMax=0 -p TasksMax=32 -p CPUQuota=100%
  /usr/bin/python3 -B -c <control-summary expression>`
  produces 567 observations: 474 intended refusals and 93 survivors. It exits
  zero, peaks at 17.7 MiB, and reports zero swap. The exact Python expression
  is retained below; line wrapping in the unit command is descriptive.

  ```python
  import sys,json,collections
  sys.path.insert(0,"/home/nathaniel/.t3/worktrees/openplan/t3-43740634/docs/reviews/2026-10-15-combined-preview-launcher-independent/.private")
  import controls
  r=controls.run()
  print(json.dumps({"total":len(r["controls"]),"outcomes":dict(collections.Counter(x["outcome"] for x in r["controls"]))}))
  from pathlib import Path
  Path("/home/nathaniel/.t3/worktrees/openplan/t3-43740634/docs/reviews/2026-10-15-combined-preview-launcher-independent/.private/control-result.json").write_text(json.dumps(r,indent=2))
  ```
- A second unit, `openplan-launcher-independent-probes-20261015-01`, uses the
  same resource properties and executes `.private/probe.py`. It reproduces F1
  and the baseline/fault/restoration results above. It also replaces `health()`
  with an unconditional `ValueError('named-fault:health-always-refuses')`.
  All 567 original controls remain identical. After restoring the function,
  the controls remain identical again. This exposes a control blind category;
  it does not demonstrate operational health. The unit peaks at 20.2 MiB with
  zero swap.
- A third unit, `openplan-launcher-independent-prior-controls-20261015-01`, uses
  the same resource properties and runs private copies of the previous
  preparation templates from `9d7b8edc9fd851905e01c23c2aa2e5cbaa37a21b`.
  Its 478 observations equal the first 478 current observations exactly.
  It peaks at 16.2 MiB with zero swap. All units run serially.

The synthetic outputs, copied public templates, copied pinned plugin and probe
script remain under this directory's ignored `.private/` path. They contain no
copied private environment or raw database rows. Production guards and tests
are unchanged. All in-memory patches restore on leaving their contexts.

## Other bounded inspection findings

I found no second concrete reachable defect in the reviewed operational packet.
The following are source-inspection conclusions, not runtime acceptance:

- Source SQL uses a read-only session and exact container ID. The dump argv
  names the retained source and enables read-only transactions. Actual create
  and restore argv name the owned target. Restore uses one job, one transaction
  and exit-on-error, without `--create`, `--clean` or role recreation.
- The captured database properties match the plan: ICU locale, UTF8 encoding,
  owner and default connection limit. The private ACL script contains only
  target-database REVOKE/GRANT statements. It restores the captured effective
  PUBLIC/owner privileges, with no source reference or role alteration. This
  separate database ACL step is coherent because database-level restoration
  differs from ordinary object ACL restoration. See
  [PostgreSQL pg_restore documentation](https://www.postgresql.org/docs/18/app-pgrestore.html).
- The row, migration and sequence projection is compared after restore and
  before helper startup. Auth/password records travel in the dump, with no
  account seed path. This is a comparison of observations, not a substitute
  for running the restore or exercising permissions.
- Storage receives its own copy. The earlier pinned Storage helper and new
  configuration agree on tenant, bucket, backend, mount path and migration
  freeze configuration. The gateway's longer signed GET/HEAD route targets
  that new Storage helper. Auth/REST/Storage upstreams name the new helpers;
  both gateway consumers bind the new app API keys.
- The assembled helper creates pin local images/network, equal 512 MiB memory
  and memory-plus-swap limits, 0.5 CPU and 128 PIDs. Only Kong publishes the
  stated loopback API port. New mounts point to owned paths. Per-helper IDs
  persist before startup; pre/post-start inspect comparisons include identity,
  environment, labels, mounts, networking and resource limits.
- Checkout names the exact candidate in a new private detached worktree.
  Build uses that worktree's webpack script. Build/start sanitize environment,
  check the app/migration bindings, require cgroup memory/swap bounds and bind
  the build files before exec. Those paths remain blocked by F1 until corrected.

## Limits and parent-owned evidence

No clone, dump, restore, ACL execution, helper creation/start, dependency install,
build, preview process, browser, provider workload, PR, push or merge occurs in
this review. I issue no database query. Read-only Docker inspection and the
public plugin read are the only live container operations.

The 567 controls chiefly exercise supplied observations and typed comparators.
They cannot establish that the observation producer or external tool behaves
as modeled. The health function substitution above demonstrates this directly.
The create-command guard also allows a broader shape than the one actual
`clone()` assembles; I found no harmful assembled command in this candidate.
Private file hashes bind contents, not provider validity or runtime permissions.
Same-user file replacement and a privileged Docker operator remain outside that
boundary. Source fingerprints compare observation times and do not exclude
transient or concurrent changes. The target row projection does not itself
exercise object ownership, RLS policies, ACL enforcement or helper startup
migrations.

The parent still needs the actual serial clone/ACL result, retained source/global
role/settings preservation, earlier helper/Storage preservation, startup/health
and helper schema behavior, account login, configured key validity and retained
record decryption, capacity, identified build/start binding, and desktop/390px
journey, console and artifact evidence. Current optional-key custody proves none
of those runtime outcomes. This review requests no new module or whole-codebase
audit. Resolve F1 within the launcher and retain the stated execution limits.
