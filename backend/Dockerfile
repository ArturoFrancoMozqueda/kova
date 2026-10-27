# Update the Python tag and multi-platform digest together (docs/desarrollo-y-ci.md).
FROM python:3.12-slim@sha256:dd29372629eeba2dd003fd9e9d35a5b8236c44727875a0364254b5127af88e65

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_NO_SYNC=1

ARG KOVA_RELEASE_SHA=unknown
ENV KOVA_RELEASE_SHA=$KOVA_RELEASE_SHA

# Update the version and multi-platform digest together (docs/desarrollo-y-ci.md).
COPY --from=ghcr.io/astral-sh/uv:0.13.4@sha256:9f130421e930bfbdc563c00740466603f8723158e90297d07957c2294640262b /uv /usr/local/bin/uv

WORKDIR /app

# Only the dedicated ingestion process starts this daemon. API/chat machines
# expose no Docker socket; child parsers receive neither network nor secrets.
RUN apt-get update && apt-get install -y --no-install-recommends docker.io docker-cli \
    && docker --version && dockerd --version \
    && rm -rf /var/lib/apt/lists/* /var/log/apt /var/log/dpkg.log \
        /var/log/alternatives.log /var/cache/ldconfig/aux-cache

COPY pyproject.toml uv.lock ./
RUN /usr/local/bin/uv sync --frozen --no-cache --no-dev --no-install-project

COPY . .

EXPOSE 8000

CMD ["/usr/local/bin/uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
