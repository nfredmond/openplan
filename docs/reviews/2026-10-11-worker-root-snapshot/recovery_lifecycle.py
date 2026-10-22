"""Refuse an active owned recovery target and verify its final stopped state."""
def require_stopped(database, api):
    if database['State']['Running'] is not False or api['State']['Running'] is not False:
        raise ValueError('package-owned-target-begins-stopped')


def require_final_stopped(info):
    if info['State']['Running'] is not False:
        raise ValueError('package-owned-target-finally-stopped')
