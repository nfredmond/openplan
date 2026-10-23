"""Collect and audit station metadata for a pinned development-only input set.

The baseline supplies input-only matched row hashes. This audit opens only
the five pinned count CSVs, never networks, assignments, skims or results.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'workers/aequilibrae_worker'))
from count_observation_uncertainty import attach_observation_interval, digest
from validation_instrument import observation_from_compatibility_row
import station_evidence as se


def matched_inputs(config: dict, registry_path: Path) -> tuple[dict, dict, list[dict]]:
    """Rebind all denominator rows to verified CSV bytes before source lookup."""
    raw = registry_path.read_bytes()
    if se.sha256(raw) != config['input_registry_sha256']:
        raise ValueError('input registry hash mismatch')
    registry = json.loads(raw)
    if registry['partition'] != config['partition'] or config['partition'] != 'original five development counties only':
        raise ValueError('unauthorized partition')
    if {g['id'] for g in registry['geographies']} != {g['id'] for g in config['geographies']}:
        raise ValueError('geography set mismatch')
    baseline_raw = (ROOT / config['baseline_path']).read_bytes()
    if se.sha256(baseline_raw) != config['baseline_sha256']:
        raise ValueError('baseline hash mismatch')
    baseline = json.loads(baseline_raw)
    if baseline['registry_sha256'] != config['input_registry_sha256'] or baseline['archive_sha256'] != registry['archive']['sha256']:
        raise ValueError('baseline input binding mismatch')
    archive = Path(registry['archive']['path'])
    with archive.open('rb') as handle:
        if hashlib.file_digest(handle, 'sha256').hexdigest() != registry['archive']['sha256']:
            raise ValueError('archive hash mismatch')
    members = {r['member']: r for r in registry['members']}
    selected, opened = {}, []
    with zipfile.ZipFile(archive) as bundle:
        for county in baseline['counties']:
            geography = county['geography']
            if not geography.isdigit() or geography not in {g['id'] for g in config['geographies']}:
                raise ValueError('invalid geography')
            name = geography + '/counts/published_counts.csv'
            raw = bundle.read(name)
            member = members[name]
            if se.sha256(raw) != member['sha256'] or len(raw) != member['bytes']:
                raise ValueError('count member hash mismatch')
            opened.append({k: member[k] for k in ('member', 'sha256', 'bytes')})
            rows = list(csv.DictReader(io.StringIO(raw.decode())))
            by_hash = {}
            for row in rows:
                by_hash.setdefault(digest(row), []).append(row)
            matched = []
            for retained in county['matched_source_rows']:
                choices = by_hash.get(retained['source_row_sha256'], [])
                if len(choices) != 1 or choices[0]['station_id'] != retained['station_id']:
                    raise ValueError('matched source row binding mismatch')
                matched.append(choices[0])
            if len(matched) != county['matched']:
                raise ValueError('baseline denominator mismatch')
            selected[geography] = {'rows': matched, 'member': member, 'baseline': county}
    return registry, selected, opened


def collect(config: dict, selected: dict, directory: Path) -> dict:
    """Fetch anonymous metadata with exact query URLs and response receipts."""
    receipts = []
    journal = directory / 'retrieval-journal.jsonl'
    prior = {}
    if journal.exists():
        for line in journal.read_text().splitlines():
            receipt = json.loads(line)
            prior[(receipt['source'], receipt['url'], receipt['label'])] = receipt
    def get(source: str, url: str, label: str):
        if config['sources'][source]['access'] != 'public_no_registration':
            raise ValueError('source requires access review')
        receipt = prior.get((source, url, label))
        if receipt is None:
            receipt = se.fetch_public(url, directory, access=config['sources'][source]['access'])
            receipt.update(source=source, label=label)
            with journal.open('a') as handle:
                handle.write(json.dumps(receipt, sort_keys=True) + '\n')
        receipts.append(receipt)
        return se.read_source(directory, receipt), receipt

    ca = config['sources']['caltrans']
    annual_bytes, annual_receipt = get('caltrans', ca['annual_url'], 'annual')
    annual = se.caltrans_workbook(annual_bytes, year=ca['year'], counties={g['county_code'] for g in config['geographies'] if g['source'] == 'caltrans'})
    records = {g['id']: [] for g in config['geographies']}
    for geography in config['geographies']:
        identifier = geography['id']
        if geography['source'] == 'caltrans':
            code = geography['county_code']
            if not code.isalpha():
                raise ValueError('invalid source county code')
            url = ca['query_url'] + '?' + urllib.parse.urlencode({'f': 'json', 'where': f"CNTY='{code}'", 'outFields': '*', 'outSR': 4326, 'returnGeometry': 'true'})
            payload, receipt = get('caltrans', url, identifier)
            county_records = se.caltrans_metadata(payload, annual, county=code)
            for record in county_records:
                record['custody'] = [receipt, annual_receipt]
            records[identifier].extend(county_records)
        else:
            source = config['sources']['cdot']
            ids = sorted({row['source_description'] for row in selected[identifier]['rows']})
            if not all(s.isdigit() for s in ids):
                raise ValueError('invalid publisher station ID')
            where = 'COUNTSTATIONID IN (' + ','.join("'" + s + "'" for s in ids) + ')'
            url = source['query_url'] + '?' + urllib.parse.urlencode({'f': 'json', 'where': where, 'outFields': '*', 'returnGeometry': 'false'})
            attributes, attribute_receipt = get('cdot', url, identifier + '-aadt')
            aadts = se.arcgis_rows(attributes)
            for station in ids:
                station_bytes, receipt = get('cdot', source['station_url'] + station + '.json', identifier + ':' + station)
                station_rows = json.loads(station_bytes)
                if not station_rows:
                    continue
                types = {row['continuous'] for row in station_rows}
                if len(types) != 1 or not all(type(t) is bool for t in types):
                    raise ValueError('ambiguous station collection type')
                count_type = str(next(iter(types))).lower()
                date_bytes, date_receipt = get('cdot', source['dates_url'] + count_type + '/' + station, identifier + ':' + station + ':dates')
                county_records = se.cdot_metadata(station_bytes, aadt_payload=json.dumps(aadts).encode(), dates={station: json.loads(date_bytes)})
                for record in county_records:
                    record['custody'] = [receipt, attribute_receipt, date_receipt]
                records[identifier].extend(county_records)
    tmas = config['sources']['tmas']
    payload, receipt = get('tmas', tmas['url'], 'station-archive')
    for record in se.tmas_metadata(payload, members=tmas['members'], counties=set(records), year=tmas['year']):
        record['custody'] = [receipt]
        records[record['geography']].append(record)
    hpms = config['sources']['hpms']
    for geography in config['geographies']:
        identifier = geography['id']
        offset = 0
        while True:
            params = {'$where': f"stateid={int(identifier[:2])} AND county_id={int(identifier[2:])}", '$select': hpms['fields'],
                      '$order': ':id', '$limit': hpms['page_size'], '$offset': offset}
            payload, receipt = get('hpms', hpms['query_url'] + '?' + urllib.parse.urlencode(params), identifier + ':' + str(offset))
            batch = se.hpms_metadata(payload, geography=identifier)
            for record in batch:
                record['custody'] = [receipt]
            records[identifier].extend(batch)
            if len(batch) < hpms['page_size']:
                break
            offset += hpms['page_size']
            if offset >= 100000:
                raise ValueError('HPMS pagination limit')
    return {'schema': 'openplan.station-metadata-bundle.v1', 'config_sha256': digest(config),
            'receipts': receipts, 'records': records,
            'skipped_sources': {'pems': 'registration_and_terms_acceptance_required'}}


def coverage(config: dict, registry: dict, selected: dict, opened: list, bundle: dict) -> dict:
    """Recompute interval availability only; never invoke residual calculations."""
    if bundle['config_sha256'] != digest(config) or set(bundle['records']) != set(selected):
        raise ValueError('source bundle configuration mismatch')
    counties = []
    for geography in config['geographies']:
        identifier = geography['id']
        county = selected[identifier]
        rows, joins, primary, reasons, transfer = [], Counter(), Counter(), Counter(), Counter()
        for row in county['rows']:
            association = se.join_station(se.observation_reference(row), bundle['records'][identifier],
                                          max_distance_m=config['location_tolerance_metres'])
            observation = observation_from_compatibility_row(row, source_id=registry['study_id'] + ':' + identifier,
                          publisher=row['source_agency'], source_url='unknown: retained compatibility CSV',
                          source_artifact_sha256=county['member']['sha256'], downloaded_at='unknown')
            candidate, transfer_reasons = se.annotate_candidate(observation, row, association)
            interval = attach_observation_interval(candidate)['observation_uncertainty']
            primary[interval['reason'] or 'available'] += 1
            reasons.update(interval['reasons'])
            joins[association['status']] += 1
            transfer.update(transfer_reasons)
            if association['status'] == 'associated':
                record = association['record']
                association = {**association, 'record_sha256': digest(record)}
                association.pop('record')
            external = {source: se.external_association(se.observation_reference(row), bundle['records'][identifier],
                        source=source, max_distance_m=config['location_tolerance_metres']) for source in ('tmas', 'hpms')}
            rows.append({'station_id': row['station_id'], 'source_row_sha256': digest(row),
                         'association': association, 'transfer_refusals': transfer_reasons,
                         'national_associations': external, 'interval': interval})
        metadata = bundle['records'][identifier]
        counties.append({'geography': identifier, 'name': geography['name'], 'matched': len(rows),
                         'available': primary.get('available', 0), 'associations': dict(joins),
                         'metadata_rows_by_source': dict(Counter(r['source'] for r in metadata)),
                         'station_types_by_source': {s: dict(Counter(r['collection_type'] or 'unknown' for r in metadata if r['source'] == s)) for s in sorted({r['source'] for r in metadata})},
                         'primary_reason_counts': dict(primary), 'all_reason_counts_nonexclusive': dict(reasons),
                         'transfer_refusal_counts_nonexclusive': dict(transfer), 'rows': rows,
                         'national_source_association_reasons': {s: dict(Counter(r['national_associations'][s]['reason'] for r in rows)) for s in ('tmas', 'hpms')},
                         'baseline_match_statuses': county['baseline']['match_statuses']})
    return {'schema': 'openplan.station-evidence-interval-coverage.v1', 'config_sha256': digest(config),
            'input_registry_sha256': config['input_registry_sha256'], 'baseline_sha256': config['baseline_sha256'],
            'metadata_bundle_sha256': digest(bundle), 'opened_members': opened,
            'code_sha256': {str(p.relative_to(ROOT)): se.sha256(p.read_bytes()) for p in
                           (Path(__file__).resolve(), Path(se.__file__).resolve(),
                            ROOT / 'workers/aequilibrae_worker/count_observation_uncertainty.py')},
            'assignment_output_files_opened': 0, 'residuals_computed': 0,
            'matched': sum(c['matched'] for c in counties), 'available': sum(c['available'] for c in counties),
            'counties': counties}


def write_new(path: Path, value: dict):
    with path.open('x') as handle:
        json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
        handle.write('\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--input-registry', type=Path, required=True)
    parser.add_argument('--source-directory', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--bundle-sha256', help='Required for an offline retained-bundle audit')
    args = parser.parse_args()
    config = json.loads(args.config.read_bytes())
    registry, selected, opened = matched_inputs(config, args.input_registry)
    if args.fetch:
        if args.bundle.exists() or args.output.exists():
            raise ValueError('refuse overwrite')
        bundle = collect(config, selected, args.source_directory)
        write_new(args.bundle, bundle)
    else:
        bundle_bytes = args.bundle.read_bytes()
        if se.sha256(bundle_bytes) != args.bundle_sha256:
            raise ValueError('metadata bundle hash mismatch')
        bundle = json.loads(bundle_bytes)
    for receipt in bundle['receipts']:
        se.read_source(args.source_directory, receipt)
    result = coverage(config, registry, selected, opened, bundle)
    write_new(args.output, result)
    print(json.dumps({k: result[k] for k in ('matched', 'available')}))
