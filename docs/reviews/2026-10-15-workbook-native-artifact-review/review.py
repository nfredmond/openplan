#!/usr/bin/python3
"""Review retained XLSX bytes with isolated, bounded LibreOffice conversions.

This runner reads the retained proof, never the database or an application server.
All raw rows, native documents, logs and renderings stay in a fresh private root.
"""
import argparse
import copy
import datetime as dt
import decimal
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import signal
import stat
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

REPO = Path(__file__).resolve().parents[3]
SOURCE = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/workbook-live-pagination-20261015')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/workbook-native-artifact-review-20261015')
PIN = '06a108010ab39aa42eed4c2bcda3e1371b8aa813'
X = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
T = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
O = '{urn:oasis:names:tc:opendocument:xmlns:office:1.0}'
P = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
HEADERS = ['Project name', 'OpenPlan project ID', 'Description', 'Estimated cost',
           'Cost currency', 'Cost price year', 'Project type', 'Status', 'Delivery phase',
           'Source-location text', 'Place source', 'Place kind', 'Place reference',
           'Country code', 'Subdivision code', 'Cost source document ID',
           'Cost recorded at', 'Created at', 'Updated at']
FIELDS = ['name', 'id', 'summary', 'estimated_cost_amount', 'estimated_cost_currency',
          'estimated_cost_basis_year', 'plan_type', 'status', 'delivery_phase',
          'place_label', 'place_source', 'place_kind', 'place_ref', 'place_country_code',
          'place_subdivision_code', 'estimated_cost_source_document_id',
          'estimated_cost_recorded_at', 'created_at', 'updated_at']
BLANK = ('blank', None, False)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def json_hash(value):
    return digest(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode())


