# Reproduce original outcome recovery checks

Run source checks from the repository root. Use a new private output directory
for each run. Each source campaign runs four full positive cohorts, then restores
all mutated source and test bytes in `finally`.

```bash
python3 -B docs/reviews/2026-10-14-outcome-recovery/verify_controls.py \
  --repo "$PWD" --out /absolute/private/new-source-proof
python3 -B docs/reviews/2026-10-14-outcome-recovery/verify_oracle_controls.py \
  --repo "$PWD" --out /absolute/private/new-oracle-proof
```

The second command compiles deliberately changed copies of the local parser in
memory. It changes no worker file. Each broken copy must fail its named diagnostic.
Those controls validate counts, diagnostic kinds, upstream validation and unique
summaries. They do not establish the worker's database or application behavior.

The native driver requires the retained isolated restored-415 proof and its
recorded capture. It verifies container identity, disk margin, complete history,
SQL body, grants and source hashes before cloning. It does not reset or delete
the original database. Its temporary PostgREST container and owned PostgreSQL
process stop in cleanup; proof databases and captures remain retained.

```bash
python3 -B docs/reviews/2026-10-14-outcome-recovery/native_http.py \
  --repo "$PWD" --proof /absolute/private/retained-restored-415-proof \
  --out /absolute/private/new-native-proof
```

That native command is a retained-fixture reproduction on this installation.
It is not an independent-host installation procedure. Credentials and raw private
logs stay outside the repository. Public result files preserve test counts,
source bindings, fault dispositions and limits. The fixture writes the callback
ledger directly, so a passing native campaign does not establish the application
callback route, new processing work or default operation.
