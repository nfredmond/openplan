from pathlib import Path
import hashlib
import json
import re
import subprocess

review = Path(__file__).resolve().parent
repo = review.parents[2]
migration = repo / "openplan/supabase/migrations/20261014000001_engagement_response_history.sql"
original = migration.read_text()
probe = (review / "history-probe.sql").read_text()
command = ["docker", "exec", "-i", "supabase_db_openplan-restore-target-2026091050", "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"]
check = subprocess.run(command + ["-Atc", "SELECT to_regclass('public.engagement_response_history') IS NULL"], capture_output=True, text=True, check=True)
assert check.stdout.strip() == "t", "Probe requires unapplied history migration"
backfill = original.index("INSERT INTO public.engagement_response_history(")
cases = [
 ("harmless-comment", original + "\n-- Harmless probe control.\n", None),
 ("missing-legacy-baseline", original[:backfill], "HISTORY: truthful legacy baseline"),
 ("missing-update-capture", original.replace("AFTER INSERT OR UPDATE ON", "AFTER INSERT ON"), "HISTORY: complete ordered transitions"),
 ("missing-removal-copy", original.replace("IF TG_OP = 'DELETE' THEN\n    INSERT", "IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;\n  IF TG_OP = 'DELETE' THEN\n    INSERT"), "HISTORY: removal retained"),
 ("mutable-history", re.sub(r"CREATE TRIGGER engagement_response_history_immutable.*?refuse_engagement_history_change\(\);", "", original, flags=re.S), "HISTORY: immutable even for privileged writers"),
 ("membership-filter-still-protected-by-campaign-rls", original.replace("AND m.user_id = auth.uid()", ""), None),
 ("public-history-policy", re.sub(r"FOR SELECT TO authenticated USING \(.*?\n  \);", "FOR SELECT TO authenticated USING (true);", original, flags=re.S), "HISTORY: outsider denied"),
 ("viewer-history", original.replace("'owner', 'admin', 'member'", "'owner', 'admin', 'member', 'viewer'"), "HISTORY: viewer denied"),
 ("moving-response-campaign", original.replace("IF NEW.id IS DISTINCT FROM OLD.id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id THEN", "IF false THEN"), "HISTORY: campaign identity"),
 ("ignore-nested-source-change", original.replace("BEGIN\n  IF TG_OP", "BEGIN\n  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;\n  IF TG_OP"), "HISTORY: source withdrawal retained"),
 ("wrong-snapshot-checksum", original.replace("record_json::text, 'sha256'", "record_json::text, 'sha512'"), "HISTORY: snapshot checksum"),
]
results = []
for name, sql, expected in cases:
 assert sql != original, name
 run = subprocess.run(command, input="BEGIN;\n" + sql + "\n" + probe + "\nROLLBACK;\n", capture_output=True, text=True, timeout=60)
 matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
 results.append({"name": name, "outcome": "survived" if run.returncode == 0 else "killed", "matched": matched, "expected": expected, "stderr": run.stderr[:1800]})
 (review / "history-mutations.json").write_text(json.dumps({"stack": "openplan-restore-target-2026091050", "scope": "Transactional SQL, not HTTP or browser acceptance", "migrationSha256": hashlib.sha256(original.encode()).hexdigest(), "results": results}, indent=2) + "\n")
 print(name, results[-1]["outcome"], "matched=" + str(matched), flush=True)
 if not matched: raise RuntimeError(run.stderr)
assert migration.read_text() == original
check = subprocess.run(command + ["-Atc", "SELECT to_regclass('public.engagement_response_history') IS NULL"], capture_output=True, text=True, check=True)
assert check.stdout.strip() == "t", "History probe did not roll back"
print("All transactions rolled back; source unchanged")
