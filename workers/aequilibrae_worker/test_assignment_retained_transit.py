"""Execute the actual assignment mode-choice branch with retained transit inputs."""
import ast
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
import model_geometry_inputs
from model_zone_geometry import read_assignment_geometry
import test_model_transit_execution as fixtures
from test_model_skip_dispatch import aeq

ASSIGNMENT_SOURCE=(Path(__file__).parent/'main.py').read_text()

class AssignmentRetainedTransitTests(unittest.TestCase):
    def setUp(self):
        fixtures.TransitExecutionTests.setUp(self)
        self.package=self.root/'package';self.package.mkdir()
        (self.package/'zone_attributes.csv').write_text('zone_id,centroid_lon,centroid_lat,area_sq_mi\n20,-121.050,39.200,2\n10,-121.070,39.220,1\n')
        geometry=read_assignment_geometry(self.package,[20,10])
        self.prepared['geometry_record']=model_geometry_inputs.retain(geometry,self.root/'assignment-geometry')
        tree=ast.parse(ASSIGNMENT_SOURCE)
        stage=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='stage_assignment')
        self.branch=next(n for n in ast.walk(stage) if isinstance(n,ast.If) and ast.unparse(n.test)=='should_apply_trip_based_mode_split(demand_is_vehicle)')

    def execute(self):
        namespace=dict(vars(aeq))
        def forbidden(*args,**kwargs):raise AssertionError('Retained assignment must not discover another feed')
        namespace.update(pkg_dir=str(self.package),ordered_zone_ids=[20,10],n_zones=2,
            demand_is_vehicle=False,should_apply_trip_based_mode_split=lambda value:True,
            transit_inputs_override=self.prepared,out_dir=str(self.root),log='',mode_split=None,
            od_array=np.array([[10.,100.],[100.,10.]]),time_skim=np.array([[1.,5.],[5.,1.]]),
            od_full=pd.DataFrame([[10,100],[100,10]],index=[20,10],columns=['20','10']),
            auto_od_path=str(self.package/'auto.csv'),_clear_stale_auto_od=lambda:None,
            resolve_transit_feed_plan=forbidden)
        exec(compile(ast.Module(body=[self.branch],type_ignores=[]),'main.py','exec'),namespace)
        return namespace

    def test_actual_mode_choice_uses_retained_result_and_writes_auto_matrix(self):
        result=self.execute()
        self.assertEqual(result['mode_split']['transit_status'],'modeled')
        self.assertEqual(result['mode_split']['transit_los']['feed_origin'],'operator_path')
        self.assertEqual(result['mode_split']['transit_los']['skim_settings']['flat_fare_usd'],7)
        self.assertTrue((self.package/'auto.csv').is_file())
        self.assertEqual(list(pd.read_csv(self.package/'auto.csv',index_col=0).index),[20,10])

    def test_changed_assignment_geometry_stops_without_auto_fallback(self):
        path=self.package/'zone_attributes.csv';path.write_text(path.read_text().replace('39.200','39.201'))
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.execute()
        self.assertFalse((self.package/'auto.csv').exists())

    def test_corrupted_feed_stops_without_auto_fallback(self):
        (Path(self.prepared['record']['package_directory'])/'feed.zip').write_bytes(b'changed')
        with self.assertRaises(aeq.WorkerStateWriteUnconfirmed):self.execute()
        self.assertFalse((self.package/'auto.csv').exists())

if __name__=='__main__':unittest.main()
