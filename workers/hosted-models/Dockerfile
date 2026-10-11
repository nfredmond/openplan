FROM python:3.11-slim

# Separate environments preserve each engine's existing numerical requirements.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libsqlite3-mod-spatialite libspatialite-dev libgeos-dev \
    libproj-dev libsqlite3-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/aequilibrae_worker/requirements.txt /tmp/aequilibrae.txt
COPY workers/activitysim_worker/requirements-exec.txt /tmp/activitysim-exec.txt
COPY workers/activitysim_worker/requirements.txt /tmp/activitysim-worker.txt
RUN python -m venv /opt/aequilibrae && /opt/aequilibrae/bin/pip install --no-cache-dir -r /tmp/aequilibrae.txt
RUN python -m venv /opt/activitysim && /opt/activitysim/bin/pip install --no-cache-dir -r /tmp/activitysim-exec.txt -r /tmp/activitysim-worker.txt
COPY workers/aequilibrae_worker ./workers/aequilibrae_worker
COPY workers/activitysim_worker ./workers/activitysim_worker
COPY scripts/modeling ./scripts/modeling
COPY workers/hosted-models/supervise.py ./supervise.py
ENV PYTHONUNBUFFERED=1
ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
ENV AEQ_WORKER_MODE=poll
ENV AEQ_WORK_DIR=/data/model-runs
ENV ACTIVITYSIM_WORK_DIR=/data/activitysim
ENV ACTIVITYSIM_CLI=/opt/activitysim/bin/activitysim
CMD ["python", "-u", "supervise.py"]
