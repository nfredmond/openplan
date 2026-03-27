FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY workers/county_onramp_worker/requirements.txt /tmp/county-onramp-worker-requirements.txt
RUN pip install --no-cache-dir -r /tmp/county-onramp-worker-requirements.txt

COPY . /app

EXPOSE 8080

CMD ["sh", "-c", "gunicorn --chdir workers/county_onramp_worker --bind 0.0.0.0:${PORT:-8080} main:app"]
