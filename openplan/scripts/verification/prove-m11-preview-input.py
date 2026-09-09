"""Local forecast controls. Does not establish browser or maximum-size delivery."""
from pathlib import Path
import json
import subprocess

root = Path(__file__).resolve().parents[2]
scratch = Path.home() / '.local/state/openplan/m11-resumed-acceptance-2026-09-08'
scratch.mkdir(parents=True, exist_ok=True)
results = []
capacity_test = 'keeps dated capacity revisions'
form_test = 'cancels pending work and clears completed previews when forecast form fields change'
controls = [
 ('harmless-comment', 'lib/invoicing/contracts/delivery.ts', '/** Compute only', '/** Cached per call. Compute only', 'contract-delivery.test.ts', None),
 ('reservation-overwritten', 'lib/invoicing/contracts/delivery.ts', 'if(own)own.hours+=hours;', 'if(own)own.hours=hours;', 'contract-delivery.test.ts', "sums this assignment's shared daily reservations once"),
 ('old-reservation-format', 'lib/invoicing/contracts/delivery.ts', 'formatVersion:2,asOf', 'formatVersion:1,asOf', 'contract-delivery.test.ts', "sums this assignment's shared daily reservations once"),
 ('capacity-date-omitted', 'lib/invoicing/contracts/delivery.ts', 'const key=`${staffId}:${date}`;', 'const key=staffId;', 'contract-delivery.test.ts', capacity_test),
 ('overlap-treated-as-known', 'lib/invoicing/contracts/delivery.ts', 'periods.length!==1?null:', 'periods.length===0?null:', 'contract-delivery.test.ts', capacity_test),
 ('warning-date-omitted', 'lib/invoicing/contracts/delivery.ts', 'JSON.stringify([code,nodeId,staffId,date])', 'JSON.stringify([code,nodeId,staffId])', 'contract-delivery.test.ts', capacity_test),
 ('form-edit-keeps-worker', 'components/invoicing/contracts/delivery-management.tsx', 'onChange={()=>{job.current?.cancel();', 'onChange={()=>{', 'contract-forecast-preview.test.tsx', form_test),
 ('form-edit-keeps-preview', 'components/invoicing/contracts/delivery-management.tsx', 'setCalculating(null);setPreview(null);setError("");}} onSubmit', 'setCalculating(null);setError("");}} onSubmit', 'contract-forecast-preview.test.tsx', form_test),
 ('group-drops-earlier-dates', 'components/invoicing/contracts/forecast-warnings.tsx', 'const group=groups.get(key)??[];', 'const group:ForecastWarning[]=[];', 'contract-review-layout.test.tsx', 'groups repeated warnings while retaining every date'),
]
for name, file, old, new, test, reason in controls:
    path = root / 'src' / file
    original = path.read_text()
    assert original.count(old) == 1, name
    try:
        path.write_text(original.replace(old, new))
        cmd = ['npm', 'exec', '--', 'vitest', 'run', 'src/test/' + test]
        if reason:
            cmd.extend(['-t', reason])
        process = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
        output = process.stdout + process.stderr
        (scratch / (name + '.log')).write_text(output)
        assert (process.returncode == 0 if reason is None else process.returncode != 0 and 'FAIL ' in output and reason in output), name + '\n' + output[-3500:]
        results.append({'name': name, 'outcome': 'survived' if reason is None else 'killed', 'test': reason})
        print(name, results[-1]['outcome'], flush=True)
    finally:
        path.write_text(original)
(root.parent / 'docs/reviews/2026-09-08-m11-delivery/resumed-preview-controls.json').write_text(json.dumps(results, indent=2) + '\n')
