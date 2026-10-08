"""Attempt project cleanup on every exit without claiming engine quiescence."""
from contextlib import contextmanager
import logging
from pathlib import Path
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
            try:
                project.close()
            finally:
                close_project_log(project, directory)
    except BaseException:
        writer = model_attempt_writer.current()
        if writer is not None:
            writer.stopped = True
        raise


def close_project_log(project, directory):
    """Close only file handlers for this project's log, including after close fails."""
    logger = getattr(project, 'logger', None)
    if not isinstance(logger, logging.Logger):
        return
    expected = (Path(directory) / 'aequilibrae.log').resolve()
    for handler in list(logger.handlers):
        if isinstance(handler, logging.FileHandler) and Path(handler.baseFilename).resolve() == expected:
            handler.close()
            logger.removeHandler(handler)
