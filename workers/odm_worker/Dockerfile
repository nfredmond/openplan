FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies first so image rebuilds reuse the layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ALL worker Python modules via a glob — the same rule as the AequilibraE
# worker's Dockerfile, for the same reason: an explicit enumeration silently
# omits the next sibling module and the image then crashes at import on
# startup. Test scripts ride along harmlessly (CMD runs only main.py).
COPY *.py ./

# Where per-job working directories and published outputs live. Container-local
# scratch; mount a volume here if outputs should survive a container rebuild
# (OpenPlan takes custody of the bytes on the succeeded callback either way).
ENV ODM_WORKER_WORK_DIR=/tmp/odm_worker_jobs

# NodeODM's address inside the docker-compose network. Point it elsewhere to
# use a NodeODM you already run.
ENV NODEODM_URL=http://nodeodm:3000

EXPOSE 8484

CMD ["python", "main.py"]
