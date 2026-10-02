FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY workers/activitysim_worker/requirements.txt /tmp/activitysim-worker-requirements.txt
RUN pip install --no-cache-dir -r /tmp/activitysim-worker-requirements.txt

COPY . /app

EXPOSE 8080

CMD ["sh", "-c", "python workers/activitysim_worker/main.py --check-http-config && exec gunicorn --chdir workers/activitysim_worker --bind 0.0.0.0:${PORT:-8080} main:app"]
