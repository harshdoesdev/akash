#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${AKASH_HOST:-127.0.0.1}"
PORT="${AKASH_PORT:-4173}"
BASE_URL="${AKASH_BASE_URL:-http://${HOST}:${PORT}}"
SERVER_LOG="${ROOT_DIR}/tmp/vite-preview.log"

mkdir -p "${ROOT_DIR}/tmp"

cd "${ROOT_DIR}"
npm run build >/dev/null

npx vite preview --host "${HOST}" --port "${PORT}" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..30}; do
  if curl -sf "${BASE_URL}" >/dev/null; then
    break
  fi
  sleep 1
done

AKASH_BASE_URL="${BASE_URL}" node scripts/capture-media.mjs
