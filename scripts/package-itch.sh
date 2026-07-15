#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="${ROOT_DIR}/release"
STAGE_DIR="${RELEASE_DIR}/akash-html5-alpha"
ZIP_PATH="${RELEASE_DIR}/akash-html5-alpha.zip"

cd "${ROOT_DIR}"
npm run build

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"
cp -R dist/. "${STAGE_DIR}/"
cp CREDITS.md "${STAGE_DIR}/"
find "${STAGE_DIR}" -name '.DS_Store' -delete
rm -f "${STAGE_DIR}/branding/logo-fill-icon.png" "${STAGE_DIR}/branding/logo-fill-wide.png"

rm -f "${ZIP_PATH}"
(
  cd "${STAGE_DIR}"
  zip -qr "${ZIP_PATH}" .
)

printf 'Created %s\n' "${ZIP_PATH}"
