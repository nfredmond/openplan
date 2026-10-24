"""Observe allocation metadata without changing engine functions, choices, or inputs."""
import json
import os
from pathlib import Path
import runpy
import sys
import time

import pandas as pd
import numpy as np

stream = open(sys.argv[1], 'x', buffering=1)
sys.argv = ['activitysim', *sys.argv[2:]]
started = time.monotonic()


def profile(frame, event, arg):
    if event not in ('call', 'return'):
        return
    name = frame.f_code.co_name
    filename = frame.f_code.co_filename
    if 'activitysim/' not in filename:
        return
    if name not in ('run_location_logsums', 'compute_location_choice_logsums', '_simple_simulate_logsums', 'get_skim_data', 'eval_utilities', 'eval_nl_logsums'):
        return
    local = frame.f_locals
    label = str(local.get('trace_label', local.get('skim_tag', '')))
    if name != 'get_skim_data' and 'school_location' not in label:
        return
    tables = {}
    for key, value in local.items():
        if isinstance(value, (pd.DataFrame, pd.Series)):
            usage = value.memory_usage(index=True, deep=True)
            tables[key] = {'rows': len(value), 'bytes_deep': int(usage.sum() if hasattr(usage, 'sum') else usage)}
    arrays = {key: {'shape': list(value.shape), 'dtype': str(value.dtype), 'bytes': value.nbytes} for key, value in local.items() if isinstance(value, np.ndarray)}
    record = {'arrays': arrays, 'elapsed_seconds': time.monotonic()-started, 'function': name, 'event': event,
              'label': label, 'rss_bytes': int(Path('/proc/self/statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE'),
              'local_tables': tables}
    if name == 'run_location_logsums' and event == 'call':
        state = local['state']
        record['pipeline_tables'] = {k: {'rows': len(v), 'bytes_deep': int(v.memory_usage(index=True, deep=True).sum())}
            for k, v in state._context.items() if isinstance(v, pd.DataFrame)}
    info = local.get('skim_info')
    if info is not None:
        record['skims'] = {'dtype': info.dtype_name, 'count': info.num_skims, 'shape': info.skim_data_shape}
    stream.write(json.dumps(record)+'\n')


sys.setprofile(profile)
runpy.run_module('activitysim', run_name='__main__')
