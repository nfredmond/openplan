FROM python:3.11-slim

# Install system dependencies for spatialite + AequilibraE
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-mod-spatialite \
    libspatialite-dev \
    libgeos-dev \
    libproj-dev \
    libsqlite3-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY workers/aequilibrae_worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Build from the repository root. Keep the worker and shared modeling sources
# at their repository-relative paths so population_library resolves both.
# Copy all worker modules so a new sibling import cannot be omitted.
WORKDIR /app/workers/aequilibrae_worker
COPY workers/aequilibrae_worker/*.py .
RUN python -c "from model_assignment_graph_adapter import supported_engine; supported_engine()"
COPY workers/aequilibrae_worker/data/ data/
COPY scripts/modeling /app/scripts/modeling
# Import the actual shared library and synthesis dependency graph without
# loading main.py, contacting providers, or constructing a population.
RUN python -c "from model_common_population_package import population_library; population_library(); from synthetic_population import synthesize_study_area; assert callable(synthesize_study_area)"

# Set environment defaults for cloud
ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
ENV AEQ_WORK_DIR=/tmp/aeq_runs
# AEQ_SEED_DIR was set here and in fly.toml and read by nothing in the worker's
# import graph. A container variable that names a directory no code opens tells
# an operator they have configured something they have not, so it is gone rather
# than kept for symmetry.

# ONE IMAGE, BOTH WAYS OF RUNNING IT. AEQ_WORKER_MODE selects at startup:
#   poll (default) — reads queued runs out of Supabase; no inbound port is opened
#                    and this EXPOSE is unused.
#   push           — serves the HTTP trigger below, so the app can wake a
#                    stateless pool instead of you keeping a machine on.
#   both           — both at once; stages are claimed atomically either way.
# The default is poll, so an existing deployment that rebuilds this image keeps
# behaving exactly as it did.
ENV AEQ_WORKER_MODE=poll

# Push mode listens here unless PORT (Railway, Cloud Run, Render) or
# AEQ_HTTP_PORT says otherwise. Declared so `docker run -P` and any platform
# that reads the image's exposed port find the right one; harmless in poll mode,
# which opens no socket at all.
EXPOSE 8080

CMD ["python", "main.py"]
