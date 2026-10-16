"""Run focused controls in the assigned checkout, restoring exact bytes finally."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "openplan"
OUT = Path(sys.argv[1]).resolve()
CONFIG = Path(sys.argv[2]).resolve()
OUT.mkdir(exist_ok=False)
COPY = "src/test/planner-copy-says-the-plain-thing.test.ts"
GUARD = "src/test/reference-count-projection-guard.test.ts"
SCANNER = "src/test/supabase-call-sites.ts"
MAP = "src/components/projects/project-saved-map.tsx"
FIELDS = "src/lib/projects/project-jurisdiction.ts"
ROUTE = "src/app/api/projects/[projectId]/jurisdiction-readiness/route.ts"
RATCHET = "uses no term from the ledger more often than the recorded baseline"
READER = "checks the new project jurisdiction reader's imported literal against the schema"
RESOLVER = "resolves direct imported literals while retaining computed, mutable and shadowed unknowns"
SCHEMA = "never names a column on a table it cannot see"

group = Path("/sys/fs/cgroup") / Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1].lstrip("/")
resources = {key: (group / key).read_text().strip() for key in ["memory.max", "memory.swap.max"]}
assert resources == {"memory.max": "1073741824", "memory.swap.max": "0"}
original = {file: (APP / file).read_bytes() for file in [COPY, GUARD, SCANNER, MAP, FIELDS, ROUTE]}
results = []


def trial(name, files, edits=(), failure=None):
    """An expected fault must fail its named assertion, not runner startup."""
    try:
        for file, old, new in edits:
            source = (APP / file).read_text()
            assert source.count(old) == 1, (name, file, old)
            (APP / file).write_text(source.replace(old, new))
        command = ["node", "--max-old-space-size=700", "node_modules/vitest/vitest.mjs", "run",
                   "--config", str(CONFIG), *files]
        if failure:
            command.extend(["-t", failure])
        result = subprocess.run(command, cwd=APP, env={**os.environ, "NO_COLOR": "1"},
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        log = OUT / (name + ".log")
        log.write_text(result.stdout)
        if failure:
            assert result.returncode == 1, (name, result.returncode)
            assert "AssertionError" in result.stdout and failure in result.stdout, name
            assert "Failed Tests" in result.stdout and "1 failed" in result.stdout, name
        else:
            assert result.returncode == 0, (name, result.returncode)
        results.append({"name": name, "exitCode": result.returncode,
                        "result": "killed" if failure else "survived", "assertion": failure,
                        "logSha256": hashlib.sha256(log.read_bytes()).hexdigest()})
        print(name, results[-1]["result"], flush=True)
    finally:
        for file, data in original.items():
            (APP / file).write_bytes(data)
        assert all((APP / file).read_bytes() == data for file, data in original.items())
        (OUT / "results.json").write_text(json.dumps(results, indent=2) + "\n")


try:
    trial("baseline", [COPY, GUARD])
    trial("harmless", [COPY, GUARD], [
        (file, (APP / file).read_text(), (APP / file).read_text() + "\n// Harmless control.\n")
        for file in [COPY, GUARD, SCANNER, MAP, FIELDS, ROUTE]
    ])
    trial("copy-jargon", [COPY], [(MAP, "These shapes do not establish", "Geometry does not establish")], RATCHET)
    trial("ratchet-returned-word", [COPY], [(MAP, "Saved project shapes:", "Saved project workspace shapes:")], RATCHET)
    trial("reader-removed", [GUARD], [(ROUTE, ".select(PROJECT_JURISDICTION_COLUMNS)", "")], READER)
    trial("reader-missing-field", [GUARD], [(FIELDS, '"id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code"',
        '"id, updated_at, place_label, place_country_code, place_subdivision_code"')], READER)
    trial("imported-column-typo", [GUARD], [(FIELDS, '"id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code"',
        '"id, updated_at, jurisdiction_context, geometry_scope, place_country_code, place_subdivision_code"')], SCHEMA)
    trial("import-resolution-disabled", [GUARD], [(SCANNER, "if (value && ts.isStringLiteralLike(value)) return value.text;",
        "if (value && ts.isStringLiteralLike(value)) return null;")], RESOLVER)
    trial("mutable-import-accepted", [GUARD], [(SCANNER, "!(exported.declarationList.flags & ts.NodeFlags.Const)", "false")], RESOLVER)
    trial("private-binding-accepted", [GUARD], [(SCANNER,
        "!exported.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)", "false")], RESOLVER)
    trial("template-accepted", [GUARD], [(SCANNER, "if (value && ts.isStringLiteralLike(value)) return value.text;",
        "if (value && ts.isTemplateExpression(value)) return value.getText(imported);\n            if (value && ts.isStringLiteralLike(value)) return value.text;")], RESOLVER)
    trial("parameter-shadow-ignored", [GUARD], [(SCANNER, "if (localNames.has(argument.text)) return null;", "// Shadow control disabled.")], RESOLVER)
    trial("new-unknown-projection", [GUARD], [(ROUTE, ".select(PROJECT_JURISDICTION_COLUMNS)",
        ".select(columnsForCaller())")], "guards the guard")
    trial("restored", [COPY, GUARD])
finally:
    for file, data in original.items():
        (APP / file).write_bytes(data)
    resources.update({key: (group / key).read_text().strip() for key in ["memory.peak", "memory.events"]})
    (OUT / "resources.json").write_text(json.dumps(resources, indent=2) + "\n")
    (OUT / "restoration.json").write_text(json.dumps({file: {
        "sha256": hashlib.sha256(data).hexdigest(), "restored": (APP / file).read_bytes() == data,
    } for file, data in original.items()}, indent=2) + "\n")
