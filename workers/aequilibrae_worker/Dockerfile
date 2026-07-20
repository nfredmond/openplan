FROM python:3.12-slim

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
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ALL worker Python modules via a glob. main.py's import graph pulls in
# data_pipeline/lodes/resident_vmt/gateways/mode_choice/count_validation/
# time_of_day/etc. — every module must be present or the image crashes at import
# on startup. An explicit enumeration has silently omitted a new stdlib sibling
# TWICE (mode_choice.py, then time_of_day.py); a glob makes that impossible.
# Test/off-run-path scripts ride along harmlessly (CMD runs only main.py).
COPY *.py .
COPY data/ data/

# Set environment defaults for cloud
ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
ENV AEQ_WORK_DIR=/tmp/aeq_runs
ENV AEQ_SEED_DIR=/app/data/package

# The worker polls Supabase continuously
CMD ["python", "main.py"]
