"""Require the actual Node deadline assertion, not an unrelated native failure."""
import ast
import ipaddress
import json
import re
from pathlib import Path
from types import SimpleNamespace


def main():
    source = Path(__file__).with_name("native_rpc_upgrade.py")
    before = source.read_bytes()
    function = next(node for node in ast.parse(before).body if isinstance(node, ast.FunctionDef) and node.name == "deadline_failure")
    original = ast.get_source_segment(before.decode(), function)
    intended = "AssertionError [ERR_ASSERTION]: Actual RPC deadline refuses a stalled command"
    cases = [("intended", 1, intended + "\n    at main (owned.cjs:1:1)\n", True),
        ("success-exit", 0, intended, False), ("wrong-exit", 2, intended, False),
        ("wrong-assertion", 1, intended.replace("stalled", "unrelated"), False),
        ("duplicate-assertion", 1, intended + "\n" + intended, False),
        ("additional-error", 1, intended + "\nTypeError: unrelated native failure", False),
        ("noise-before", 1, "Startup error\n" + intended, False), ("empty", 1, "", False)]
    revoked = "AssertionError [ERR_ASSERTION]: Actual RPC refuses revoked original scope"
    cases += [("revoked-intended", 1, revoked, True),
        ("revoked-wrong-boundary", 1, intended, False),
        ("revoked-duplicate", 1, revoked + "\n" + revoked, False)]
    mutations = [("baseline", original, None), ("harmless", "# Harmless oracle control.\n" + original, None),
        ("exit-removed", original.replace("result.returncode == 1", "True"), "success-exit"),
        ("assertion-removed", original.replace("errors == [prefix]", "bool(errors)"), "duplicate-assertion"),
        ("first-line-removed", original.replace("result.stderr.splitlines()[0] == prefix", "True"), "noise-before"),
        ("message-ignored", original.replace(' + message', ' + "Actual RPC deadline refuses a stalled command"'), "revoked-intended"),
        ("restored", original, None)]
    rows = []
    for name, text, expected_failure in mutations:
        namespace = {"re": re}
        exec(compile(text, "rpc-oracle-control", "exec"), namespace)
        failures = []
        for case, code, stderr, expected in cases:
            parameters = [SimpleNamespace(returncode=code, stderr=stderr)]
            if case.startswith("revoked-"):
                parameters.append("Actual RPC refuses revoked original scope")
            if namespace["deadline_failure"](*parameters) is not expected:
                failures.append(case)
        if expected_failure:
            assert expected_failure in failures, "Intended RPC oracle failure: " + name
            result = "intended refusal lost: " + expected_failure
        else:
            assert not failures, "RPC oracle accepted wrong native failure: " + name
            result = "survived"
        rows.append({"name": name, "result": result})
    network_function = next(node for node in ast.parse(before).body if isinstance(node, ast.FunctionDef) and node.name == "network_available")
    network_original = ast.get_source_segment(before.decode(), network_function)
    network_cases = [("free", "10.212.245.0/28", [], [{"dst": "default"}], True),
        ("docker-overlap", "10.212.245.0/28", [{"IPAM": {"Config": [{"Subnet": "10.212.245.0/29"}]}}], [], False),
        ("host-overlap", "10.212.245.0/28", [], [{"dst": "10.212.0.0/16"}], False),
        ("wide-subnet", "10.212.245.0/24", [], [], False),
        ("public-subnet", "8.8.8.0/28", [], [], False),
        ("null-config", "10.212.245.0/28", [{"IPAM": {"Config": None}}], [], True)]
    overlap_start = network_original.index('    assert all(')
    network_mutations = [("network-baseline", network_original, None),
        ("network-harmless", "# Harmless subnet control.\n" + network_original, None),
        ("network-overlap-removed", network_original[:overlap_start] + "    assert True\n", "docker-overlap"),
        ("network-size-removed", network_original.replace("candidate.prefixlen == 28", "True"), "wide-subnet"),
        ("network-private-removed", network_original.replace("candidate.is_private", "True"), "public-subnet"),
        ("network-restored", network_original, None)]
    for name, text, expected_failure in network_mutations:
        namespace = {"ipaddress": ipaddress}
        exec(compile(text, "rpc-network-control", "exec"), namespace)
        failures = []
        for case, subnet, networks, routes, expected in network_cases:
            try:
                namespace["network_available"](subnet, networks, routes)
                accepted = True
            except AssertionError:
                accepted = False
            if accepted is not expected:
                failures.append(case)
        if expected_failure:
            assert expected_failure in failures, "Intended RPC network guard failure: " + name
            result = "intended refusal lost: " + expected_failure
        else:
            assert not failures, "RPC network guard differs: " + name
            result = "survived"
        rows.append({"name": name, "result": result})
    assert source.read_bytes() == before
    print(json.dumps({"controls": rows, "classificationCases": len(cases), "networkCases": len(network_cases), "scope": "In-memory classifier and network controls only; actual CLI/RPC evidence remains separate."}, indent=2))


if __name__ == "__main__":
    main()
