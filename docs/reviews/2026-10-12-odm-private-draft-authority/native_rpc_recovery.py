"""Reuse the verified owned RPC lifecycle with current draft authorization."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def run(fixture, out):
    path = ROOT/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py'
    spec = importlib.util.spec_from_file_location('original_owned_rpc_driver', path)
    driver = importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
    driver.CLIENT = Path(__file__).with_name('native_client.py')
    driver.run(fixture, out)
    bindings = json.loads((out/'source-bindings.json').read_text())
    for name in ('application_draft_authority.py', 'runtime_dispatch_custody.py', 'runtime_url_draft.py', 'runtime_draft.py'):
        source = ROOT/'workers/odm_worker'/name
        bindings[str(source.relative_to(ROOT))] = hashlib.sha256(source.read_bytes()).hexdigest()
    bindings[str(Path(__file__).relative_to(ROOT))] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (out/'source-bindings.json').write_text(json.dumps(bindings, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.fixture.resolve(), args.out.resolve())
