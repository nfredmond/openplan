# The modeling worker: the container that turns "launch a run" on /county-runs
# into an actual travel model result.
#
# 3.11 ON PURPOSE. It is the only interpreter this chain has been observed to
# complete a run on (2026-08-15, full county run, 5m41s). aequilibrae ships
# compiled wheels per Python version; moving this line is a measurement, not an
# edit.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# AequilibraE keeps its project in a SpatiaLite database, loaded at runtime as
# a SQLite extension — `screening_runtime.connect_spatialite` raises
# "Could not locate mod_spatialite shared library" without this, at the point
# a run has already downloaded its road network.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-mod-spatialite \
    libspatialite-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# TWO REQUIREMENT FILES, BOTH REQUIRED. The first is what this web service
# imports; the second is what the model subprocess it launches imports. Install
# only the first and every job fails a second in with ModuleNotFoundError while
# /healthz keeps answering — see the header of scripts/modeling/requirements.txt.
COPY workers/county_onramp_worker/requirements.txt /tmp/county-onramp-worker-requirements.txt
COPY scripts/modeling/requirements.txt /tmp/modeling-requirements.txt
RUN pip install --no-cache-dir -r /tmp/county-onramp-worker-requirements.txt \
    && pip install --no-cache-dir -r /tmp/modeling-requirements.txt

# The whole repo, because the bootstrap shells out to sibling scripts by path
# and reads reference data out of `data/`. See `.dockerignore` at the repo root
# for what is kept out — without it this copies a 14 GB Next.js build cache.
COPY . /app

ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so

# A run writes into `data/screening-runs/` and caches TIGER downloads in
# `data/_screening_cache/`. Under docker-compose both live on a bind mount of
# your checkout, so results survive the container and the app can read them.
# HOME is set because the container runs as your own user id there, which may
# have no home directory inside the image.
ENV HOME=/tmp

EXPOSE 8080

# `--workers 1` because the job concurrency cap
# (OPENPLAN_COUNTY_ONRAMP_MAX_CONCURRENCY) is a thread pool inside ONE process:
# two gunicorn workers would silently double it, and two full model runs on one
# machine mostly means both are slow.
#
# `--timeout 0` because a run takes minutes and lives in a background thread
# after the request has already returned 202. Gunicorn's default kills a worker
# it believes is stuck, and a worker killed mid-run posts no callback at all —
# the run would simply stop, with nothing anywhere saying why.
#
# The bind address honours OPENPLAN_COUNTY_ONRAMP_WORKER_HOST, the same
# variable `main.py` reads, so a host-networked local install can keep the
# worker on loopback. It defaults to 0.0.0.0 because a container on a bridge
# network reached through a published port MUST bind all interfaces to be
# reachable at all.
CMD ["sh", "-c", "gunicorn --chdir workers/county_onramp_worker --bind ${OPENPLAN_COUNTY_ONRAMP_WORKER_HOST:-0.0.0.0}:${PORT:-8080} --workers 1 --threads 4 --timeout 0 main:app"]
