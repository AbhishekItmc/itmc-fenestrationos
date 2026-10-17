# ITMC FenestrationOS API — production image
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# runtime libs only (psycopg[binary] and ortools ship wheels)
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin fos \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh \
    && chown -R root:root /app && chmod -R a+rX /app

USER fos
ENV ENV=prod \
    LOG_JSON=1 \
    SERVE_FRONTEND=0 \
    FORWARDED_ALLOW_IPS=127.0.0.1

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
