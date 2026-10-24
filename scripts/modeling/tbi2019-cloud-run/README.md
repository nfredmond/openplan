# TBI 2019 modeled-only cloud package

This package runs the corrected full population for current coefficients, then
the frozen SEMCOG walk candidate. It never requests survey outcomes or compares
modeled values with observations. Keep the PR draft and frozen opening closed.
The local proof establishes container execution parity, not scientific accuracy.

Read [SIZING.md](SIZING.md) before allocating a machine. Prefer 128 GB RAM,
four household processes and at least four usable CPU cores. Full completion,
coalescence and suffix memory remain unproved. The lead owns provisioning,
archive upload and full execution. This package touches no hosted service itself
until the operator supplies an endpoint and starts it.

## Build and run

Build from this directory as the Docker context. Its allowlist excludes all data,
proof outputs, test credentials and retained local paths from the image.

```bash
DOCKER_BUILDKIT=0 docker build --memory=6g --memory-swap=6g \
  -t astra-tbi-cloud-run:20261024-final scripts/modeling/tbi2019-cloud-run
```

The legacy-builder setting works on the local workstation, where Buildx is
missing. A builder with Buildx may omit it. The wheel lock targets Linux x86-64. The base is CPython 3.11.15 on Debian
Bookworm, pinned by image digest. `requirements-model.lock` records hashes of
all 76 installed model dependency wheels from the local parity environment.
`requirements-transport.lock` independently pins the S3 controller environment.
Boto3 does not change the model environment. The locally retained environment's
`pip check` passes. No ActivitySim source is patched. The container's libc and
Python compiler differ from the host, so the Docker parity proof is required.

Provide the variables below through the platform's private environment settings.
For a local command, use a protected env file outside the repository. Never put
credentials on the command line or into the build context. Mount persistent
writable storage at `/work` if interruption custody matters. Allocate at least
100 GB there for the first full attempt and monitor available space.

```bash
docker run --name astra-tbi-cloud-full-UNIQUE \
  --memory=119g --memory-swap=119g \
  --env-file /private/path/tbi.env \
  -v /private/path/tbi-work:/work astra-tbi-cloud-run:20261024-final
```

This is an operator recipe, not a command executed by the implementation agent.
Choose a container cap within the machine's actual allowance; 128 GB decimal
is about 119.21 GiB. Do not restart automatically into the same ephemeral disk
without preserving the previous attempt. Every invocation allocates a new UUID
under the supplied results prefix. It never resumes or overwrites an earlier
attempt. Stock checkpoints are uploaded for custody; automatic resume is not
implemented. A lead-reviewed successor may use them without rewriting history.

## Complete environment contract

| Variable | Required/default | Meaning |
|---|---|---|
| `TBI_S3_ENDPOINT` | Required | S3-compatible HTTP(S) endpoint, with no credentials/query in the URL. Use HTTPS for cloud transport. |
| `TBI_S3_BUCKET` | Required | Existing bucket holding the archive and receiving results. |
| `TBI_ARCHIVE_KEY` | Required | Object key of the admitted archive, or the pinned proof archive in proof mode. |
| `TBI_S3_ACCESS_KEY_ID` | Required secret | Bucket access identity; never printed or passed to the model child. |
| `TBI_S3_SECRET_ACCESS_KEY` | Required secret | Bucket secret; never printed or passed to the model child. |
| `TBI_S3_SESSION_TOKEN` | Optional secret | Temporary-credential token, when required by the provider. |
| `TBI_S3_REGION` | `us-east-1` | Region used for SigV4 signing. |
| `TBI_RESULTS_PREFIX` | Required | Parent key prefix; runner appends run label plus a new UUID. |
| `TBI_RUN_ID` | `tbi2019` | Human-readable attempt label, 1–80 letters, digits, periods, underscores or hyphens; first character alphanumeric. |
| `TBI_DATASET` | `full` | `full` or `parity2000`. Real execution must use `full`. No household sampling switch exists. |
| `TBI_NUM_PROCESSES` | `4` | Only `4` is admitted; any other value refuses. Suffix always uses one process. |

The image fixes `OPENBLAS_NUM_THREADS=1`, `OMP_NUM_THREADS=1`,
`NUMBA_NUM_THREADS=1`, `MALLOC_MMAP_THRESHOLD_=131072`,
`MALLOC_TRIM_THRESHOLD_=0`, `MALLOC_ARENA_MAX=2`,
`PYTHONDONTWRITEBYTECODE=1` and `PYTHONUNBUFFERED=1`. The launcher constructs
this model environment explicitly, so operator overrides cannot change it.
No configurable archive hash, chunk target, coefficient or suffix mode exists.

## Admitted archive and execution configuration

Admit the population-corrected archive, 2,783,118,248 bytes:
`0465298da115a6de40d23c26d7c21de273be2d48266f76f80813780a7c45d6c2`.
Its embedded inventory hashes to
`8d1f58dd71c129c0bd90e912d9952d86aeb6f8958c9cbd91d73d2cfa6756e92f`.
The runner verifies the outer archive, all 593 inventoried regular files and
the embedded inventory before starting a model. It rejects unsafe paths,
duplicates, unexpected/missing members, byte-length and hash differences.
It extracts only `inputs/bundle/`; all remaining members are streamed and
verified. Archived scripts never execute.

