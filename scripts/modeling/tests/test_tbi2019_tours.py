"""Synthetic diaries only. No HTTP, respondent choices, models, or fitting."""
from dataclasses import replace
from datetime import datetime
from pathlib import Path
import sys
import unittest
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tbi2019_tours as adapter

DAY = adapter.Diary(1, 10, 100, '2019-05-15', True, 300., 310., 50., None, False)
HOME = 'Went home'
WORK = 'Primary workplace'
SHOP = 'Grocery shopping'
EAT = 'Dine out/get coffee or take-out'
WALK = 'Walk, jog, or roll using a wheelchair'
AUTO = 'Household vehicle 1'


def time(hour, minute=0):
    return datetime(2019, 5, 15, hour, minute, tzinfo=ZoneInfo('America/Chicago'))


def trip(n=1, origin='home', dest='shop', op=HOME, dp=SHOP, depart=9, arrive=10, mode=WALK, **changes):
    return replace(adapter.Trip(n, 1, 10, 100, time(depart), time(arrive), origin, dest, op, dp,
        mode, True, 'Driver', 1, None, None, False, False, True, 999.), **changes)


def pair(mode=WALK):
    return [trip(mode=mode), trip(2, 'shop', 'home', SHOP, HOME, 11, 12, mode)]


class Tours(unittest.TestCase):
    def run_case(self, rows=None, diary=DAY):
        return adapter.construct_tours([diary], pair() if rows is None else rows)

    def assert_dropped(self, reason, rows=None, diary=DAY):
        result = self.run_case(rows, diary)
        self.assertEqual(result['dropped_trips_by_reason'][reason], 2)
        self.assertEqual(sum(result['dropped_trips_by_reason'].values()), 2)
        self.assertEqual(result['tours'], [])
        return result

    def test_complete_home_tour_and_order_survivor(self):
        result = self.run_case()
        self.assertEqual(result['input_trips'], 2)
        self.assertEqual(result['retained_trips'], 2)
        self.assertEqual(sum(result['dropped_trips_by_reason'].values()), 0)
        self.assertEqual(result['tours'][0], adapter.Tour(1, 10, 100, (1, 2), 'shop', 'shopping', 'walk', 50., 'home_based'))
        self.assertEqual(result, self.run_case(list(reversed(pair()))))
        self.assertEqual(result['raw_modes'], {WALK: 2})
        self.assertEqual(result['mapped_family_trips'], {'walk': 2})
        self.assertEqual(result['scientific_admission'], 'unassessed')

    def test_weights_are_person_day_expansion_not_trip_or_person_weights(self):
        result = self.run_case([replace(t, linked_trip_weight=5. if t.id==1 else 5000.) for t in pair()])
        self.assertEqual(result['tours'][0].weight, 50.)
        rows = pair() + [trip(3, depart=13, arrive=14), trip(4, 'shop', 'home', SHOP, HOME, 15, 16)]
        result = self.run_case(rows)
        self.assertEqual(sum(t.weight for t in result['tours']), 100.)
        self.assertEqual(result['retained_trips'], 4)
        for field, reason in [('household_weight', 'missing_household_weight'), ('person_weight', 'missing_person_weight'), ('day_weight', 'missing_day_weight')]:
            for value in [None, 0, -1, float('nan'), float('inf'), True]:
                with self.subTest(field=field, value=value):
                    self.assert_dropped(reason, diary=replace(DAY, **{field: value}))
        with self.assertRaisesRegex(ValueError, 'missing_day_weight'):
            adapter.tour_weight(replace(DAY, day_weight=0))

    def test_complete_zero_trip_day_is_distinct_from_missing_diary(self):
        self.assertEqual(self.run_case([])['zero_trip_days'], 1)
        result = self.run_case([], replace(DAY, complete=False))
        self.assertEqual(result['zero_trip_days'], 0)
        self.assertEqual(result['excluded_days_by_reason']['incomplete_diary'], 1)
        self.assert_dropped('diary_completeness_unverified', diary=replace(DAY, complete=None))
        result = adapter.construct_tours([], pair())
        self.assertEqual(result['dropped_trips_by_reason']['unmatched_day'], 2)
        with self.assertRaisesRegex(ValueError, 'duplicate diary'):
            adapter.construct_tours([DAY, DAY], pair())

    def test_primary_priority_dwell_and_arrival(self):
        rows = [trip(1, 'home', 'work', HOME, WORK, 7, 8),
                trip(2, 'work', 'shop', WORK, SHOP, 9, 10),
                trip(3, 'shop', 'home', SHOP, HOME, 20, 21)]
        self.assertEqual(self.run_case(rows)['tours'][0].purpose, 'work')
        # With no mandatory purpose, the ten-hour shop activity wins.
        rows[0] = replace(rows[0], destination_purpose=EAT)
        rows[1] = replace(rows[1], origin_purpose=EAT)
        self.assertEqual(self.run_case(rows)['tours'][0].primary_destination, 'shop')
        # Equal one-hour dwell chooses the earlier activity, not the later trip.
        rows[2] = replace(rows[2], depart=time(11), arrive=time(12))
        self.assertEqual(self.run_case(rows)['tours'][0].purpose, 'eating_out')
        university = [trip(1, 'home', 'college', HOME, 'College/university'),
                      trip(2, 'college', 'home', 'College/university', HOME, 11, 12)]
        self.assert_dropped('university_unverified', university)
        result = self.run_case(university, replace(DAY, school_type='4-year college/university'))
        self.assertEqual(result['tours'][0].purpose, 'university')
        for label, expected in [('K-12 school', 'school'), ('Pick-up/drop-off to/from childcare/preschool/adult care', 'escort')]:
            self.assertEqual(adapter.purpose(label, None), (expected, None))

    def test_atwork_subtour_is_nested_and_not_an_extra_home_tour(self):
        rows = [trip(1, 'home', 'work', HOME, WORK, 7, 8),
                trip(2, 'work', 'cafe', WORK, EAT, 12, 12),
                trip(3, 'cafe', 'work', EAT, WORK, 13, 13),
                trip(4, 'work', 'home', WORK, HOME, 17, 18)]
        result = self.run_case(rows)
        self.assertEqual(len(result['tours']), 1)
        self.assertEqual(result['retained_trips'], 4)
        self.assertEqual(result['tours'][0].primary_destination, 'work')
        self.assertEqual(len(result['atwork_subtours']), 1)
        child = result['atwork_subtours'][0]
        self.assertEqual((child.category, child.purpose, child.trip_ids, child.parent_trip_ids),
                         ('atwork', 'eating_out', (2, 3), (1, 2, 3, 4)))
        # A different workplace is not a return to the parent's workplace.
        rows[2] = replace(rows[2], destination='other-work')
        rows[3] = replace(rows[3], origin='other-work')
        self.assertEqual(self.run_case(rows)['atwork_subtours'], [])

    def test_chain_faults_never_bridge_to_a_complete_tour(self):
        for reason, changes in [
            ('missing_time', {'depart': None}), ('missing_time', {'depart': time(9).replace(tzinfo=None)}),
            ('overnight', {'arrive': time(10).replace(day=16)}),
            ('invalid_time_order', {'arrive': time(8)}),
            ('ambiguous_continuity', {'destination': 'other'}),
            ('ambiguous_continuity', {'origin': None}),
            ('out_of_region', {'in_region': False}), ('geography_unverified', {'in_region': None}),
            ('unknown_purpose', {'destination_purpose': 'invented'}),
            ('unsupported_purpose', {'destination_purpose': 'Other reason'}),
            ('unknown_mode', {'raw_mode': 'predicted-walk'}),
            ('unsupported_mode', {'raw_mode': 'School bus'}),
            ('trace_quality', {'trace_ok': False}), ('quality_unverified', {'trace_ok': None}),
            ('quality_unverified', {'derived_child': None}), ('derived_child', {'derived_child': True}),
            ('joint_unverified', {'joint': None}), ('joint', {'joint': True}),
        ]:
            with self.subTest(reason=reason, changes=changes):
                self.assert_dropped(reason, [replace(pair()[0], **changes), pair()[1]])
        self.assert_dropped('incomplete_chain', [replace(t, origin='not-home') if t.id==1 else t for t in pair()])
        self.assert_dropped('duplicate_trip', [pair()[0], replace(pair()[1], id=1)])
        self.assert_dropped('invalid_time_order', [pair()[0], replace(pair()[1], depart=time(9))])
        joint = self.assert_dropped('joint', [replace(t, joint=True) for t in pair()])
        self.assertEqual(len(joint['joint_travel_tours']), 1)
        self.assertEqual(joint['joint_travel_tours'][0].trip_ids, (1, 2))
        self.assert_dropped('proxy', diary=replace(DAY, proxy=True))
        self.assert_dropped('quality_unverified', diary=replace(DAY, proxy=None))

    def test_mode_evidence_and_homogeneous_rule(self):
        for label, family in [(AUTO, 'auto'), ('Bicycle owned by my household', 'bicycle'),
                              ('Regular taxi', 'hired'), (WALK, 'walk')]:
            result = self.run_case(pair(label))
            self.assertEqual(result['tours'][0].family, family)
        for changes in [{'driver': None}, {'occupancy': 0}, {'occupancy': True}, {'occupancy': 1, 'driver': 'Passenger'}]:
            self.assert_dropped('auto_evidence_missing', [replace(t, **changes) for t in pair(AUTO)])
        bus = 'Local bus'
        self.assert_dropped('transit_access_unverified', pair(bus))
        transit = [replace(t, transit_access='walk', transit_egress='walk') for t in pair(bus)]
        self.assertEqual(self.run_case(transit)['tours'][0].family, 'transit')
        self.assert_dropped('mixed_family', [pair()[0], pair(AUTO)[1]])

    def test_decoder_never_infers_exact_location_quality_or_access_from_zones(self):
        row = dict(linked_trip_id=1, hh_id=1, person_id=10, day_id=100, survey_year=2019,
            depart_time='2019-05-15T09:00:00', arrive_time='2019-05-15T10:00:00',
            o_purpose=HOME, d_purpose=SHOP, mode_type_detailed=WALK,
            trip_o_taz=1, trip_d_taz=1, linked_trip_weight=999)
        converted = adapter.decode_linked_trip(row, location_evidence={}, quality_evidence={})
        self.assertIsNone(converted.origin)
        self.assertIsNone(converted.trace_ok)
        self.assertIsNone(converted.in_region)
        self.assertEqual(converted.depart, time(9))
        complete = adapter.decode_linked_trip(row, location_evidence={1: ('home', 'shop')},
            quality_evidence={1: {'in_study_region': True, 'trace_ok': True, 'derived_child': False, 'joint': False}})
        self.assertEqual(self.run_case([complete, pair()[1]])['retained_trips'], 2)
        for bad in [{**row, 'survey_year': 2023}, {**row, 'hh_id': True}, {**row, 'day_id': None}]:
            with self.assertRaises(ValueError):
                adapter.decode_linked_trip(bad, location_evidence={}, quality_evidence={})
        for value in ['bad-time', '2019-11-03T01:30:00', '2019-03-10T02:30:00', None]:
            broken = adapter.decode_linked_trip({**row, 'depart_time': value}, location_evidence={}, quality_evidence={})
            self.assertIsNone(broken.depart)


if __name__ == '__main__':
    unittest.main()
