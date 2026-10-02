"""Confine map regression fault injection to a disposable source copy."""
from pathlib import Path
import json, shutil, subprocess, tempfile

root = Path(__file__).resolve().parents[4]
app = root / 'openplan'
report = Path(__file__).with_suffix('.json')
case = 'src/test/census-overlay-availability.test.ts'
route_case = 'src/test/engagement-representativeness-route.test.ts'
census = 'src/lib/data-sources/census.ts'
geometry = 'src/lib/data-sources/census-geometry.ts'
palette = 'src/app/(app)/explore/_components/_helpers.ts'
route = 'src/app/api/engagement/campaigns/[campaignId]/representativeness/route.ts'
faults = [
    ('minority_source', census, 'pctMinority: totalPopRace > 0 && numOrNull("B03002_003E") !== null,', 'pctMinority: true,', 'withholds pctMinority'),
    ('poverty_source', census, 'pctBelowPoverty: povertyTotal > 0 && numOrNull("B17001_002E") !== null,', 'pctBelowPoverty: true,', 'withholds pctBelowPoverty'),
    ('vehicle_source', census, 'zeroVehiclePct: totalHH > 0 && numOrNull("B25044_003E") !== null && numOrNull("B25044_010E") !== null,', 'zeroVehiclePct: true,', 'withholds zeroVehiclePct'),
    ('commute_source', census, 'transitCommutePct: num("B08301_001E") > 0 && numOrNull("B08301_010E") !== null,', 'transitCommutePct: true,', 'withholds transitCommutePct'),
    ('geometry_boundary', geometry, 'tract.overlayAvailability?.pctBelowPoverty === false ? null : tract.pctBelowPoverty', 'tract.pctBelowPoverty', 'withholds pctBelowPoverty'),
    ('income_palette', palette, 'if (metricKey === "medianIncome") {\n    return paintWhereMeasured("medianIncome", [\n      "interpolate",\n      ["linear"],\n      ["to-number", ["get", "medianIncome"]],\n      0,\n      "#7f1d1d",', 'if (metricKey === "medianIncome") {\n    return paintWhereMeasured("medianIncome", [\n      "interpolate",\n      ["linear"],\n      ["to-number", ["get", "medianIncome"]],\n      0,\n      "#64748b",', 'retains measured zero'),
    ('route_projection', route, '        overlayAvailability: tract.overlayAvailability,\n', '', 'retains ACS field availability'),
]
results = []
with tempfile.TemporaryDirectory(prefix='openplan-map-mutations-') as temp:
    copy = Path(temp)
    shutil.copytree(app/'src', copy/'src')
    for filename in ['package.json', 'vitest.config.ts']:
        shutil.copy2(app/filename, copy/filename)
    (copy/'node_modules').symlink_to(app/'node_modules', target_is_directory=True)
    def run():
        proc = subprocess.run(['node', str(app/'node_modules/vitest/vitest.mjs'), 'run', case, route_case], cwd=copy, capture_output=True, text=True)
        return proc.returncode, proc.stdout+proc.stderr
    for name, filename, old, new, reason in faults:
        path = copy/filename
        original = path.read_text()
        assert original.count(old)==1, (name, 'ambiguous mutation')
        path.write_text(original+'\n// Harmless map availability verification control.\n')
        control_code, control = run()
        path.write_text(original.replace(old, new, 1))
        fault_code, fault = run()
        path.write_text(original)
        detected = fault_code != 0 and 'AssertionError' in fault and reason in fault
        results.append({'name':name,'harmless_exit':control_code,'fault_exit':fault_code,'expected_failure':reason,'detected':detected,'fault_output':fault})
        assert control_code == 0 and detected, results[-1]
report.write_text(json.dumps(results,indent=2)+'\n')
print(f'{len(results)} harmless controls passed and {len(results)} targeted faults detected.')
