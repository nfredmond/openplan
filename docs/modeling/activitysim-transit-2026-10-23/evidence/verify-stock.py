"""Write and inspect actual installed MTC matrix names with synthetic schedules."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
ROOT=Path(__file__).resolve().parents[4]
sys.path[:0]=[str(ROOT/'scripts/modeling'),str(ROOT/'scripts/modeling/tests')]
import activitysim_mtc_inputs as mtc
from test_activitysim_mtc_inputs import SkimExpansion
from test_activitysim_transit_skims import fixture,ZONES
import numpy as np
import openmatrix as omx
stock=mtc.resolve_stock_prototype_mtc(sys.argv[1])
case=SkimExpansion();case.setUp()
try:
    config=fixture(Path(case.tmp.name)/'synthetic.zip')
    zones=[{**z,**ZONES[i]} for i,z in enumerate(case.skim_zones()[:3])]
    record=case.expand(internal_zone_rows=zones,stock_configs_dir=stock['configs_dir'],stock_skims_omx=stock['stock_skims_omx'],transit_config=config)
    with omx.open_file(str(case.output_omx),'r') as f:
        assert sorted(f.list_matrices())==sorted(mtc.stock_skim_inventory(stock['stock_skims_omx']))
        for name in f.list_matrices():assert np.isfinite(np.array(f[name])).all(),name
        expected={'TOTIVT':2500,'IWAIT':500,'XWAIT':500,'WAIT':1000,'BOARDS':2,'FAR':250,'WAUX':0}
        for period in ('EA','AM','MD','PM','EV'):
            for component,value in expected.items():
                name=f'WLK_LOC_WLK_{component}__{period}'
                assert f[name][0,2]==value,(name,f[name][0,2])
            assert f[f'DRV_LOC_WLK_TOTIVT__{period}'][0,2]==0
            assert f[f'WLK_LRF_WLK_TOTIVT__{period}'][0,2]==0
        assert f['WLK_TRN_WLK_IVT__AM'][0,2]==2500
    record={'activitysim_version':stock['activitysim_version'],'stock_configs_sha256':mtc.stock_configs_digest(stock['configs_dir']),
            'stock_skim_inventory_count':record['matrices_written'],'written_matrix_counts':record['matrix_counts'],
            'required_spec_names':record['required_spec_names'],'artifact_sha256':hashlib.sha256(case.output_omx.read_bytes()).hexdigest(),
            'expected_0_to_2':expected,'all_matrices_finite':True,'activitysim_executions':0}
    Path(__file__).with_name('stock-inventory.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps(record,indent=2))
finally:case.tearDown()