def write(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def snapshot(path):
    s = path.stat()
    return {'path': str(path), 'sha256': digest(path.read_bytes()), 'bytes': s.st_size,
            'mode': oct(stat.S_IMODE(s.st_mode)), 'mtimeNs': s.st_mtime_ns,
            'inode': s.st_ino, 'device': s.st_dev}


def text(value):
    return BLANK if value is None or value == '' else ('text', str(value), False)


def clean_rows(rows):
    while rows and not any(cell != BLANK for cell in rows[-1]):
        rows.pop()
    for row in rows:
        while row and row[-1] == BLANK:
            row.pop()
    return rows


def xlsx(path):
    """Read typed OOXML cells directly, without the production SheetJS parser."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        rel = {e.attrib['Id']: e.attrib['Target'] for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        sheets = []
        for s in ET.fromstring(z.read('xl/workbook.xml')).find(X + 'sheets'):
            rid = s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = rel[rid]
            name = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
            rows = []
            for r in ET.fromstring(z.read(name)).find(X + 'sheetData'):
                ri = int(r.attrib['r']) - 1
                while len(rows) <= ri:
                    rows.append([])
                for c in r:
                    label = re.match(r'[A-Z]+', c.attrib['r']).group()
                    ci = 0
                    for char in label:
                        ci = ci * 26 + ord(char) - 64
                    while len(rows[ri]) < ci:
                        rows[ri].append(BLANK)
                    v = c.find(X + 'v')
                    value = v.text if v is not None else None
                    kind = c.attrib.get('t', 'n')
                    formula = c.find(X + 'f') is not None
                    if kind == 's':
                        cell = text(shared[int(value)])
                    elif kind == 'inlineStr':
                        cell = text(''.join(c.find(X + 'is').itertext()))
                    elif kind == 'str':
                        cell = text(value)
                    elif value is None:
                        cell = BLANK
                    else:
                        cell = ({'n': 'number', 'b': 'boolean', 'e': 'error', 'd': 'date'}.get(kind, kind), value, False)
                    rows[ri][ci - 1] = (cell[0], cell[1], formula)
            sheets.append({'name': s.attrib['name'], 'rows': clean_rows(rows)})
        return sheets


def odf_text(node):
    """Expand ODF's explicit spaces/tabs rather than silently dropping them."""
    result = node.text or ''
    for child in node:
        if child.tag == P + 's':
            result += ' ' * int(child.attrib.get(P + 'c', '1'))
        elif child.tag == P + 'tab':
            result += '\t'
        elif child.tag == P + 'line-break':
            result += '\n'
        else:
            result += odf_text(child)
        result += child.tail or ''
    return result


def ods(path):
    """Read Calc's native ODS output, bounding expansion of empty repeats."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('content.xml'))
    sheets = []
    for table in root.findall('.//' + T + 'table'):
        rows = []
        pending = 0
        for r in table.findall(T + 'table-row'):
            row = []
            blanks = 0
            for c in r:
                if c.tag not in (T + 'table-cell', T + 'covered-table-cell'):
                    continue
                n = int(c.attrib.get(T + 'number-columns-repeated', '1'))
                kind = c.attrib.get(O + 'value-type')
                formula = T + 'formula' in c.attrib
                if kind == 'string':
                    value = c.attrib.get(O + 'string-value')
                    if value is None:
                        value = '\n'.join(odf_text(p) for p in c.findall(P + 'p'))
                    cell = text(value)
                elif kind is None:
                    cell = BLANK
                else:
                    value = c.attrib.get(O + 'value', c.attrib.get(O + 'date-value', c.attrib.get(O + 'boolean-value')))
                    cell = ({'float': 'number', 'currency': 'number', 'percentage': 'number'}.get(kind, kind), value, False)
                cell = (cell[0], cell[1], formula)
                if cell == BLANK:
                    blanks += n
                else:
                    if len(row) + blanks + n > 256:
                        raise ValueError('ODS nonempty column expansion exceeds review boundary')
                    row.extend([BLANK] * blanks + [cell] * n)
                    blanks = 0
            n = int(r.attrib.get(T + 'number-rows-repeated', '1'))
            if row:
                if len(rows) + pending + n > 2100:
                    raise ValueError('ODS nonempty row expansion exceeds review boundary')
                rows.extend([[] for _ in range(pending)] + [row.copy() for _ in range(n)])
                pending = 0
            else:
                pending += n
        sheets.append({'name': table.attrib[T + 'name'], 'rows': clean_rows(rows)})
    return sheets


def project_expected(portfolio):
    rows = [[text(v) for v in HEADERS]]
    for original in portfolio['rows']:
        row = []
        for field in FIELDS:
            value = original[field]
            if value is not None and field.endswith('_at'):
                value = value.replace(' ', 'T')
            if value is not None and field == 'estimated_cost_amount':
                value = format(decimal.Decimal(str(value)).normalize(), 'f')
            row.append(text(value))
        rows.append(row)
    return rows


def verify(actual, expected):
    """Compare full typed data; diagnostics never print confidential cell values."""
    assert [s['name'] for s in actual] == ['Projects', 'Read me'], 'sheet names and order'
    rows, wanted = actual[0]['rows'], expected[0]['rows']
    assert rows and rows[0] == wanted[0], 'exact nineteen headers'
    assert len(rows) == len(wanted), 'complete project record count'
    ids = [r[1] if len(r) > 1 else BLANK for r in rows[1:]]
    wanted_ids = [r[1] for r in wanted[1:]]
    assert len(set(ids)) == len(ids), 'unique project IDs'
    assert ids == wanted_ids, 'stable complete ID order including first and last'
    assert not any(c[2] for s in actual for r in s['rows'] for c in r), 'literal cells without formulas'
    for row, want in zip(rows[1:], wanted[1:]):
        assert len(row) == len(want), 'nineteen project cells'
        assert row[3] == want[3] and row[5] == want[5] and row[15] == want[15], 'decimal text and unknown blank semantics'
        assert row == want, 'all project literal text values'
    assert actual[1] == expected[1], 'complete Read me metadata and instructions'


def classify(check, expected_failure=None):
    """Only the exact named AssertionError counts as a detected fault."""
    try:
        check()
    except AssertionError as error:
        if expected_failure == str(error):
            return {'outcome': 'detected', 'diagnostic': str(error)}
        raise RuntimeError('Unrelated assertion cannot count as a detected fault') from error
    if expected_failure is not None:
        raise RuntimeError('Fault survived: ' + expected_failure)
    return {'outcome': 'survived'}


def oracle_controls(expected):
    controls = []
    def trial(label, change, diagnostic=None):
        altered = copy.deepcopy(expected)
        change(altered)
        controls.append({'case': label, **classify(lambda: verify(altered, expected), diagnostic)})
    trial('harmless dictionary metadata', lambda v: v[0].update(reviewNote='harmless'))
    trial('renamed sheet', lambda v: v[0].update(name='Wrong'), 'sheet names and order')
    trial('changed header', lambda v: v[0]['rows'][0].__setitem__(0, text('Wrong')), 'exact nineteen headers')
    trial('dropped row', lambda v: v[0]['rows'].pop(), 'complete project record count')
    trial('duplicate ID', lambda v: v[0]['rows'][2].__setitem__(1, v[0]['rows'][1][1]), 'unique project IDs')
    trial('swapped first and last IDs', lambda v: (v[0]['rows'][1].__setitem__(1, expected[0]['rows'][-1][1]), v[0]['rows'][-1].__setitem__(1, expected[0]['rows'][1][1])), 'stable complete ID order including first and last')
    trial('formula marker on literal', lambda v: v[0]['rows'][1].__setitem__(0, ('text', v[0]['rows'][1][0][1], True)), 'literal cells without formulas')
    trial('missing last column', lambda v: v[0]['rows'][1].pop(), 'nineteen project cells')
    trial('decimal text cast to number', lambda v: v[0]['rows'][1].__setitem__(3, ('number', v[0]['rows'][1][3][1], False)), 'decimal text and unknown blank semantics')
    trial('unknown price year replaced by zero', lambda v: v[0]['rows'][1].__setitem__(5, ('number', '0', False)), 'decimal text and unknown blank semantics')
    trial('changed description', lambda v: v[0]['rows'][1].__setitem__(2, text('changed')), 'all project literal text values')
    trial('changed Read me row count', lambda v: v[1]['rows'][4].__setitem__(1, text('1999')), 'complete Read me metadata and instructions')
    classify(lambda: verify(expected, expected))
    for label, check in [('runtime error', lambda: (_ for _ in ()).throw(ValueError('runtime refusal'))),
                         ('wrong assertion', lambda: (_ for _ in ()).throw(AssertionError('wrong reason')))]:
        try:
            classify(check, 'complete project record count')
        except (ValueError, RuntimeError):
            controls.append({'case': label, 'outcome': 'refused'})
        else:
            raise AssertionError('classifier accepted unrelated failure')
    return controls


def resources():
    group = Path('/sys/fs/cgroup') / Path('/proc/self/cgroup').read_text().strip().split('::', 1)[1].lstrip('/')
    result = {name: (group / name).read_text().strip() for name in
              ['memory.max', 'memory.swap.max', 'memory.peak', 'memory.events', 'cpu.max']}
    result['affinity'] = sorted(os.sched_getaffinity(0))
    return result


def command(args, root, label, timeout=90, env=None):
    start = time.monotonic()
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=env, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
        (root / (label + '.log')).write_bytes(stdout + stderr)
        raise RuntimeError('Owned command timed out: ' + label)
    (root / (label + '.log')).write_bytes(stdout + stderr)
    if process.returncode:
        raise RuntimeError('Owned command failed: ' + label + '; inspect private log')
    return {'label': label, 'exit': process.returncode, 'seconds': round(time.monotonic() - start, 3),
            'logSha256': digest(stdout + stderr)}


def convert(path, root, label, extension='ods', page_range=None):
    output = root / label
    output.mkdir(mode=0o700)
    temp = output / 'tmp'
    temp.mkdir(mode=0o700)
    profile = output / 'profile'
    env = dict(os.environ, TMPDIR=str(temp), XDG_CACHE_HOME=str(temp),
               SAL_USE_VCLPLUGIN='svp', DISPLAY='', LC_ALL='C.UTF-8')
    filter_name = extension
    if extension == 'pdf':
        options = {'PageRange': {'type': 'string', 'value': page_range}}
        filter_name = 'pdf:calc_pdf_Export:' + json.dumps(options)
    args = ['libreoffice', '-env:UserInstallation=' + profile.as_uri(), '--headless',
            '--nologo', '--nodefault', '--norestore', '--convert-to', filter_name,
            '--outdir', str(output), str(path)]
    receipt = command(args, root, label, env=env)
    result = output / (path.stem + '.' + extension)
    if not result.is_file():
        raise RuntimeError('Native output absent: ' + label)
    receipt.update(output=snapshot(result), profile=str(profile), temp=str(temp), pageRange=page_range)
    return result, receipt


def zip_mutation(source, target, mutation):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, 'x') as out:
        for entry in original.infolist():
            data = original.read(entry.filename)
            if mutation == 'drop' and entry.filename == 'xl/worksheets/sheet1.xml':
                tree = ET.fromstring(data)
                rows = tree.find(X + 'sheetData')
                rows.remove(rows[-1])
                data = ET.tostring(tree, encoding='utf-8', xml_declaration=True)
            out.writestr(entry, data)
        if mutation == 'harmless':
            out.comment = b'Harmless review archive metadata; cells unchanged.'


def main(root):
    os.umask(0o077)
    root.mkdir(mode=0o700, exist_ok=False)
    before_resources = resources()
    # Refuse an unbounded invocation before starting any native child.
    if (before_resources['memory.max'] != '1073741824' or before_resources['memory.swap.max'] != '0'
            or before_resources['cpu.max'] != '50000 100000' or len(before_resources['affinity']) != 1):
        raise RuntimeError('Invoke in documented bounded scope with one-CPU taskset')
    source_dir = SOURCE / 'cap-1000/restored-final'
    originals = [source_dir / ('portfolio-' + str(n) + '.xlsx') for n in [0, 1000, 2000]]
    preserved = originals + [SOURCE / 'fixtures-private.json', source_dir / 'observations.json']
    before = [snapshot(p) for p in preserved]
    write(root / 'originals-before.json', before)
    fixtures = json.loads((SOURCE / 'fixtures-private.json').read_text())['portfolios']
    observations = json.loads((source_dir / 'observations.json').read_text())
    bindings = json.loads((REPO / 'docs/reviews/2026-10-15-workbook-live-pagination/evidence/source-bindings.json').read_text())[:6]
    parity = []
    for binding in bindings:
        current = digest((REPO / binding['path']).read_bytes())
        if current != binding['sha256']:
            raise RuntimeError('Source parity differs: ' + binding['path'])
        parity.append({**binding, 'currentSha256': current, 'equal': True})
    report = {'sourcePin': PIN, 'proofCommit': '7044c60ac5bbed81ce70628f72969ec2ec29b371',
              'sourceParity': parity, 'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'resourceBefore': before_resources, 'cases': [], 'nativeControls': [], 'commands': []}
    inputs = root / 'inputs'
    inputs.mkdir(mode=0o700)
    expected_2000 = None
    try:
        for original in originals:
            count = int(original.stem.split('-')[1])
            source = xlsx(original)
            portfolio = next(p for p in fixtures if p['count'] == count)
            expected = copy.deepcopy(source)
            expected[0]['rows'] = project_expected(portfolio)
            ordered = sorted(portfolio['rows'], key=lambda r: r['id'])
            ordered.sort(key=lambda r: r['updated_at'], reverse=True)
            if [r['id'] for r in ordered] != [r['id'] for r in portfolio['rows']]:
                raise RuntimeError('Retained fixture does not have source route order')
            # Bind raw bytes to the successful retained in-process GET observation.
            if not any(o.get('status') == 200 and o.get('sha256') == digest(original.read_bytes()) for o in observations):
                raise RuntimeError('XLSX not bound to retained successful GET observation')
            verify(source, expected)
            readme = source[1]['rows']
            if (readme[2][1] != text(portfolio['name']) or readme[3][1] != text(portfolio['workspace'])
                    or readme[4][1] != text(str(count))):
                raise RuntimeError('Read me differs from retained source fixture')
            copied = inputs / original.name
            shutil.copyfile(original, copied)
            native, receipt = convert(copied, root, 'native-' + str(count))
            report['commands'].append(receipt)
            actual = ods(native)
            verify(actual, expected)
            ids = [r[1][1] for r in actual[0]['rows'][1:]]
            report['cases'].append({'records': count, 'uniqueProjectIDs': len(set(ids)),
                                    'sheetNames': [s['name'] for s in actual],
                                    'projectColumns': len(actual[0]['rows'][0]),
                                    'projectPhysicalRows': len(actual[0]['rows']),
                                    'xlsxSha256': digest(original.read_bytes()), 'odsSha256': digest(native.read_bytes()),
                                    'idSequenceSha256': json_hash(ids), 'firstIDSha256': json_hash(ids[:1]),
                                    'lastIDSha256': json_hash(ids[-1:]),
                                    'allTypedCellsEqual': True, 'sourceFixtureEqual': True,
                                    'unknownPriceYears': sum(r[5] == BLANK for r in actual[0]['rows'][1:]),
                                    'blankDocumentReferences': sum(r[15] == BLANK for r in actual[0]['rows'][1:]),
                                    'formulas': sum(c[2] for s in actual for r in s['rows'] for c in r)})
            if count == 2000:
                expected_2000 = expected
        report['oracleControls'] = oracle_controls(expected_2000)
        base = inputs / 'portfolio-2000.xlsx'
        for label, mutation, diagnostic in [('harmless-native', 'harmless', None),
                                             ('dropped-row-native', 'drop', 'complete project record count')]:
            target = inputs / (label + '.xlsx')
            zip_mutation(base, target, mutation)
            native, receipt = convert(target, root, label)
            report['commands'].append(receipt)
            result = classify(lambda: verify(ods(native), expected_2000), diagnostic)
            report['nativeControls'].append({'case': label, **result, 'inputSha256': digest(target.read_bytes())})
        restored = inputs / 'restored-exact.xlsx'
        shutil.copyfile(base, restored)
        native, receipt = convert(restored, root, 'restored-exact-native')
        report['commands'].append(receipt)
        verify(ods(native), expected_2000)
        report['restoration'] = {'byteExactCopy': restored.read_bytes() == originals[-1].read_bytes(),
                                 'nativeAllTypedCellsEqual': True, 'sha256': digest(restored.read_bytes())}
        # Empty workbook has just one Projects header row, so both sheets can be
        # sampled without printing the 2,000-row portfolio across hundreds of pages.
        pdf, receipt = convert(inputs / 'portfolio-0.xlsx', root, 'pdf-empty-first', 'pdf', '1-2')
        report['commands'].append(receipt)
        report['commands'].append(command(['pdfinfo', str(pdf)], root, 'pdf-empty-info'))
        report['commands'].append(command(['pdftotext', '-layout', str(pdf), str(root / 'pdf-empty.txt')], root, 'pdf-empty-text'))
        report['commands'].append(command(['pdftoppm', '-r', '110', '-f', '1', '-l', '2', '-png', str(pdf), str(root / 'empty-page')], root, 'pdf-empty-images'))
        # Keep the populated sample to the first two pages. PageRange bounds the
        # PDF output; it does not establish full-workbook print usability.
        pdf, receipt = convert(base, root, 'pdf-populated-first', 'pdf', '1-2')
        report['commands'].append(receipt)
        report['commands'].append(command(['pdfinfo', str(pdf)], root, 'pdf-populated-info'))
        report['commands'].append(command(['pdftotext', '-layout', str(pdf), str(root / 'pdf-populated.txt')], root, 'pdf-populated-text'))
        report['commands'].append(command(['pdftoppm', '-r', '110', '-f', '1', '-l', '2', '-png', str(pdf), str(root / 'populated-page')], root, 'pdf-populated-images'))
    finally:
        after = [snapshot(p) for p in preserved]
        write(root / 'originals-after.json', after)
        report['originals'] = before
        report['originalsExactPreservation'] = before == after
        report['resourceAfter'] = resources()
        report['finishedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        write(root / 'results.json', report)
        if before != after:
            raise RuntimeError('Original artifact bytes or metadata changed')
    print(json.dumps({'records': [r['records'] for r in report['cases']],
                      'nativeControls': report['nativeControls'], 'originalsPreserved': report['originalsExactPreservation'],
                      'memoryPeak': report['resourceAfter']['memory.peak']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--private-root', type=Path, default=PRIVATE)
    args = parser.parse_args()
    main(args.private_root)
