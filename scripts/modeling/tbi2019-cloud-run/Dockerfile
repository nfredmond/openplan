FROM python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 NUMBA_NUM_THREADS=1 \
    MALLOC_MMAP_THRESHOLD_=131072 MALLOC_TRIM_THRESHOLD_=0 MALLOC_ARENA_MAX=2
COPY requirements-model.lock requirements-transport.lock /opt/locks/
# Preserve the locally proven environment, without resolving to newer dependency versions.
RUN pip install --no-cache-dir --no-deps --require-hashes -r /opt/locks/requirements-model.lock \
    && python -m venv /opt/transport \
    && /opt/transport/bin/pip install --no-cache-dir --require-hashes -r /opt/locks/requirements-transport.lock
COPY runner.py monitor.py verify_archive.py admission.json full-inventory.json proof-inventory.json /opt/tbi/
COPY configs /opt/tbi/configs
COPY chunk_cache.csv /opt/tbi/chunk_cache.csv
WORKDIR /work
ENTRYPOINT ["/opt/transport/bin/python", "/opt/tbi/runner.py"]
