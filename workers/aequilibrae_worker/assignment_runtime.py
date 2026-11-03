"""Interpreter admission for the retained AequilibraE numerical stack."""
import platform
import sys


def require_assignment_python() -> None:
    """Refuse interpreters outside the reviewed CPython 3.11 runtime.

    NumPy 2.0 on Python 3.14 can overwrite flow with volume/capacity during
    result extraction. Package versions and small graph fixtures do not catch
    this. Keep the interpreter used by the worker images until another full
    numerical stack is separately reviewed. Do not patch exported volumes.
    """
    if platform.python_implementation() != 'CPython' or sys.version_info[:2] != (3, 11):
        raise ValueError(
            'AequilibraE numerical runtime requires CPython 3.11; '
            f'found {platform.python_implementation()} {sys.version_info[0]}.{sys.version_info[1]}. '
            'Create a separate Python 3.11 environment with the pinned requirements. '
            'Python 3.14 with NumPy 2.0 can corrupt assignment volume measurements.')
