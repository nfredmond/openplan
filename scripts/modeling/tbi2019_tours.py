"""Outcome-free preparation of the frozen TBI tour contract.

Pure functions only: this module cannot acquire survey records or open a study.
Rules and their limits: docs/modeling/activitysim-tbi2019-2026-10-23/PREPARATION.md.
A caller must supply independently verified exact locations and quality linkage.
A TAZ/block-group match does not establish that two stops are the same place.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
import math
from pathlib import Path
import json
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

CROSSWALK = json.loads(Path(__file__).with_name('tbi2019_crosswalk.v1.json').read_text())
PURPOSE_PRIORITY = {'work': 0, 'university': 1, 'school': 2}
REASONS = (
    'unmatched_day', 'duplicate_trip', 'incomplete_diary', 'diary_completeness_unverified', 'missing_household_weight',
    'missing_person_weight', 'missing_day_weight', 'missing_time', 'overnight',
    'invalid_time_order', 'ambiguous_continuity', 'out_of_region', 'geography_unverified', 'unknown_purpose',
    'unsupported_purpose', 'university_unverified', 'unknown_mode', 'unsupported_mode',
    'auto_evidence_missing', 'transit_access_unverified', 'quality_unverified',
    'trace_quality', 'derived_child', 'proxy', 'joint_unverified', 'joint',
    'incomplete_chain', 'mixed_family',
)


@dataclass(frozen=True)
class Diary:
    household: int
    person: int
    day: int
    date: str
    complete: bool | None
    household_weight: float | None
    person_weight: float | None
    day_weight: float | None
    school_type: str | None
    proxy: bool | None


@dataclass(frozen=True)
class Trip:
    id: int
    household: int
    person: int
    day: int
    depart: datetime | None
    arrive: datetime | None
    origin: str | None
    destination: str | None
    origin_purpose: str | None
    destination_purpose: str | None
    raw_mode: str | None
    in_region: bool | None
    driver: str | None
    occupancy: int | None
    transit_access: str | None
    transit_egress: str | None
    joint: bool | None
    derived_child: bool | None
    trace_ok: bool | None
    linked_trip_weight: float | None = None


@dataclass(frozen=True)
class Tour:
    household: int
    person: int
    day: int
    trip_ids: tuple[int, ...]
    primary_destination: str
    purpose: str
    family: str | None
    weight: float
    category: str
    parent_trip_ids: tuple[int, ...] | None = None


def positive(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def tour_weight(diary: Diary) -> float:
    """Expand a person's daily tour count using the published person-day weight.

    sum_d(day_weight[d] * tours[d]) is the estimator. Repeating that weight on
    each tour is algebraically identical. Do not divide again by days or trips.
    This derived estimator is not a publisher-supplied tour weight and cannot
    reproduce trip-specific nonresponse corrections. No fallback or averaging.
    """
    if not positive(diary.day_weight):
        raise ValueError('missing_day_weight')
    return float(diary.day_weight)


def purpose(label: str | None, school_type: str | None) -> tuple[str | None, str | None]:
    entry = CROSSWALK['purposes'].get(label)
    if entry is None:
        return None, 'unknown_purpose'
    if entry == 'unsupported':
        return None, 'unsupported_purpose'
    if entry == 'university' and school_type not in CROSSWALK['postsecondary_school_types']:
        return None, 'university_unverified'
    return entry, None


def mode_family(trip: Trip) -> tuple[str | None, str | None]:
    """Use the documented detailed mode, never a predicted mode or a fuzzy label."""
    family = CROSSWALK['modes'].get(trip.raw_mode)
    if family is None:
        return None, 'unknown_mode'
    if family == 'unsupported':
        return None, 'unsupported_mode'
    if family == 'auto' and (trip.driver not in ('Driver', 'Passenger')
            or type(trip.occupancy) is not int or trip.occupancy < 1
            or (trip.occupancy == 1 and trip.driver == 'Passenger')):
        return None, 'auto_evidence_missing'
    if family == 'transit' and (trip.transit_access, trip.transit_egress) not in (
            ('walk', 'walk'), ('drive', 'walk'), ('walk', 'drive')):
        return None, 'transit_access_unverified'
    return family, None


def primary_activity(chain: Sequence[Trip], school_type: str | None) -> tuple[str, str]:
    """Frozen priority, longest destination dwell, earliest arrival, stable ID.

    The caller checks continuity and times first. Durations are observed gaps
    between arrival and the next departure, not total trip duration. Home is
    never a primary activity. The rule is preregistered, not an ActivitySim API.
    """
    activities = []
    for trip, following in zip(chain, chain[1:]):
        activity, error = purpose(trip.destination_purpose, school_type)
        if error:
            raise ValueError(error)
        if activity != 'home':
            duration = (following.depart - trip.arrive).total_seconds()
            activities.append((PURPOSE_PRIORITY.get(activity, 3), -duration,
                               trip.arrive, trip.id, trip.destination, activity))
    if not activities:
        raise ValueError('incomplete_chain')
    selected = min(activities)
    return selected[-2], selected[-1]


def _time_reason(trips: Sequence[Trip], date: str) -> str | None:
    central = ZoneInfo('America/Chicago')
    for trip in trips:
        if not isinstance(trip.depart, datetime) or not isinstance(trip.arrive, datetime):
            return 'missing_time'
        if trip.depart.tzinfo is None or trip.arrive.tzinfo is None:
            return 'missing_time'
        if any(t.astimezone(central).date().isoformat() != date for t in (trip.depart, trip.arrive)):
            return 'overnight'
        if trip.arrive < trip.depart:
            return 'invalid_time_order'
    return None


def _day_reason(diary: Diary, trips: Sequence[Trip]) -> str | None:
    if diary.complete is None:
        return 'diary_completeness_unverified'
    if diary.complete is not True:
        return 'incomplete_diary'
    for name in ('household_weight', 'person_weight', 'day_weight'):
        if not positive(getattr(diary, name)):
            return 'missing_' + name
    if diary.proxy is None:
        return 'quality_unverified'
    if diary.proxy is not False:
        return 'proxy'
    return _time_reason(trips, diary.date)


def _trip_reason(trip: Trip, diary: Diary) -> str | None:
    if trip.in_region is None:
        return 'geography_unverified'
    if trip.in_region is not True:
        return 'out_of_region'
    if not trip.origin or not trip.destination:
        return 'ambiguous_continuity'
    for label in (trip.origin_purpose, trip.destination_purpose):
        _, error = purpose(label, diary.school_type)
        if error:
            return error
    if trip.trace_ok is None or trip.derived_child is None:
        return 'quality_unverified'
    if trip.trace_ok is not True:
        return 'trace_quality'
    if trip.derived_child is not False:
        return 'derived_child'
    if trip.joint is None:
        return 'joint_unverified'
    # Joint travel stays separate from individual home-based tours.
    if trip.joint is not False:
        return 'joint'
    return mode_family(trip)[1]


def _subtours(chain: Sequence[Trip], diary: Diary) -> list[Tour]:
    """Extract closed excursions from the parent tour's primary work location."""
    workplace, main_purpose = primary_activity(chain, diary.school_type)
    if main_purpose != 'work':
        return []
    tours = []
    start = None
    for i, trip in enumerate(chain):
        if start is None and trip.origin == workplace and purpose(trip.origin_purpose, diary.school_type)[0] == 'work':
            start = i
        if start is not None and trip.destination == workplace and purpose(trip.destination_purpose, diary.school_type)[0] == 'work':
            segment = chain[start:i + 1]
            if len(segment) >= 2:
                destination, activity = primary_activity(segment, diary.school_type)
                families = {mode_family(t)[0] for t in segment}
                tours.append(Tour(diary.household, diary.person, diary.day, tuple(t.id for t in segment),
                    destination, activity, next(iter(families)) if len(families) == 1 else None,
                    tour_weight(diary), 'atwork', tuple(t.id for t in chain)))
            start = None
    return tours


