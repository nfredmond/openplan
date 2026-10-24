"""Observe table metadata at pre-chunk source boundaries without replacing engine code."""
import json
import os
from pathlib import Path
import runpy
import sys
import time

import numpy as np
import pandas as pd

stream = open(sys.argv[1], 'x', buffering=1)
sys.argv = ['activitysim', *sys.argv[2:]]
started = time.monotonic()


def metadata(value):
    if isinstance(value, pd.DataFrame):
        usage = value.memory_usage(index=False, deep=True)
        return {'rows': len(value), 'columns': len(value.columns),
                'index_dtype': str(value.index.dtype), 'index_bytes': int(value.index.memory_usage(deep=True)),
                'bytes_deep': int(usage.sum() + value.index.memory_usage(deep=True)),
                'fields': {str(c): {'dtype': str(value[c].dtype), 'bytes_deep': int(usage[c])} for c in value}}
    if isinstance(value, pd.Series):
        return {'rows': len(value), 'dtype': str(value.dtype),
                'bytes_deep': int(value.memory_usage(index=False, deep=True))}
    if isinstance(value, np.ndarray):
        return {'shape': list(value.shape), 'dtype': str(value.dtype), 'bytes': int(value.nbytes)}
    return None


def record(frame, event):
    local = frame.f_locals
    payload = {'elapsed_seconds': time.monotonic()-started, 'event': event,
               'source': frame.f_code.co_filename.split('/activitysim/')[-1],
               'function': frame.f_code.co_name, 'line': frame.f_lineno,
               'rss_bytes': int(Path('/proc/self/statm').read_text().split()[1])*os.sysconf('SC_PAGE_SIZE'),
               'tables': {k: info for k, v in local.items() if (info := metadata(v)) is not None}}
    for key in ('variables', 'temps', '_locals_dict', 'values'):
        value = local.get(key)
        if isinstance(value, dict):
            payload[key] = {str(k): info for k, v in value.items() if (info := metadata(v)) is not None}
    if frame.f_code.co_name == 'run_location_logsums' and event == 'call':
        payload['pipeline'] = {k: info for k, v in local['state']._context.items() if (info := metadata(v)) is not None}
        parent = frame.f_back
        while parent:
            spc = parent.f_locals.get('shadow_price_calculator', parent.f_locals.get('spc'))
            if spc is not None:
                payload['shadow_price_calculator'] = {k: info for k, v in vars(spc).items() if (info := metadata(v)) is not None}
                break
            parent = parent.f_back
    if 'target' in local:
        payload['target'] = str(local['target'])
    stream.write(json.dumps(payload)+'\n')


def trace(frame, event, arg):
    filename = frame.f_code.co_filename
    name = frame.f_code.co_name
    selected = {'run_location_logsums', 'compute_location_choice_logsums', 'assign_variables',
                'assign_columns', 'df_from_dict', 'assign_in_place', 'simple_simulate_logsums'}
    if '/activitysim/' not in filename or name not in selected:
        return None
    parent = frame
    grade = False
    while parent:
        if 'school_location' in str(parent.f_locals.get('trace_label', '')) and 'gradeschool' in str(parent.f_locals.get('trace_label', '')):
            grade = True
            break
        parent = parent.f_back
    if not grade:
        return None
    boundaries = {'run_location_logsums': {558, 563, 565, 567, 571, 586},
                  'compute_location_choice_logsums': {242, 247, 255},
                  'assign_variables': {314, 323, 349, 438, 463, 465, 472},
                  'assign_columns': {173, 175}, 'df_from_dict': {489, 490, 498}}
    if event in ('call', 'return') or (event == 'line' and frame.f_lineno in boundaries.get(name, set())):
        record(frame, event)
    return trace


sys.settrace(trace)
runpy.run_module('activitysim', run_name='__main__')
