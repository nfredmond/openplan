"""Stream modeled run health into SQLite; never read a survey input."""
import csv
from collections import Counter
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import yaml


def period_label(value, periods, labels):
    if value is None: return '__unavailable__'
    value = float(value)
    for low, high, label in zip(periods, periods[1:], labels):
        if low < value <= high: return label
    return '__unavailable__'


def share_record(counts):
    total = sum(counts.values())
    return {'tours': total, 'mode_counts': dict(sorted(counts.items())),
            'mode_shares': {mode: count / total for mode, count in sorted(counts.items())} if total else None}


def summarize(output, period_settings):
    output = Path(output)
    db = sqlite3.connect(output / 'modeled-health.sqlite')
    db.execute('PRAGMA cache_size=-65536'); db.execute('PRAGMA temp_store=FILE')
    columns = {
        'land_use': ['zone_id', 'county_id'],
        'households': ['household_id', 'home_zone_id', 'auto_ownership'],
        'persons': ['person_id', 'is_university'],
        'tours': ['tour_id', 'household_id', 'person_id', 'tour_type', 'tour_category', 'tour_mode'],
    }
    for table, names in columns.items():
        db.execute(f'CREATE TABLE {table} (' + ','.join(n + ' TEXT' for n in names) + ')')
        with (output / ('final_' + table + '.csv')).open() as stream:
            reader = csv.DictReader(stream)
            batch = []
            for row in reader:
                batch.append(tuple(row[name] or None for name in names))
                if len(batch) == 5000:
                    db.executemany(f'INSERT INTO {table} VALUES (' + ','.join('?' for _ in names) + ')', batch)
                    batch.clear()
            db.executemany(f'INSERT INTO {table} VALUES (' + ','.join('?' for _ in names) + ')', batch)
        db.execute(f'CREATE UNIQUE INDEX {table}_id ON {table} ({names[0]})')
        db.commit()
    db.execute('CREATE TABLE first_departure (tour_id TEXT PRIMARY KEY, depart REAL)')
    trip_modes = Counter(); trip_count = 0; batch = []
    with (output / 'final_trips.csv').open() as stream:
        for row in csv.DictReader(stream):
            trip_count += 1; trip_modes[row['trip_mode']] += 1
            if row['outbound'].lower() in ['true', '1'] and float(row['trip_num']) == 1:
                batch.append((row['tour_id'], float(row['depart']) if row['depart'] else None))
                if len(batch) == 5000:
                    db.executemany('INSERT INTO first_departure VALUES (?,?)', batch); batch.clear()
    db.executemany('INSERT INTO first_departure VALUES (?,?)', batch); db.commit()
    db.create_function('period_label', 1, lambda value: period_label(value, period_settings['periods'], period_settings['labels']))
    source = '''FROM tours t LEFT JOIN households h ON h.household_id=t.household_id
                LEFT JOIN land_use l ON l.zone_id=h.home_zone_id
                LEFT JOIN persons p ON p.person_id=t.person_id
                LEFT JOIN first_departure f ON f.tour_id=t.tour_id'''
    expressions = {
        'overall': "'all_exported_tours'",
        'home_county': "COALESCE(l.county_id, '__unavailable__')",
        'purpose': "COALESCE(t.tour_type, '__unavailable__')",
        'vehicles': "CASE WHEN h.auto_ownership IS NULL OR CAST(h.auto_ownership AS REAL)<0 THEN '__unavailable__' WHEN CAST(h.auto_ownership AS REAL)=0 THEN 'zero' WHEN CAST(h.auto_ownership AS REAL)=1 THEN 'one' ELSE 'two_or_more' END",
        'university_status': "COALESCE(p.is_university, '__unavailable__')",
        'first_departure_period': 'period_label(f.depart)',
        'tour_category_inventory': "COALESCE(t.tour_category, '__unavailable__')",
    }
    domains = {}
    for name, expression in expressions.items():
        groups = {}
        for stratum, mode, count in db.execute(f'SELECT {expression}, t.tour_mode, COUNT(*) {source} GROUP BY 1,2'):
            groups.setdefault(stratum, Counter())[mode or '__unavailable__'] += count
        domains[name] = {key: share_record(counts) for key, counts in sorted(groups.items())}
    tour_count = db.execute('SELECT COUNT(*) FROM tours').fetchone()[0]
    db.close()
    return {'claim': 'MODELED run health only', 'outcomes_accessed': False,
            'universe': 'All exported model tours, including joint and at-work tours. Raw native tour_mode alternatives; no homogeneous linked-trip filter or survey equivalence is claimed.',
            'tour_count': tour_count, 'trip_count': trip_count, 'trip_mode_counts_MODELED': dict(sorted(trip_modes.items())),
            'domains_MODELED': domains, 'period_settings': period_settings,
            'period_rule': 'Installed Network_LOS.skim_time_period_label Series convention: lower bound open, upper bound closed.',
            'unavailable_preregistered_domains': {
                'published_income_categories': 'Publisher category boundaries and model correspondence remain unfrozen.',
                'auto_sufficiency': 'The comparison definition and observed/model correspondence remain unfrozen.',
                'purpose_cross_auto_sufficiency': 'Depends on the unfrozen auto-sufficiency definition.',
                'publisher_area_types': 'The publisher-to-Census-model crosswalk remains unverified.'}}


if __name__ == '__main__':
    output, destination, network = map(Path, sys.argv[1:])
    settings = yaml.safe_load(network.read_text())['skim_time_periods']
    result = summarize(output, settings)
    result['network_los_sha256'] = hashlib.sha256(network.read_bytes()).hexdigest()
    destination.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'tour_count': result['tour_count'], 'trip_count': result['trip_count']}))