def construct_tours(diaries: Sequence[Diary], trips: Sequence[Trip]) -> dict:
    """Account for each input row exactly once; never bridge a discarded trip.

    A bad record quarantines its person-day, preserving the broken chain. The
    reason is deterministic; overlapping diagnostic flags are also reported.
    At-work subtours are nested inventory, not extra trips in conservation.
    """
    days = {(d.household, d.person, d.day): d for d in diaries}
    if len(days) != len(diaries):
        raise ValueError('duplicate diary identity')
    groups = defaultdict(list)
    for trip in trips:
        groups[(trip.household, trip.person, trip.day)].append(trip)
    dropped = Counter({reason: 0 for reason in REASONS})
    excluded_days = Counter({reason: 0 for reason in REASONS})
    diagnostics = Counter({reason: 0 for reason in REASONS})
    raw_modes = Counter(t.raw_mode if t.raw_mode is not None else '__missing__' for t in trips)
    families = Counter()
    raw_purposes = Counter(t.destination_purpose if t.destination_purpose is not None else '__missing__' for t in trips)
    tours, subtours, joint_tours = [], [], []
    excluded_tours = Counter(joint=0, mixed_family=0)
    ids = Counter(t.id for t in trips)
    zero_trip_days = 0
    for key in sorted(set(days) | set(groups)):
        rows = groups[key]
        diary = days.get(key)
        reason = 'unmatched_day' if diary is None else _day_reason(diary, rows)
        if not reason and any(ids[t.id] != 1 for t in rows):
            reason = 'duplicate_trip'
        errors = [_trip_reason(t, diary) for t in rows] if diary else []
        diagnostics.update(error for error in errors if error)
        if not reason:
            reason = next((error for error in errors if error and error != 'joint'), None)
        if reason:
            dropped[reason] += len(rows)
            excluded_days[reason] += 1
            continue
        rows = sorted(rows, key=lambda t: (t.depart, t.arrive, t.id))
        for previous, current in zip(rows, rows[1:]):
            if previous.arrive > current.depart or previous.depart == current.depart:
                reason = 'invalid_time_order'
                break
            if previous.destination != current.origin or previous.destination_purpose != current.origin_purpose:
                reason = 'ambiguous_continuity'
                break
        if reason:
            dropped[reason] += len(rows)
            excluded_days[reason] += 1
            continue
        if not rows:
            zero_trip_days += 1
            continue
        chains, chain = [], []
        for trip in rows:
            chain.append(trip)
            if purpose(trip.destination_purpose, diary.school_type)[0] == 'home':
                chains.append(chain)
                chain = []
        if chain or any(len(c) < 2 or purpose(c[0].origin_purpose, diary.school_type)[0] != 'home'
                        or c[0].origin != c[-1].destination for c in chains):
            dropped['incomplete_chain'] += len(rows)
            excluded_days['incomplete_chain'] += 1
            continue
        for chain in chains:
            family_set = {mode_family(t)[0] for t in chain}
            subtours.extend(_subtours(chain, diary))
            if any(t.joint for t in chain):
                destination, activity = primary_activity(chain, diary.school_type)
                joint_tours.append(Tour(diary.household, diary.person, diary.day, tuple(t.id for t in chain),
                    destination, activity, next(iter(family_set)) if len(family_set) == 1 else None,
                    tour_weight(diary), 'joint_travel'))
                dropped['joint'] += len(chain)
                excluded_tours['joint'] += 1
                continue
            if len(family_set) != 1:
                excluded_tours['mixed_family'] += 1
                dropped['mixed_family'] += len(chain)
                continue
            family = next(iter(family_set))
            destination, activity = primary_activity(chain, diary.school_type)
            tours.append(Tour(diary.household, diary.person, diary.day, tuple(t.id for t in chain),
                destination, activity, family, tour_weight(diary), 'home_based'))
            families[family] += len(chain)
    retained = sum(len(t.trip_ids) for t in tours)
    if retained + sum(dropped.values()) != len(trips):
        raise AssertionError('trip accounting does not conserve rows')
    return {'tours': tours, 'atwork_subtours': subtours, 'joint_travel_tours': joint_tours,
            'excluded_constructed_tours_by_reason': dict(excluded_tours), 'input_trips': len(trips),
            'retained_trips': retained, 'dropped_trips_by_reason': dict(dropped),
            'excluded_days_by_reason': dict(excluded_days), 'diagnostic_trip_flags': dict(diagnostics),
            'raw_modes': dict(raw_modes), 'mapped_family_trips': dict(families),
            'raw_destination_purposes': dict(raw_purposes), 'zero_trip_days': zero_trip_days,
            'weight_basis': 'derived_person_day_tour_count', 'scientific_admission': 'unassessed'}


