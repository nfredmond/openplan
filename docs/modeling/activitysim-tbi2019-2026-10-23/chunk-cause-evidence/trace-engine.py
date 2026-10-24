"""Observe installed engine calls without changing code, inputs, or returned values."""
import json
import runpy
import sys
from pathlib import Path

trace_path = Path(sys.argv[1])
sys.argv = ['activitysim'] + sys.argv[2:]
stream = trace_path.open('x')
ids = {914860869, 914860870, 914860871, 914860864}
files = {'trip_scheduling.py', 'probabilistic_scheduling.py', 'logit.py'}
functions = {'run_trip_scheduling', 'update_tour_earliest', 'make_scheduling_choices', 'make_choices'}


def rows(frame):
    if frame is None or not hasattr(frame, 'index'):
        return None
    selected = frame.loc[frame.index.isin(ids)]
    return json.loads(selected.to_json(orient='index'))


def observe(frame, event, result):
    if event not in ('call', 'return'):
        return
    name = frame.f_code.co_name
    if name not in functions or Path(frame.f_code.co_filename).name not in files:
        return
    local = frame.f_locals
    data = local.get('trips_chunk', local.get('trips', local.get('choosers_df', local.get('probs'))))
    selected = rows(data)
    if not selected:
        return
    record = {'function': name, 'event': event, 'trace_label': local.get('trace_label'), 'rows': selected,
              'row_count': len(data)}
    for key in ['first_trip_in_leg', 'is_last_iteration', 'logic_version']:
        if key in local:
            record[key] = local[key]
    if hasattr(data, 'outbound'):
        record['any_outbound'] = bool(data.outbound.any())
    if name == 'make_choices' and event == 'call':
        channel = local['state'].get_rn_generator().get_channel_for_df(data)
        record['rng_channel'] = channel.channel_name
        if channel:
            record['rng_rows'] = rows(channel.row_states)
    if event == 'return':
        if name == 'make_choices':
            record['choices'] = rows(result[0]); record['rands'] = rows(result[1])
        else:
            record['choices'] = rows(result)
    stream.write(json.dumps(record, sort_keys=True) + '\n'); stream.flush()

sys.setprofile(observe)
try:
    runpy.run_module('activitysim', run_name='__main__')
finally:
    sys.setprofile(None)
    stream.close()
