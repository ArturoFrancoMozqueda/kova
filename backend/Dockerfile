# Update the Python tag and multi-platform digest together (docs/deployment.md).
FROM python:3.12-slim@sha256:dd29372629eeba2dd003fd9e9d35a5b8236c44727875a0364254b5127af88e65

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_NO_SYNC=1

ARG KOVA_RELEASE_SHA=unknown
ENV KOVA_RELEASE_SHA=$KOVA_RELEASE_SHA

# Update the version and multi-platform digest together (docs/deployment.md).
COPY --from=ghcr.io/astral-sh/uv:0.8.11@sha256:8101ad825250a114e7bef89eefaa73c31e34e10ffbe5aff01562740bac97553c /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN /usr/local/bin/uv sync --frozen --no-dev --no-install-project

COPY . .

EXPOSE 8000

CMD ["/usr/local/bin/uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
