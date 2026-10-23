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
COPY workers/hosted-models/verify_graph_compatibility.py /tmp/verify_graph_compatibility.py
RUN /opt/aequilibrae/bin/python /tmp/verify_graph_compatibility.py
RUN python -m venv /opt/activitysim && /opt/activitysim/bin/pip install --no-cache-dir -r /tmp/activitysim-exec.txt -r /tmp/activitysim-worker.txt
RUN /opt/activitysim/bin/activitysim --help >/dev/null
COPY workers/aequilibrae_worker ./workers/aequilibrae_worker
RUN cd /app/workers/aequilibrae_worker && /opt/aequilibrae/bin/python -c "from model_assignment_graph_adapter import supported_engine; supported_engine()"
COPY workers/activitysim_worker ./workers/activitysim_worker
COPY scripts/modeling ./scripts/modeling
RUN cd /app/workers/aequilibrae_worker && /opt/aequilibrae/bin/python -c "from model_common_population_package import population_library; population_library(); from synthetic_population import synthesize_study_area; assert callable(synthesize_study_area)"
COPY data/modeling ./data/modeling
RUN /opt/activitysim/bin/python -c "import sys; sys.path.insert(0, '/app/scripts/modeling'); from activitysim_accepted_components import resolve_accepted_components; print('Verified accepted component assets:', len(resolve_accepted_components()))"
COPY workers/hosted-models/supervise.py ./supervise.py
ENV PYTHONUNBUFFERED=1
ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
ENV AEQ_WORKER_MODE=poll
ENV AEQ_WORK_DIR=/data/model-runs
ENV OPENPLAN_HOSTED_ARTIFACT_MIRROR=1
ENV ACTIVITYSIM_WORK_DIR=/data/activitysim/runs
ENV ACTIVITYSIM_CLI=/opt/activitysim/bin/activitysim
CMD ["python", "-u", "supervise.py"]
