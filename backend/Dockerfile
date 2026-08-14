FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Update the version and multi-platform digest together (docs/deployment.md).
COPY --from=ghcr.io/astral-sh/uv:0.8.11@sha256:8101ad825250a114e7bef89eefaa73c31e34e10ffbe5aff01562740bac97553c /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN /usr/local/bin/uv sync --no-install-project

COPY . .

EXPOSE 8000

CMD ["/usr/local/bin/uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
