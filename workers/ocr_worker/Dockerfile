FROM python:3.12-slim

WORKDIR /app

# ocrmypdf's real work is done by programs, not Python packages:
#   tesseract-ocr           the recogniser
#   tesseract-ocr-<lang>    one trained-data package PER LANGUAGE. English is
#                           installed here; anything else has to be added, and
#                           the worker REFUSES a language it has no data for
#                           rather than reading a Spanish plan with the English
#                           model and returning text that looks like text.
#   ghostscript             PDF rendering/rewriting, required by ocrmypdf
#   poppler-utils           pdfinfo + pdftotext — the per-page split, which is
#                           the reason this worker exists
#   unpaper                 optional cleanup ocrmypdf uses when asked
#   libjpeg / zlib / pngquant  image handling on real scans
#
# TO ADD A LANGUAGE: append its package here (Spanish: tesseract-ocr-spa;
# Vietnamese: tesseract-ocr-vie; Simplified Chinese: tesseract-ocr-chi-sim) and
# rebuild. `docker compose exec ocr-worker tesseract --list-langs` prints what
# an image actually has, and /healthz reports the same list.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-eng \
      ghostscript \
      poppler-utils \
      unpaper \
      pngquant \
      libjpeg62-turbo \
      zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first so image rebuilds reuse the layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ALL worker Python modules via a glob — the same rule as the ODM and
# AequilibraE workers' Dockerfiles, for the same reason: an explicit
# enumeration silently omits the next sibling module and the image then crashes
# at import on startup. Test scripts ride along harmlessly (CMD runs only
# main.py), and being able to run them inside the image is deliberate.
COPY *.py ./

# Per-job scratch. Container-local: the source PDF is re-downloadable from
# OpenPlan's own storage and the recognised text is delivered by callback, so
# nothing here is worth a volume.
ENV OCR_WORKER_WORK_DIR=/tmp/ocr_worker_jobs

EXPOSE 8585

CMD ["python", "main.py"]
