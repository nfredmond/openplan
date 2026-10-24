"""Check local numerical requirements before worker entry, without running a model."""

from importlib import import_module, metadata
from pathlib import Path
import sys
from assignment_runtime import require_assignment_python

try:
    from packaging.requirements import InvalidRequirement, Requirement
    from packaging.utils import canonicalize_name
    from packaging.version import InvalidVersion, Version
except ImportError:
    print(
        "ERROR: AequilibraE dependency preflight needs packaging. Install this "
        "checkout's workers/aequilibrae_worker/requirements.txt in the selected environment.",
        file=sys.stderr,
    )
    sys.exit(1)


NUMERICAL_DISTRIBUTIONS = ("aequilibrae", "numpy", "pandas")


def read_requirements(path: Path) -> dict[str, Requirement]:
    """Read the numerical constraints from the worker's install requirements.

    Refuse ambiguous or unsupported requirement forms rather than skipping a
    numerical constraint. packaging supplies PEP 440 comparison semantics.
    """
    found: dict[str, Requirement] = {}
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        try:
            requirement = Requirement(line)
        except InvalidRequirement as exc:
            raise ValueError(f"{path}:{number}: invalid requirement: {line}") from exc
        name = canonicalize_name(requirement.name)
        if name not in NUMERICAL_DISTRIBUTIONS:
            continue
        if name in found:
            raise ValueError(f"{path}:{number}: duplicate numerical requirement: {name}")
        if requirement.url or requirement.marker or requirement.extras or not requirement.specifier:
            raise ValueError(f"{path}:{number}: need an unconditional numerical version constraint: {line}")
        found[name] = requirement
    missing = set(NUMERICAL_DISTRIBUTIONS) - found.keys()
    if missing:
        raise ValueError(f"{path}: missing numerical requirements: {', '.join(sorted(missing))}")
    return found


def check_versions(requirements: dict[str, Requirement], version=metadata.version) -> list[str]:
    """Reject missing, unknown or out-of-range distribution metadata versions."""
    errors: list[str] = []
    for name, requirement in requirements.items():
        try:
            installed = version(name)
            parsed = Version(installed)
        except metadata.PackageNotFoundError:
            errors.append(f"{name}: installed distribution metadata is missing; requires {requirement}")
            continue
        except (InvalidVersion, TypeError) as exc:
            errors.append(f"{name}: installed version is unknown or invalid; requires {requirement} ({exc})")
            continue
        if parsed not in requirement.specifier:
            errors.append(f"{name}: installed {installed}; requires {requirement}")
    return errors


def main() -> int:
    requirements_path = Path(__file__).resolve().with_name("requirements.txt")
    try:
        require_assignment_python()
        requirements = read_requirements(requirements_path)
        errors = check_versions(requirements)
        if errors:
            raise ValueError("; ".join(errors))
        for name in NUMERICAL_DISTRIBUTIONS:
            import_module(name)
    except Exception as exc:
        print(f"ERROR: AequilibraE dependency preflight failed for {sys.executable}: {exc}", file=sys.stderr)
        return 1
    print(f"AequilibraE numerical requirements and imports passed: {sys.executable}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