The older 2,898,724,157-byte `81fe67cc…` archive is not admitted because it
precedes the population corrections and four source-conflict exclusions. The
corrected full runtime has 1,060,601 households and 2,617,177 persons across
634 destinations. The unused raw `source_geoid` column is removed using the
retained exact-parity derivative. Source archive bytes remain unchanged.

Configuration layers, in order, are the packaged arm/stage overlay, the verified
bundle's `configs`, then ActivitySim 1.5.1's pinned stock `prototype_mtc/configs`.
`admission.json` contains every package and installed source/configuration hash.
The prefix uses four household slices and a 256 MiB production target per
process, with seed zero, 0.05 minimum chunk ratio, no shadow pricing, file-backed
skims and both downcast settings false. It stops after
`trip_purpose_and_destination`. The suffix restores `mp_households` and runs
`trip_scheduling`, `trip_mode_choice`, `write_data_dictionary`, `write_tables`
in one process with chunking disabled. The launcher verifies the checkpoint
exists before starting that suffix.

- Prefix `settings.yaml`: `3c114013f2ea817022cb94c95c0db90e9d9c07f543e0032e3e237ad9fa3eca24`.
- Suffix `settings.yaml`: `d7ff8be05e77edcca374445632d49821c839315431cf7e6d8b2e0095dbceafe7`.
- Frozen production cache: `3258b6ecd69d9a9e73e4d0b411a65a6e63308e7fe797d0f65dcc6634a29d7761`.
- Current tour coefficients: `42a98dc65adb64a61de88d92e6fd9939a9a32900140a9fa8c5e3eacedb4a84b2`.
- SEMCOG tour coefficients: `537e54811e4b6ca9fec0662085777e9679a634bd312bb7c64df6e58ff60c7490`.

## Outputs and failure meaning

Each attempt writes a conditional `claim.json`, then downloads and verifies its
input. Prefix/suffix logs sit outside ActivitySim's cleanup directory. One-second
telemetry records per-PID RSS, observed VmHWM, anonymous/file RSS, model step and
aggregate cgroup counters. RSS overlaps shared pages; sampled stage peaks are
lower bounds. `health.json` records stage elapsed time, exit code and cgroup peak. The kernel
peak is cumulative for this container across stages; use sampled
`memory.current` for stage-specific lower bounds.

After completion or a caught failure, the controller uploads all retained
outputs, checkpoints, cache, logs, telemetry, runtime/config/input receipts and
`run.json`. `manifest.json` supplies each file's byte length and SHA-256.
`terminal.json` is the last upload and records completed/failed, step, last engine
step, elapsed time, peak counters, error and manifest hash. The elapsed and memory snapshot is taken before
artifact publication; stage timings measure the engine, and upload duration
is not included in that snapshot. A failed current arm
prevents SEMCOG execution. Upload failure changes status to failed. Failure exits
nonzero. The controller never logs credentials or raw transport exceptions.

An abrupt host loss, SIGKILL, container-wide OOM kill or unavailable object store
can prevent any final upload. No in-container program can guarantee a terminal
object after its own destruction. A claim without a terminal object means
**incomplete/unconfirmed**, never completed. The one-second 96 percent memory
headroom guard attempts to terminate model children and retain evidence before
OOM, but cannot guarantee survival of a faster allocation. It includes charged
file cache and can stop before the kernel would reclaim that cache. Treat such
a stop as a resource refusal, not proof that anonymous model allocations cannot
fit the machine. The lead should keep
platform exit logs and persistent `/work` custody for that case. No external
watchdog or cloud integration is provisioned here.

Conditional creation follows [Boto3 PutObject](https://docs.aws.amazon.com/boto3/latest/reference/services/s3/client/put_object.html).
The local proof uses [Moto server mode](https://docs.getmoto.org/en/5.1.13/docs/server_mode.html)
after both MinIO registry pulls failed. This establishes an S3 protocol proof,
not a provider-specific bucket acceptance. The cloud endpoint must support
SigV4, path-style addressing, multipart upload and conditional PutObject.

## Reproduce the local proof

`prepare_proof.py` first verifies the entire admitted parent archive, then uses
the retained lowest SHA-256 household-ID selection algorithm to create the
2,000-household/4,971-person subset, retaining all 634 destinations. It writes
`proof-inventory.json` and a receipt outside Git. The proof archive hash is
pinned in `admission.json`. It contains public synthetic inputs, not references
or observed outcomes. Recreating a gzip archive can change its outer hash;
review the new receipt and freeze the package before rebuilding.

`local_proof.py PRIVATE_ROOT IMAGE [UNUSED_SUBNET]` creates a uniquely named local S3 container,
network and capped runner/helper containers, then removes them in `finally`.
The default test subnet is `10.251.239.0/24`; inspect existing Docker networks
and host routes before use, or supply another unused subnet. This avoids the
workstation's exhausted Docker default pools.
It tests a wrong outer hash, an altered member with a test-only outer admission,
and both valid arms. The altered admission is mounted only in the owned
negative-control container. Production has no hash override variable.
The helper downloads all result objects and verifies manifest hashes and bytes.
Compare the valid candidate against each retained unchunked arm using
`compare_proof.py`; that tool independently verifies reference custody and dtypes.
The proof server is an isolated emulator with random test credentials and a
loopback-only host port. It is never a hosted endpoint.
