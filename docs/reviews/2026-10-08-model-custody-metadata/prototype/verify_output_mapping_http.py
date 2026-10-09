"""Verify native combined state/package/project/output preparation and recovery."""
from verify_paired_inputs_http import main

if __name__ == '__main__':
    main(include_project=True, include_outputs=True)
