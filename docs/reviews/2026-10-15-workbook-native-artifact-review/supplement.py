#!/usr/bin/python3
"""Exercise native ODS extraction and inspect the small workbook's last sheet."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import xml.etree.ElementTree as ET
import zipfile

import review as r


def patch_ods(source, target, change):
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(target, 'x') as output:
        for entry in original.infolist():
            content = original.read(entry.filename)
            if entry.filename == 'content.xml':
                tree = ET.fromstring(content)
                change(tree.findall('.//' + r.T + 'table'))
                content = ET.tostring(tree, encoding='utf-8', xml_declaration=True)
            output.writestr(entry, content)


def main():
    os.umask(0o077)
    root = r.PRIVATE / 'run-02'
    out = root / 'supplement-02'
    out.mkdir(mode=0o700, exist_ok=False)
    prior = json.loads((root / 'results.json').read_text())
    originals = [Path(p['path']) for p in prior['originals']]
    before = [r.snapshot(p) for p in originals]
    source = root / 'native-2000/portfolio-2000.ods'
    expected = r.xlsx(root / 'inputs/portfolio-2000.xlsx')
    result = {'resourcesBefore': r.resources(), 'odsParserControls': [], 'commands': []}

    def trial(label, change, diagnostic=None):
        path = out / (label + '.ods')
        patch_ods(source, path, change)
        result['odsParserControls'].append({'case': label,
            **r.classify(lambda: r.verify(r.ods(path), expected), diagnostic),
            'inputSha256': r.digest(path.read_bytes())})

    def cell(tables, ri, ci):
        row = tables[0].findall(r.T + 'table-row')[ri]
        position = 0
        for index, node in enumerate(row):
            repeat = int(node.get(r.T + 'number-columns-repeated', '1'))
            if position <= ci < position + repeat:
                if repeat == 1:
                    return node
                row.remove(node)
                offset = ci - position
                parts = []
                if offset:
                    before = copy.deepcopy(node)
                    before.set(r.T + 'number-columns-repeated', str(offset))
                    parts.append(before)
                selected = copy.deepcopy(node)
                selected.attrib.pop(r.T + 'number-columns-repeated', None)
                parts.append(selected)
                if repeat - offset - 1:
                    after = copy.deepcopy(node)
                    after.set(r.T + 'number-columns-repeated', str(repeat - offset - 1))
                    parts.append(after)
                for shift, part in enumerate(parts):
                    row.insert(index + shift, part)
                return selected
            position += repeat
        raise ValueError('Requested logical column absent')

    def string_change(tables, ri, ci, value):
        node = cell(tables, ri, ci)
        for p in node.findall(r.P + 'p'):
            node.remove(p)
        ET.SubElement(node, r.P + 'p').text = value

    trial('harmless-table-metadata', lambda t: t[0].set(r.T + 'style-name', t[0].get(r.T + 'style-name', 'ta1')))
    trial('renamed-sheet', lambda t: t[0].set(r.T + 'name', 'Wrong'), 'sheet names and order')
    trial('changed-header', lambda t: string_change(t, 0, 0, 'Wrong'), 'exact nineteen headers')
    trial('dropped-native-row', lambda t: t[0].remove(t[0].findall(r.T + 'table-row')[2000]), 'complete project record count')
    first_id = expected[0]['rows'][1][1][1]
    last_id = expected[0]['rows'][-1][1][1]
    trial('duplicate-native-ID', lambda t: string_change(t, 2, 1, first_id), 'unique project IDs')
    trial('swapped-native-IDs', lambda t: (string_change(t, 1, 1, last_id), string_change(t, 2000, 1, first_id)), 'stable complete ID order including first and last')
    trial('formula-native-marker', lambda t: cell(t, 1, 0).set(r.T + 'formula', 'of:=1+1'), 'literal cells without formulas')
    trial('native-number-instead-of-text', lambda t: (cell(t, 1, 3).set(r.O + 'value-type', 'float'), cell(t, 1, 3).set(r.O + 'value', '42.01')), 'decimal text and unknown blank semantics')
    trial('native-zero-instead-of-unknown', lambda t: (cell(t, 1, 5).set(r.O + 'value-type', 'float'), cell(t, 1, 5).set(r.O + 'value', '0')), 'decimal text and unknown blank semantics')
    trial('changed-native-description', lambda t: string_change(t, 1, 2, 'Wrong'), 'all project literal text values')
    trial('missing-native-last-column', lambda t: cell(t, 1, 18).clear(), 'nineteen project cells')
    trial('harmless-readme-style', lambda t: t[1].set(r.T + 'style-name', 'harmless-style'))
    trial('changed-native-readme', lambda t: t[1].findall(r.T + 'table-row')[4].findall(r.T + 'table-cell')[1].find(r.P + 'p').__setattr__('text', '1999'), 'complete Read me metadata and instructions')
    # A second harmless survivor changes a style reference, outside typed data.
    r.verify(r.ods(source), expected)
    try:
        r.classify(lambda: None, 'complete project record count')
    except RuntimeError as error:
        result['vacuousOracleRefused'] = str(error) == 'Fault survived: complete project record count'
    else:
        raise AssertionError('classifier must refuse a vacuous oracle')

    # Evaluate the actual budget predicate with safe metadata copies, without
    # starting an unbounded process or changing this scope's real controls.
    main_ast = next(n for n in ast.parse(Path(r.__file__).read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    predicate = next(n.test for n in main_ast.body if isinstance(n, ast.If))
    expression = compile(ast.Expression(predicate), str(r.__file__), 'eval')
    bounds = result['resourcesBefore']
    result['budgetControls'] = []
    for label, updates, refuse in [
        ('baseline', {}, False), ('harmless metadata', {'note': 'harmless'}, False),
        ('memory beyond 1 GiB', {'memory.max': '2147483648'}, True),
        ('swap allowed', {'memory.swap.max': '1073741824'}, True),
        ('full CPU quota', {'cpu.max': '100000 100000'}, True),
        ('two CPUs', {'affinity': [22, 23]}, True)]:
        changed = dict(bounds, **updates)
        observed = bool(eval(expression, {}, {'before_resources': changed}))
        if observed != refuse:
            raise AssertionError('budget metadata control: ' + label)
        result['budgetControls'].append({'case': label, 'outcome': 'refused' if observed else 'survived'})

    # The zero-row workbook spans only a few horizontal pages. Export its next
    # eight source pages at most, then render only pages containing Read me.
    pdf, receipt = r.convert(root / 'inputs/portfolio-0.xlsx', root, 'pdf-empty-tail', 'pdf', '3-10')
    result['commands'].append(receipt)
    result['commands'].append(r.command(['pdfinfo', str(pdf)], root, 'pdf-empty-tail-info'))
    textfile = out / 'tail-text.txt'
    result['commands'].append(r.command(['pdftotext', '-layout', str(pdf), str(textfile)], root, 'pdf-empty-tail-text'))
    pages = textfile.read_text().split('\f')
    result['tailPages'] = []
    for index, page in enumerate(pages):
        if not page.strip():
            continue
        readme = any(s in page for s in ['OpenPlan portfolio round-trip', 'Map this OpenPlan field', 'version 1', 'Create only.'])
        result['tailPages'].append({'pdfPage': index + 1, 'sourcePage': index + 3, 'characters': len(page), 'readmeMarker': readme})
        if readme:
            prefix = out / ('readme-source-page-' + str(index + 3))
            result['commands'].append(r.command(['pdftoppm', '-r', '110', '-f', str(index + 1), '-l', str(index + 1), '-singlefile', '-png', str(pdf), str(prefix)], root, 'readme-render-' + str(index + 3)))
    result['nativeSourceRestored'] = r.digest(source.read_bytes()) == prior['cases'][2]['odsSha256']
    result['originalsExactPreservation'] = before == [r.snapshot(p) for p in originals]
    result['resourcesAfter'] = r.resources()
    r.write(out / 'results.json', result)
    # LibreOffice explicitly creates some profile directories as 0755. The
    # 0700 private ancestor already protects them; normalize this owned root.
    for path in r.PRIVATE.rglob('*'):
        if not path.is_symlink():
            path.chmod(0o700 if path.is_dir() else 0o600)
    r.PRIVATE.chmod(0o700)
    print(json.dumps({'odsParserControls': len(result['odsParserControls']),
                      'tailPages': result['tailPages'], 'originalsPreserved': result['originalsExactPreservation'],
                      'memoryPeak': result['resourcesAfter']['memory.peak']}))


if __name__ == '__main__':
    main()
