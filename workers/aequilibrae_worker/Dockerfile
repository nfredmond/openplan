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

# Copy worker code and bundled seed data
COPY main.py .
COPY data/ data/

# Set environment defaults for cloud
ENV SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
ENV AEQ_WORK_DIR=/tmp/aeq_runs
ENV AEQ_SEED_DIR=/app/data/package

# The worker polls Supabase continuously
CMD ["python", "main.py"]
