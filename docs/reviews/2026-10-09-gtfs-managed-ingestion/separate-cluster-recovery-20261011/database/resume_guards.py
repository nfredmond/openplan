"""Validate a separate continuation without promoting its failed producer."""


def require(condition, reason):
    if not condition: raise ValueError(reason)


def preflight(state, expected_source, actual_source, controls_sha, schema_sha):
    require(state == 'failed', 'resume-producer-state')
    require(expected_source == actual_source, 'resume-executed-source')
    require(controls_sha == schema_sha, 'resume-schema-control-source')


def quiescent(clients):
    require(clients == 0, 'resume-active-clients')


def native_records(source_schema_sha, baseline, actual):
    require(source_schema_sha == baseline['schemaSha256'], 'resume-source-schema')
    require(actual['tables'] == baseline['tables'], 'resume-table-images')
    require(actual['sequences'] == baseline['sequences'], 'resume-sequence-images')


def native_control_reason(observed, expected):
    require(observed == expected, 'resume-native-control-oracle')
