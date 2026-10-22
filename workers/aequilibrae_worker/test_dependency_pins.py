#!/usr/bin/env python3
"""The county model stack and the hosted model image pin the same engine pair.

KI-2026-10-12-020: `scripts/modeling/requirements.txt` carried floors that
resolved to AequilibraE 1.7 with pandas 3, the pair the hosted image refuses
because it breaks graph compression. The hosted image installs this directory's
requirements.txt; the county image installs scripts/modeling/requirements.txt.
These checks fail when the two lists stop naming the same engine pins, when a
pin opens back into a range, or when either image stops running the graph
probe after installing them.

It lives here, not beside the county worker, because CI runs every test_*.py in
this directory. Pure text reading; no dependency is imported or installed.

    python3 -I workers/aequilibrae_worker/test_dependency_pins.py
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORKER_REQUIREMENTS = os.path.join(HERE, "requirements.txt")
COUNTY_REQUIREMENTS = os.path.join(REPO, "scripts", "modeling", "requirements.txt")
HOSTED_DOCKERFILE = os.path.join(REPO, "workers", "hosted-models", "Dockerfile")
COUNTY_DOCKERFILE = os.path.join(REPO, "workers", "county_onramp_worker", "Dockerfile")
ASSIGNMENT_DOCKERFILE = os.path.join(HERE, "Dockerfile")

# The packages whose versions decide graph compression and the compiled path
# engine. Each must read identically in both files.
ENGINE = ("aequilibrae", "numpy", "pandas")
# The two that must be exact: a range on either reopens the refused pair.
EXACT = ("aequilibrae", "pandas")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def requirement_specifiers(path: str) -> dict[str, str]:
    """Map each distribution name to its version specifier, comments removed."""
    found: dict[str, str] = {}
    for raw in _read(path).splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        match = re.match(r"^([A-Za-z0-9_.\-]+)\s*(.*)$", line)
        if not match:
            raise AssertionError(f"{path}: cannot read requirement line {raw!r}")
        name = match.group(1).lower().replace("_", "-")
        if name in found:
            raise AssertionError(f"{path}: {name} is listed twice")
        found[name] = match.group(2).replace(" ", "")
    return found


def test_both_lists_name_the_same_engine_pins():
    worker = requirement_specifiers(WORKER_REQUIREMENTS)
    county = requirement_specifiers(COUNTY_REQUIREMENTS)
    for name in ENGINE:
        assert name in worker, f"workers/aequilibrae_worker/requirements.txt no longer lists {name}"
        assert name in county, f"scripts/modeling/requirements.txt no longer lists {name}"
        assert worker[name] == county[name], (
            f"{name} differs: hosted image {worker[name]!r}, county stack {county[name]!r}. "
            "Change both files together, and only after the graph probe and a county comparison."
        )


def test_the_engine_pair_is_exact_in_both_lists():
    for path in (WORKER_REQUIREMENTS, COUNTY_REQUIREMENTS):
        specs = requirement_specifiers(path)
        for name in EXACT:
            spec = specs.get(name, "")
            assert re.fullmatch(r"==[0-9][0-9A-Za-z.]*", spec), (
                f"{os.path.relpath(path, REPO)}: {name} must be an exact pin, found {spec!r}"
            )
        assert not specs["pandas"].startswith("==3"), (
            "pandas 3 breaks AequilibraE graph compression (docs/ops/HOSTED_RELAUNCH_2026-10-10.md)"
        )


def _install_then_probe(dockerfile: str, requirements_copy: str) -> None:
    text = _read(dockerfile)
    install = text.find(requirements_copy)
    probe = text.find("verify_graph_compatibility.py\n")
    assert install >= 0, f"{os.path.relpath(dockerfile, REPO)} no longer copies {requirements_copy}"
    assert probe > install, (
        f"{os.path.relpath(dockerfile, REPO)} must run the graph probe after installing {requirements_copy}"
    )
    runs = re.findall(r"^RUN [^\n]*verify_graph_compatibility\.py\s*$", text, flags=re.MULTILINE)
    assert runs, f"{os.path.relpath(dockerfile, REPO)} copies the probe but never runs it"


def test_the_hosted_image_installs_the_worker_list_and_runs_the_probe():
    _install_then_probe(HOSTED_DOCKERFILE, "COPY workers/aequilibrae_worker/requirements.txt")


def test_the_county_image_installs_the_county_list_and_runs_the_probe():
    _install_then_probe(COUNTY_DOCKERFILE, "COPY scripts/modeling/requirements.txt")


def test_assignment_images_use_the_reviewed_python_abi():
    for path in (ASSIGNMENT_DOCKERFILE, HOSTED_DOCKERFILE):
        bases = re.findall(r"^FROM (.+)$", _read(path), flags=re.MULTILINE)
        assert bases == ["python:3.11-slim"], (
            f"{os.path.relpath(path, REPO)} must retain the reviewed cp311 runtime"
        )


def _adapter_after_sources(path: str, copy: str, command: str) -> None:
    lines = _read(path).splitlines()
    assert lines.count(command) == 1, (
        f"{os.path.relpath(path, REPO)} must run the exact adapter identity check"
    )
    assert copy in lines and lines.index(copy) < lines.index(command), (
        f"{os.path.relpath(path, REPO)} must check the adapter after copying its sources"
    )


def test_standalone_image_checks_the_adapter_after_copying_sources():
    _adapter_after_sources(ASSIGNMENT_DOCKERFILE, 'COPY *.py .',
        'RUN python -c "from model_assignment_graph_adapter import supported_engine; supported_engine()"')


def test_hosted_image_checks_the_adapter_in_its_own_environment():
    _adapter_after_sources(HOSTED_DOCKERFILE,
        'COPY workers/aequilibrae_worker ./workers/aequilibrae_worker',
        'RUN cd /app/workers/aequilibrae_worker && /opt/aequilibrae/bin/python -c "from model_assignment_graph_adapter import supported_engine; supported_engine()"')


if __name__ == "__main__":
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} dependency-pin checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
