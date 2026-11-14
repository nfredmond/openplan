# Kit image: the offsite-backup worker's own base and packages, plus the
# capture verifier and the install kit. Review 15, B1: verify_capture.py must
# run on this image's Python (Debian bookworm, 3.11.2), not the operator's.
# Built locally by image/build.sh; never pushed or deployed.
FROM postgres:17-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-boto3 gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/hosted-backup/backup.py workers/hosted-backup/verify_capture.py /app/
COPY scripts/ops/hosted-install/ /kit/
USER postgres
CMD ["python3", "/kit/run_sql.py", "--help"]
