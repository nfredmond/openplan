# PostgreSQL 17 client tools match the managed database's major version.
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-boto3 gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/hosted-backup/backup.py /app/backup.py
USER postgres
CMD ["python3", "/app/backup.py"]
