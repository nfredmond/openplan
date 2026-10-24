#!/usr/bin/env python3
"""Validate aggregate development evidence; implementation is in the frozen evaluator closure."""
import json
import sys
from pathlib import Path
from activitysim_walk_transfer import validate

if __name__ == '__main__':
    validate(json.loads(Path(sys.argv[1]).read_text()))
