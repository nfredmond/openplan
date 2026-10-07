"""Read private observations only. No browser, network, database or producer writes."""
import copy
import hashlib
import json
from pathlib import Path
import sys

FILES = {
    "start": "creation-context-browser-start-private.json",
    "created": "creation-context-browser-created-private.json",
    "context": "creation-context-browser-context-private.json",
    "fixed": "creation-context-browser-after-wrap-private.json",
    "native": "creation-context-native-read-private.json",
    "stop": "creation-stop-browser-private.json",
    "stop_native": "creation-stop-native-read-private.json",
}
KEYS = ["specific_land_use", "specific_facilities", "specific_standards",
        "specific_implementation", "specific_general_plan_relationship"]


def verify(d):
    start = d["start"]["browser"]
    created = d["created"]["created"]
    context = d["context"]["context"]
    fixed = d["fixed"]["context"]
    native = d["native"]
    stop = d["stop"]["browser"]
    sn = d["stop_native"]
    checks = {}

    def check(name, condition):
        checks[name] = bool(condition)

    check("kind change clears review", start["reviewBeforeKindChange"] is True and start["reviewAfterKindChange"] is False)
    check("unresolved configured checklist sends nothing", start["unresolvedRefusal"]["requests"] == 0 and bool(start["unresolvedRefusal"]["alerts"]))
    for label, records, commands in [("creation", created["requests"], native["creationCommands"]), ("context", context["requests"], native["contextCommands"])]:
        check(label + " exact retry", len(records) == 2 and [r["status"] for r in records] == [201, 200]
              and records[0]["body"] == records[1]["body"] and records[0]["dropped"] is True
              and records[0]["reply"]["replayed"] is False and records[1]["reply"]["replayed"] is True)
        check(label + " native command custody", len(commands) == 1 and commands[0]["command_text"] == records[0]["body"]
              and commands[0]["command_id"] == records[1]["reply"]["commandId"])
    check("specific checklist", created["descriptor"] == KEYS and sorted(n["requirement_key"] for n in native["content"]) == sorted(KEYS))
    check("one plan and version", len(native["plan"]) == len(native["versions"]) == 1
          and native["plan"][0]["id"] == created["requests"][1]["reply"]["planId"]
          and native["versions"][0]["id"] == created["activeVersion"]["id"])
    check("single context revision advance", created["activeVersion"]["draft_revision"] == 5 and native["versions"][0]["draft_revision"] == 6)
    before = context["before"]["contextState"]["context"]
    after = context["after"]["contextState"]["context"]
    check("retained study area", before["place"] == after["place"] and after["place"]["geometry"] == native["plan"][0]["geography_geojson"])
    check("uploaded area infers no jurisdiction", after["place"]["source"] == "uploaded_file" and all(after["place"][k] is None for k in ["countryCode", "subdivisionCode", "kind", "ref"]))
    authorities = after["assessment"]["authorities"]
    check("separate authorities", len(authorities) == 2 and authorities[0]["jurisdiction"] == {"country": "US", "subdivision": "CA"}
          and authorities[1]["kind"] == "tribal_government" and authorities[1]["jurisdiction"] is None)
    assessment = after["assessment"]["applicability"]
    check("selected authority and sources retained", assessment == before["assessment"]["applicability"]
          and assessment["authorityIds"] == [authorities[0]["id"]] and len(assessment["sourceUrls"]) == 1)
    check("context hash and native result", len(native["contextCommands"]) == 1 and context["before"]["contextHash"] != context["after"]["contextHash"]
          and fixed["final"] == context["after"] and native["plan"][0]["plan_context"] == after
          and native["contextCommands"][0]["saved_context"] == after
          and native["plan"][0]["plan_context_hash"] == context["after"]["contextHash"] == native["contextCommands"][0]["saved_context_hash"])
    check("stale draft requires review", fixed["stale"]["reviewDisabled"] is True and fixed["stale"]["saveDisabled"] is True)
    check("explicit review enables save without posting", fixed["review"]["saveDisabled"] is False and fixed["review"]["oldReviewVisible"] is False
          and fixed["review"]["requests"] == 0 and fixed["requests"] == [])
    old = d["context"]["stale"]
    bad = next(b for b in old["buttons"] if b["text"] == "Use reviewed assessment with current draft")
    check("reproduced and fixed mobile overflow", bad["right"] > 390 and fixed["stale"]["buttonRight"] <= fixed["stale"]["panelRight"] < 390
          and fixed["stale"]["buttonHeight"] >= 40)
    copies = [json.loads(c["raw"]) for c in fixed["localCopies"]]
    check("original bases preserved", len(copies) == 3 and all(c["kind"] == "draft" for c in copies)
          and sum(c["base"]["contextHash"] == context["before"]["contextHash"] for c in copies) == 2)
    check("identified corrected build", fixed["health"]["deployment"]["commit"] == d["fixed"]["applicationCommit"][:12]
          and d["fixed"]["applicationCommit"].startswith("c3184a7e"))
    r = stop["requests"]
    check("stop withholds creation then retries exact bytes", len(r) == 3 and r[0]["withheldBeforeTransport"] is True
          and len({x["body"] for x in r}) == 1 and [x["status"] for x in r[1:]] == [200, 200]
          and r[1]["replyDropped"] is True and all(x["reply"]["outcome"] == "cancelled" for x in r[1:]))
    pending = [json.loads(c["raw"]) for c in stop["lost"]["copies"] if ":command:" in c["key"]]
    check("lost stop retains intent", len(pending) == 1 and pending[0]["kind"] == "pending" and pending[0]["stopRequested"] is True
          and stop["lost"]["retryCreationVisible"] is False)
    check("native cancellation without plan", len(sn["cancellations"]) == 1 and sn["creationCommands"] == 0 and sn["plans"] == 0
          and sn["cancellations"][0]["command_text"] == r[0]["body"])
    restored = [json.loads(c["raw"]) for c in stop["final"]["copies"]]
    drafts = [c for c in restored if c["kind"] == "draft"]
    check("stopped copy requires new review", stop["restored"]["requests"] == 3 and stop["restored"]["reviewed"] is False
          and stop["restored"]["createDisabled"] is True and len(drafts) == 2
          and len({c["instanceId"] for c in drafts}) == 2 and drafts[0]["fields"] == drafts[1]["fields"]
          and sum(c["kind"] == "cancelled" for c in restored) == 1)
    return checks


