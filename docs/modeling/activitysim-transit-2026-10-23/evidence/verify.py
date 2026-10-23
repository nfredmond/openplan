"""Run the three scoped Python suites with an explicitly supplied stock model."""
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[4]
sys.path[:0]=[str(ROOT/'scripts/modeling/tests'),str(ROOT/'scripts/modeling')]
import test_activitysim_mtc_inputs as mtc
mtc.STOCK_ROOT=Path(sys.argv[1])
suite=unittest.defaultTestLoader.loadTestsFromNames(['test_activitysim_transit_skims','test_activitysim_mtc_inputs','test_build_activitysim_input_bundle'])
r=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not r.wasSuccessful())
