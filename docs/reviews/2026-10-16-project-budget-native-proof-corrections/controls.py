"""UNEXECUTED pure oracle controls. Requires a later finite TEST admission.

No native acceptance follows from these deliberately altered in-memory readbacks.
"""
from copy import deepcopy
from generate import prepare, LITERALS


def check(expected, actual):
    if expected != actual:
        raise AssertionError('Exact fixture identities, nested lines and cents must match')


def proposed_controls(prerequisites):
    _, oracle = prepare(prerequisites)
    original = deepcopy(oracle['cases']['ordinary'])
    working = deepcopy(original)
    outcomes = []
    try:
        check(original, working)
        # Key insertion order changes no JSON meaning; this must survive.
        check(original, dict(reversed(list(working.items()))))
        outcomes.append(('harmless-key-order', 'survived'))
        for name in ('missing-id', 'lost-nested-line', 'cent-rounded', 'sentinel-included'):
            working = deepcopy(original)
            if name == 'missing-id':
                working['spendEntries'].pop()
            elif name == 'lost-nested-line':
                next(v for v in working['linesByInvoice'].values() if len(v) > 1).pop()
            elif name == 'cent-rounded':
                working['cents']['billedToDate'] = '600499'
            else:
                working['invoices'].append(working['excluded'][0]['invoice'])
            failure = None
            try:
                check(original, working)
            except AssertionError as error:
                failure = str(error)
            if failure != 'Exact fixture identities, nested lines and cents must match':
                raise AssertionError('Named oracle fault did not fail as intended: ' + name)
            outcomes.append((name, 'killed'))
    finally:
        working = deepcopy(original)
        check(original, working)
    # Independent literal-product check, not production money parsing.
    for count in LITERALS:
        name = 'max-' + str(count)
        _, repeat = prepare(prerequisites, name)
        case = repeat['cases'][name]
        if int(case['cents']['actualToDate']) != count * 99999999999999:
            raise AssertionError('Literal maximum-row cent oracle mismatch')
    return {'status': 'pure-controls-only', 'outcomes': outcomes, 'restored': True,
            'blindCategory': 'No SQL, catalog, RLS, HTTP, actual production math or concurrency.'}
