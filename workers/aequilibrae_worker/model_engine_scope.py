"""Attempt project cleanup on every exit without claiming engine quiescence."""
from contextlib import contextmanager
import model_attempt_writer


@contextmanager
def project_scope(factory, directory, *, create=False):
    """Close even after partial open or interrupted work; propagate cleanup failures."""
    try:
        project = factory()
        try:
            if create:
                project.new(directory)
            else:
                project.open(directory)
            yield project
        finally:
            project.close()
    except BaseException:
        writer = model_attempt_writer.current()
        if writer is not None:
            writer.stopped = True
        raise
