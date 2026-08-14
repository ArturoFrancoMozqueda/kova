#!/usr/bin/env sh
set -eu

SUITE="${1:-all}"
REPO_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$REPO_DIR/docker-compose.test.yml"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans
}
trap cleanup EXIT INT TERM

case "$SUITE" in
  backend|all)
    docker compose -f "$COMPOSE_FILE" up -d --wait db
    cd "$REPO_DIR/backend"
    uv sync
    DATABASE_URL=postgresql+psycopg://pos:pos@127.0.0.1:55432/pos_test uv run alembic upgrade head
    DATABASE_URL=postgresql+psycopg://pos:pos@127.0.0.1:55432/pos_test uv run pytest
    ;;
  integration) ;;
  *) echo "Uso: scripts/test-stack.sh [backend|integration|all]" >&2; exit 2 ;;
esac

case "$SUITE" in
  integration|all)
    docker compose -f "$COMPOSE_FILE" up -d --build --wait
    cd "$REPO_DIR/frontend"
    npm ci
    npx playwright install chromium
    KOVA_INTEGRATION=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5174 npm run test:integration
    ;;
esac
