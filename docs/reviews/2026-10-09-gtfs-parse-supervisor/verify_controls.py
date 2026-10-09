"""Run only in an owned checkout with no concurrent tests or source edits."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "openplan"
PARENT = APP / "src/lib/gtfs/parse-supervisor.ts"
CHILD = APP / "scripts/workers/gtfs-parse-child.mts"
OUTPUT = Path(sys.argv[1]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
originals = {p: p.read_bytes() for p in (PARENT, CHILD)}
checks = []


def run(name, expected, selection=None):
    command = ["npm", "exec", "--", "vitest", "run",
               "src/test/gtfs-parse-supervisor.test.ts", "--maxWorkers=1"]
    if selection:
        command += ["-t", selection]
    result = subprocess.run(command, cwd=APP, capture_output=True, text=True, timeout=45)
    log = result.stdout + result.stderr
    (OUTPUT / f"{name}.log").write_text(log)
    checks.append({"name": name, "exitCode": result.returncode,
                   "expectedPass": expected, "selection": selection,
                   "logSha256": hashlib.sha256(log.encode()).hexdigest()})
    assert (result.returncode == 0) == expected, (name, result.returncode)
    if not expected:
        assert "AssertionError" in log, f"{name}: expected a behavior assertion, not runner failure"
    print(name, "PASS" if expected else "EXPECTED ASSERTION FAILURE", flush=True)


mutations = [
    ("checksum_removed", CHILD,
     'if (createHash("sha256").update(bytes).digest("hex") !== request.checksumSha256)',
     "if (false)", "refuses changed archive bytes"),
    ("output_reuse_allowed", CHILD, "|| output.size !== 0", "", "refuses changed archive bytes"),
    ("output_bound_removed", CHILD, "if (encoded.length > request.maxOutputBytes)",
     "if (false)", "refuses output beyond"),
    ("renewal_refusal_ignored", PARENT, 'if (!confirmed) stop("ownership_unconfirmed");',
     'if (!confirmed) { /* deliberately ignore ownership loss */ }', "renews during a CPU-blocked child"),
    ("hung_renewal_accepted", PARENT,
     "setTimeout(() => finish(false), options.renewTimeoutMs)",
     "setTimeout(() => finish(true), options.renewTimeoutMs)", "bounds an unresponsive renewal"),
    ("final_confirmation_removed", PARENT, "if (reason || !(await renew()))",
     "if (reason)", "requires final ownership confirmation"),
    ("output_digest_unchecked", PARENT, 'if (hash.digest("hex") !== receipt.sha256)',
     "if (false)", "refuses a child receipt with wrong_digest"),
    ("failed_exit_accepted", PARENT, "if (exitCode !== 0 || !receipt)",
     "if (!receipt)", "refuses a child receipt with failed_exit"),
    ("deadline_disabled", PARENT, 'setTimeout(() => stop("timed_out"), options.maxRuntimeMs)',
     'setTimeout(() => {}, options.maxRuntimeMs)', "enforces a parent deadline"),
    ("active_cancellation_ignored", PARENT, 'const cancel = () => stop("cancelled");',
     "const cancel = () => {};", "cancels active parsing"),
]

try:
    run("baseline", True)
    PARENT.write_bytes(originals[PARENT] + b"\n// Harmless control comment.\n")
    run("harmless_comment", True)
    PARENT.write_bytes(originals[PARENT])
    for name, target, old, new, selection in mutations:
        source = originals[target].decode()
        assert source.count(old) == 1, (name, "mutation target differs")
        target.write_text(source.replace(old, new))
        try:
            run(name, False, selection)
        finally:
            target.write_bytes(originals[target])
    run("restored", True)
finally:
    for target, source in originals.items():
        target.write_bytes(source)
    (OUTPUT / "controls.json").write_text(json.dumps({
        "sourceSha256": {str(p.relative_to(ROOT)): hashlib.sha256(s).hexdigest() for p, s in originals.items()},
        "checks": checks,
        "restored": all(p.read_bytes() == s for p, s in originals.items()),
    }, indent=2) + "\n")
