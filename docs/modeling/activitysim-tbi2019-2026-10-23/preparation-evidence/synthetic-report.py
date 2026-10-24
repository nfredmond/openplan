"""Publish synthetic record accounting only, without a survey or model opening."""
from pathlib import Path
import sys
import json
from dataclasses import replace, asdict
ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT/'scripts/modeling'), str(ROOT/'scripts/modeling/tests')]
from test_tbi2019_tours import DAY, pair, trip, time, WORK, EAT, HOME, SHOP, AUTO
import tbi2019_tours as adapter

cases = []
for reason, field, value in [
    ('incomplete_diary','complete',False), ('diary_completeness_unverified','complete',None),
    ('missing_household_weight','household_weight',None), ('missing_person_weight','person_weight',None),
    ('missing_day_weight','day_weight',None), ('proxy','proxy',True)]:
    cases.append((reason, replace(DAY, **{field:value}), pair()))
for reason, changes in [
    ('missing_time',{'depart':None}), ('overnight',{'arrive':time(10).replace(day=16)}),
    ('invalid_time_order',{'arrive':time(8)}), ('ambiguous_continuity',{'origin':None}),
    ('out_of_region',{'in_region':False}), ('geography_unverified',{'in_region':None}),
    ('unknown_purpose',{'destination_purpose':'unmapped'}), ('unsupported_purpose',{'destination_purpose':'Other reason'}),
    ('university_unverified',{'destination_purpose':'College/university'}),
    ('unknown_mode',{'raw_mode':'unmapped'}), ('unsupported_mode',{'raw_mode':'School bus'}),
    ('auto_evidence_missing',{'raw_mode':AUTO,'driver':None}),
    ('transit_access_unverified',{'raw_mode':'Local bus'}), ('quality_unverified',{'trace_ok':None}),
    ('trace_quality',{'trace_ok':False}), ('derived_child',{'derived_child':True}),
    ('joint_unverified',{'joint':None}), ('joint',{'joint':True}),
    ('incomplete_chain',{'origin':'other-home'}), ('mixed_family',{'raw_mode':AUTO}),
]:
    cases.append((reason, DAY, [replace(pair()[0], **changes), pair()[1]]))
cases += [('duplicate_trip',DAY,[pair()[0],replace(pair()[1],id=1)]),('unmatched_day',None,pair())]
assert {c[0] for c in cases} == set(adapter.REASONS)
rows,days=[],[]
for i,(reason,day,trips) in enumerate(cases,1):
    converted=[replace(t,id=i*10+t.id,household=i,person=i*10,day=i*100) for t in trips]
    diary=None if day is None else replace(day,household=i,person=i*10,day=i*100)
    result=adapter.construct_tours([] if diary is None else [diary], converted)
    assert result['dropped_trips_by_reason'][reason]==2,(reason,result)
    rows.extend(converted)
    if diary:days.append(diary)
# A complete work tour with a nested work-based lunch excursion.
i=100
work=[trip(1,'home','work',HOME,WORK,7,8),trip(2,'work','cafe',WORK,EAT,12,12),
      trip(3,'cafe','work',EAT,WORK,13,13),trip(4,'work','home',WORK,HOME,17,18)]
rows += [replace(t,id=1000+t.id,household=i,person=i*10,day=i*100) for t in work]
days.append(replace(DAY,household=i,person=i*10,day=i*100))
days.append(replace(DAY,household=101,person=1010,day=10100))
result=adapter.construct_tours(days,rows)
assert result['retained_trips']==4
assert all(n==2 for n in result['dropped_trips_by_reason'].values())
assert len(result['atwork_subtours'])==1
assert len(result['joint_travel_tours'])==1
assert result['zero_trip_days']==1
for name in ['tours','atwork_subtours','joint_travel_tours']:
    result[name]=[asdict(t) for t in result[name]]
result['scope']='Entirely synthetic; not a respondent distribution, model run, or comparison'
Path(__file__).with_name('synthetic-accounting.json').write_text(json.dumps(result,indent=2)+'\n')
print(f"Synthetic accounting: {len(rows)} trips, 4 retained, {sum(result['dropped_trips_by_reason'].values())} excluded, {len(adapter.REASONS)} reasons.")