def main():
    root = Path(sys.argv[1])
    data = {key: json.loads((root / name).read_text()) for key, name in FILES.items()}
    baseline = verify(data)
    assert all(baseline.values()), baseline
    harmless = copy.deepcopy(data)
    harmless["unrelated_observation"] = "extra note"
    assert verify(harmless) == baseline
    faults = [
        ("kind review", ("start", "browser", "reviewAfterKindChange"), True, "kind change clears review"),
        ("extra creation command", ("native", "creationCommands"), [], "creation native command custody"),
        ("duplicate revision", ("native", "versions", 0, "draft_revision"), 7, "single context revision advance"),
        ("stale save enabled", ("fixed", "context", "stale", "saveDisabled"), False, "stale draft requires review"),
        ("mobile clipping", ("fixed", "context", "stale", "buttonRight"), 410, "reproduced and fixed mobile overflow"),
        ("silent review post", ("fixed", "context", "review", "requests"), 1, "explicit review enables save without posting"),
        ("wrong build", ("fixed", "context", "health", "deployment", "commit"), "other", "identified corrected build"),
        ("lost stop intent", ("stop", "browser", "lost", "retryCreationVisible"), True, "lost stop retains intent"),
        ("creation after stop", ("stop_native", "plans"), 1, "native cancellation without plan"),
        ("stopped draft auto-reviewed", ("stop", "browser", "restored", "reviewed"), True, "stopped copy requires new review"),
        ("changed retry bytes", ("created", "created", "requests", 1, "body"), "{}", "creation exact retry"),
        ("missing checklist section", ("created", "created", "descriptor"), KEYS[:-1], "specific checklist"),
        ("unresolved request sent", ("start", "browser", "unresolvedRefusal", "requests"), 1, "unresolved configured checklist sends nothing"),
        ("context retry changed", ("context", "context", "requests", 1, "body"), "{}", "context exact retry"),
        ("missing context command", ("native", "contextCommands"), [], "context native command custody"),
        ("wrong plan", ("native", "plan", 0, "id"), "other", "one plan and version"),
        ("geometry changed", ("native", "plan", 0, "geography_geojson"), {}, "retained study area"),
        ("inferred uploaded country", ("context", "context", "after", "contextState", "context", "place", "countryCode"), "US", "uploaded area infers no jurisdiction"),
        ("inferred tribal jurisdiction", ("context", "context", "after", "contextState", "context", "assessment", "authorities", 1, "jurisdiction"), {"country": "US", "subdivision": "CA"}, "separate authorities"),
        ("source lost", ("context", "context", "after", "contextState", "context", "assessment", "applicability", "sourceUrls"), [], "selected authority and sources retained"),
        ("saved hash changed", ("native", "plan", 0, "plan_context_hash"), "other", "context hash and native result"),
        ("old copies lost", ("fixed", "context", "localCopies"), [], "original bases preserved"),
        ("stop retry changed", ("stop", "browser", "requests", 2, "body"), "{}", "stop withholds creation then retries exact bytes"),
    ]
    results = []
    for name, path, value, expected in faults:
        changed = copy.deepcopy(data)
        target = changed
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        failed = [key for key, passed in verify(changed).items() if not passed]
        assert expected in failed, (name, failed)
        results.append({"fault": name, "failed": failed})
    downloads = []
    for group, name in [("start", "browser-download-muydzc41-a-openplan-plan-creation.json"), ("context", "browser-download-muye19gn-b-openplan-context-draft.json")]:
        record = data[group]["browser" if group == "start" else "context"]["downloads"][0]
        raw = (Path.home() / ".t3/userdata/browser-artifacts" / name).read_bytes()
        assert raw == record["text"].encode() and len(raw) == record["size"]
        downloads.append({"name": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    print(json.dumps({"checks": baseline, "harmlessControl": "passed", "targetedFaults": results, "downloads": downloads,
                      "blindCategory": "Checks recorded observations only. Does not rerun product mutations, browser events, or native producers."}, indent=2))


if __name__ == "__main__":
    main()
