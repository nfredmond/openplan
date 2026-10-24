import sys,unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from activitysim_bounded_logsums import group_slices,bounded_location_logsums

class BoundedLogsumTests(unittest.TestCase):
    def test_complete_groups_and_original_order(self):
        self.assertEqual([(s.start,s.stop) for s in group_slices([9,9,2,2,2,5],4)],[(0,2),(2,6)])
        self.assertEqual([(s.start,s.stop) for s in group_slices([9,9,9,2],2)],[(0,3),(3,4)])

    def test_noncontiguous_groups_refused(self):
        with self.assertRaisesRegex(ValueError,'contiguous'):group_slices([1,2,1],2)

    def test_invalid_bounds_refused(self):
        for bound in [0,-1,True,2.5]:
            with self.subTest(bound=bound),self.assertRaises(ValueError):group_slices([1],bound)

    def test_values_index_and_nonlogsum_columns_preserved(self):
        calls=[]
        def original(state,location_sample_df,factor):
            calls.append(location_sample_df.index.tolist())
            location_sample_df['mode_choice_logsum']=location_sample_df['destination']*factor
            return location_sample_df
        frame=pd.DataFrame({'destination':[2,4,6,8,10,12],'pick_count':[1,2,1,1,3,1]},index=[9,9,2,2,2,5])
        before=frame.copy()
        result=bounded_location_logsums(original,max_rows=4)(None,frame,factor=.5)
        self.assertIs(result,frame)
        pd.testing.assert_frame_equal(result.drop(columns='mode_choice_logsum'),before)
        np.testing.assert_array_equal(result.mode_choice_logsum,[1,2,3,4,5,6])
        self.assertEqual(calls,[[9,9],[2,2,2,5]])

    def test_reordered_result_refused(self):
        def original(location_sample_df):
            result=location_sample_df.iloc[::-1].copy();result['mode_choice_logsum']=0.;return result
        frame=pd.DataFrame({'destination':[1,2]},index=[1,2])
        with self.assertRaisesRegex(ValueError,'order'):
            bounded_location_logsums(original,max_rows=2)(frame)

    def test_empty_uses_original_refusal(self):
        def original(location_sample_df):raise ValueError('empty original refusal')
        with self.assertRaisesRegex(ValueError,'original refusal'):
            bounded_location_logsums(original)(pd.DataFrame())

if __name__=='__main__':unittest.main()