def decode_linked_trip(row: Mapping, *, location_evidence: Mapping[int, tuple[str, str]],
                       quality_evidence: Mapping[int, Mapping]) -> Trip:
    """Read publisher fields; supplied evidence must resolve omitted identities.

    Hosted labels still need exact release verification before a frozen opening.
    Missing location/quality/access evidence remains unknown, never clean/zero.
    No linked-trip weight is used to construct a tour weight.
    """
    def timestamp(name: str) -> datetime | None:
        value = row.get(name)
        if not isinstance(value, str):
            return None
        try:
            result = datetime.fromisoformat(value)
            # The codebook defines naive source times as US/Central. Reject the
            # DST fallback hour rather than silently choosing one of two times.
            if result.tzinfo is None:
                early = result.replace(tzinfo=ZoneInfo('America/Chicago'), fold=0)
                late = result.replace(tzinfo=ZoneInfo('America/Chicago'), fold=1)
                if early.utcoffset() != late.utcoffset():
                    return None
                return early
            return result
        except ValueError:
            return None
    identifiers = [row.get(k) for k in ('linked_trip_id', 'hh_id', 'person_id', 'day_id')]
    if any(type(i) is not int or i <= 0 for i in identifiers):
        raise ValueError('linked-trip identity must be positive integer; cannot join')
    if row.get('survey_year') != 2019:
        raise ValueError('only the 2019 release is supported')
    identity = identifiers[0]
    origin, destination = location_evidence.get(identity, (None, None))
    quality = quality_evidence.get(identity, {})
    return Trip(*identifiers, timestamp('depart_time'), timestamp('arrive_time'), origin, destination,
        row.get('o_purpose'), row.get('d_purpose'), row.get('mode_type_detailed'),
        quality.get('in_study_region'), row.get('driver'), row.get('num_travelers_int'),
        quality.get('transit_access'), quality.get('transit_egress'), quality.get('joint'),
        quality.get('derived_child'), quality.get('trace_ok'), row.get('linked_trip_weight'))
