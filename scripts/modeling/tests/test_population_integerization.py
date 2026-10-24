"""Whole-household integerization must preserve source bounds and identity."""
import sys,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from population_synthesis import Control,PopulationSynthesisError
from population_integerization import controlled_counts


class IntegerizationTests(unittest.TestCase):
    def setUp(self):
        self.patterns=np.array([[1,0,1],[0,1,4]],dtype=float)
        self.inverse=np.array([0,0,1,1]);self.weights=[2.2,3.3,1.5,3.0]
        self.controls=[Control('size','household',('one','four')),Control('persons','person',('all',))]
        self.target={'size':{'one':5,'four':5},'persons':{'all':25}}
        self.margins={'size':{'one':0,'four':0},'persons':{'all':0}}

    def run_counts(self, **kwargs):
        args=dict(patterns=self.patterns,inverse=self.inverse,weights=self.weights,controls=self.controls,
                  targets=self.target,margins=self.margins);args.update(kwargs)
        return controlled_counts(**args)

    def test_exact_total_and_bounds_with_whole_seed_records(self):
        counts=self.run_counts()
        self.assertEqual(counts,[2,3,2,3])
        self.assertEqual(sum(counts),10)
        np.testing.assert_array_equal(self.patterns.T@np.bincount(self.inverse,weights=counts),[5,5,25])

    def test_unavailable_and_invalid_margins_refuse(self):
        with self.assertRaisesRegex(PopulationSynthesisError,'needs published margins'):self.run_counts(margins=None)
        for v in [float('nan'),-1,float('inf')]:
            with self.assertRaisesRegex(PopulationSynthesisError,'margins must'):
                self.run_counts(margins={'size':{'one':v,'four':0},'persons':{'all':0}})

    def test_invalid_household_total_refuses(self):
        with self.assertRaisesRegex(PopulationSynthesisError,'household total'):
            self.run_counts(targets={'size':{'one':5.5,'four':5},'persons':{'all':25}})
        with self.assertRaisesRegex(PopulationSynthesisError,'needs a household total'):
            self.run_counts(controls=[Control('size','person',('one','four')),Control('persons','person',('all',))])

    def test_inconsistent_problem_remains_failed(self):
        with self.assertRaisesRegex(PopulationSynthesisError,'integerization failed'):
            self.run_counts(targets={'size':{'one':5,'four':5},'persons':{'all':100}})

    def test_false_solver_success_does_not_waive_bounds(self):
        with patch('scipy.optimize.milp',return_value=SimpleNamespace(success=True,x=np.array([6,4,0,0]))):
            with self.assertRaisesRegex(PopulationSynthesisError,'unchanged published bounds'):self.run_counts()

    def test_pattern_allocation_must_match_solution(self):
        with patch('population_integerization.integerize_weights',return_value=[0,0]):
            with self.assertRaisesRegex(PopulationSynthesisError,'allocation differs'):self.run_counts()


if __name__=='__main__':unittest.main()
